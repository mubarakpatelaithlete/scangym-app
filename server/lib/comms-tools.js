/**
 * Comms tools — Buttons v1.0 batch 3 (docs/BUTTONS-V1.md): Messages, AI coach, Music.
 *
 *   message_gym        conversations + messages + chat_escalations, owner told by SMS/email
 *   read_gym_replies   the owner's replies to this customer's messages
 *   ask_coach          the AI Personal Trainer — same gate (paid + scanned in), same brief,
 *                      same memory (coach_conversations) as the Coach screen
 *   log_workout        workout_logs — "log 40 minutes of legs"
 *   play_music         screen: the Music tab's player (play / pause / next / previous)
 *   save_track         user_playlists + playlist_tracks, like the ➕ on the player
 *   get_my_playlists   what they have saved
 *
 * Rules as everywhere: scoped to the caller, never invents, an owner is told only through
 * the same channels the receptionist chat uses (lib/owner-notify.js).
 */

const pool = require('../middleware/db');
const crypto = require('crypto');
const llm = require('./llm');
const { notifyGymOwner } = require('./owner-notify');
const coach = require('./coach-core');

async function gymRow(gymId) {
  const id = Number.parseInt(gymId, 10);
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query('SELECT id, name, claimed_by FROM gyms WHERE id = $1', [id]).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

const clip = (s, n) => String(s || '').trim().slice(0, n);

/** Read a whole (non-streamed) answer from the shared provider pool. */
async function complete(tag, messages, maxTokens) {
  const { stream } = await llm.streamChat(tag, { messages, max_tokens: maxTokens, temperature: 0.7, stream: false });
  return (stream.choices?.[0]?.message?.content || '').trim();
}

const tools = {
  message_gym: {
    write: true,
    schema: {
      name: 'message_gym',
      description:
        "Send the customer's message to a gym's team (the people, not a bot) — a question, a request, a complaint. Read it back before calling; the gym is notified by text and email. Use get_reviews/get_facilities first if a tool can answer it.",
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'integer', description: 'The gym id from find_gyms.' },
          message: { type: 'string', description: 'Their message, as said.' },
        },
        required: ['gymId', 'message'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      if (!userId) return { ok: false, message: 'You need to be signed in to message a gym.' };
      const text = clip(args.message, 1000);
      if (!text) return { ok: false, message: 'What would you like to tell them?' };
      const gym = await gymRow(args.gymId);
      if (!gym) return { ok: false, message: "I couldn't find that gym." };

      const convo = await pool.query(
        'INSERT INTO conversations (title, user_id, gym_id, created_at) VALUES ($1, $2, $3, NOW()) RETURNING id',
        [`Chat with ${gym.name}`, String(userId), gym.id]
      );
      const conversationId = convo.rows[0].id;
      await pool.query("INSERT INTO messages (conversation_id, role, content, created_at) VALUES ($1, 'user', $2, NOW())", [conversationId, text]);
      const told = await notifyGymOwner(pool, gym, text, conversationId);
      await pool
        .query(
          `INSERT INTO chat_escalations (conversation_id, gym_id, user_message, escalation_reason, owner_notified_sms, owner_notified_email, status)
           VALUES ($1, $2, $3, 'voice message', $4, $5, 'pending')`,
          [conversationId, gym.id, text, told.sms, told.email]
        )
        .catch((e) => console.error('[CommsTools] escalation row failed:', e.message));

      const reached = told.sms || told.email;
      return {
        ok: true,
        conversationId,
        gym: { id: gym.id, name: gym.name },
        ownerNotified: told,
        message: reached
          ? `Sent to ${gym.name}'s team — they've been notified by ${told.sms && told.email ? 'text and email' : told.sms ? 'text' : 'email'}. I'll have their reply when you ask.`
          : `Saved for ${gym.name}'s team, but they haven't set up notifications yet, so I can't promise when they'll see it.`,
      };
    },
  },

  read_gym_replies: {
    write: false,
    schema: {
      name: 'read_gym_replies',
      description: "Any replies from gym teams to messages this customer sent, newest first, and which messages are still waiting.",
      parameters: {
        type: 'object',
        properties: { gymId: { type: 'integer', description: 'Only one gym. Omit for all.' } },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      if (!userId) return { ok: false, message: 'You need to be signed in to read your messages.' };
      const params = [String(userId)];
      let where = 'c.user_id = $1';
      if (Number.isInteger(Number.parseInt(args.gymId, 10))) {
        params.push(Number.parseInt(args.gymId, 10));
        where += ' AND c.gym_id = $2';
      }
      const { rows } = await pool
        .query(
          `SELECT c.id, g.name AS gym_name, ce.user_message, ce.owner_response, ce.status, ce.created_at, ce.resolved_at
             FROM conversations c
             JOIN chat_escalations ce ON ce.conversation_id = c.id
             LEFT JOIN gyms g ON g.id = c.gym_id
            WHERE ${where}
            ORDER BY c.created_at DESC LIMIT 10`,
          params
        )
        .catch(() => ({ rows: [] }));
      const replies = rows.filter((r) => r.owner_response);
      const waiting = rows.length - replies.length;
      return {
        ok: true,
        messages: rows.map((r) => ({ gym: r.gym_name, sent: r.user_message, reply: r.owner_response || null, status: r.status })),
        replies: replies.length,
        waiting,
        message: !rows.length
          ? "You haven't messaged any gym yet."
          : replies.length
          ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}${waiting ? `, ${waiting} still waiting` : ''}.`
          : `No replies yet — ${waiting} message${waiting === 1 ? '' : 's'} waiting on the gym.`,
      };
    },
  },

  ask_coach: {
    write: false,
    schema: {
      name: 'ask_coach',
      description:
        "Put a training question to the customer's AI Personal Trainer, which remembers their goals, injuries and recent workouts. Only unlocked once they have paid and scanned into a gym — if locked, say so and offer to book.",
      parameters: {
        type: 'object',
        properties: { question: { type: 'string', description: 'Their question, as said.' } },
        required: ['question'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      if (!userId) return { ok: false, message: 'You need to be signed in for the AI Coach.' };
      const question = clip(args.question, 1000);
      if (!question) return { ok: false, message: 'What do you want to ask your coach?' };
      const gate = await coach.checkedIn(userId);
      if (!gate.ok) return { ok: false, locked: true, requiresBooking: true, message: coach.LOCKED_MESSAGE };

      const ctx = await coach.coachContext(userId);
      await pool.query('INSERT INTO coach_conversations (user_id, role, content) VALUES ($1, $2, $3)', [userId, 'user', question]);
      const hist = await pool.query('SELECT role, content FROM coach_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [userId]);
      const messages = [{ role: 'system', content: ctx.systemPrompt + '\nYou are being read aloud: answer in two or three short sentences.' }, ...hist.rows.reverse()];
      let answer;
      try {
        answer = await complete('Coach', messages, 300);
      } catch (e) {
        return { ok: false, message: "Your coach isn't available right now — try again in a minute." };
      }
      if (!answer) return { ok: false, message: "Your coach didn't answer — try again." };
      await pool.query('INSERT INTO coach_conversations (user_id, role, content) VALUES ($1, $2, $3)', [userId, 'assistant', answer]);
      return { ok: true, answer, hasProfile: !!ctx.profile, message: answer };
    },
  },

  log_workout: {
    write: false,
    schema: {
      name: 'log_workout',
      description: 'Record a workout the customer just did — type, minutes, how it felt. "Log 45 minutes of legs, felt strong." Same gate as the coach.',
      parameters: {
        type: 'object',
        properties: {
          workoutType: { type: 'string', description: 'e.g. legs, push, cardio, full body.' },
          durationMinutes: { type: 'integer', description: 'Minutes, if said.' },
          notes: { type: 'string', description: 'Anything else they said about it.' },
          energyLevel: { type: 'integer', description: '1 (drained) to 5 (great), if they said how they felt.' },
        },
        required: ['workoutType'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      if (!userId) return { ok: false, message: 'You need to be signed in to log a workout.' };
      const gate = await coach.checkedIn(userId);
      if (!gate.ok) return { ok: false, locked: true, requiresBooking: true, message: coach.LOCKED_MESSAGE };
      const type = clip(args.workoutType, 60);
      if (!type) return { ok: false, message: 'What kind of workout was it?' };
      const mins = Number.isInteger(args.durationMinutes) && args.durationMinutes > 0 ? Math.min(600, args.durationMinutes) : null;
      const energy = Number.isInteger(args.energyLevel) && args.energyLevel >= 1 && args.energyLevel <= 5 ? args.energyLevel : null;
      const { rows } = await pool.query(
        `INSERT INTO workout_logs (user_id, gym_id, workout_type, duration_minutes, notes, energy_level)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [userId, gate.gymId, type, mins, clip(args.notes, 500) || null, energy]
      );
      return { ok: true, workoutId: rows[0].id, message: `Logged: ${type}${mins ? `, ${mins} minutes` : ''}.` };
    },
  },

  play_music: {
    write: false,
    schema: {
      name: 'play_music',
      description: 'Control the Music tab: play, pause, next or previous track. Opens the Music tab if needed. "Play some music", "skip", "pause".',
      parameters: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['play', 'pause', 'next', 'previous'] } },
        required: ['action'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const action = ['play', 'pause', 'next', 'previous'].includes(args.action) ? args.action : 'play';
      const said = { play: 'Playing.', pause: 'Paused.', next: 'Next track.', previous: 'Previous track.' }[action];
      return { ok: true, action, ui: { action: 'music', command: action }, message: said };
    },
  },

  save_track: {
    write: false,
    schema: {
      name: 'save_track',
      description: 'Save a track to one of the customer\'s playlists (creates the playlist if new). "Save this one", "add Beast Mode 2 to my playlist".',
      parameters: {
        type: 'object',
        properties: {
          trackName: { type: 'string' },
          artist: { type: 'string' },
          playlistTitle: { type: 'string', description: 'Default "My Playlist".' },
        },
        required: ['trackName'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      if (!userId) return { ok: false, message: 'You need to be signed in to save tracks.' };
      const trackName = clip(args.trackName, 120);
      if (!trackName) return { ok: false, message: 'Which track?' };
      const artist = clip(args.artist, 120);
      const title = clip(args.playlistTitle, 80) || 'My Playlist';
      let pl = await pool.query('SELECT id FROM user_playlists WHERE user_id = $1 AND title = $2 LIMIT 1', [String(userId), title]);
      if (!pl.rows.length) {
        pl = await pool.query('INSERT INTO user_playlists (user_id, title, share_token) VALUES ($1, $2, $3) RETURNING id', [
          String(userId),
          title,
          crypto.randomBytes(8).toString('hex'),
        ]);
      }
      const playlistId = pl.rows[0].id;
      const dup = await pool.query('SELECT id FROM playlist_tracks WHERE playlist_id = $1 AND track_name = $2 AND artist = $3', [playlistId, trackName, artist]);
      if (dup.rows.length) return { ok: true, alreadySaved: true, playlistId, message: `${trackName} is already in "${title}".` };
      await pool.query(
        "INSERT INTO playlist_tracks (playlist_id, track_name, artist, source_playlist, source_index) VALUES ($1, $2, $3, 'voice', 0)",
        [playlistId, trackName, artist]
      );
      await pool.query('UPDATE user_playlists SET updated_at = NOW() WHERE id = $1', [playlistId]).catch(() => null);
      return { ok: true, playlistId, message: `Saved ${trackName} to "${title}".` };
    },
  },

  get_my_playlists: {
    write: false,
    schema: {
      name: 'get_my_playlists',
      description: "The customer's saved playlists and how many tracks are in each.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      if (!userId) return { ok: false, message: 'You need to be signed in to see your playlists.' };
      const { rows } = await pool
        .query(
          `SELECT p.id, p.title, COUNT(pt.id)::int AS tracks
             FROM user_playlists p LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
            WHERE p.user_id = $1 GROUP BY p.id ORDER BY p.updated_at DESC`,
          [String(userId)]
        )
        .catch(() => ({ rows: [] }));
      return {
        ok: true,
        playlists: rows,
        message: rows.length ? `${rows.length} playlist${rows.length === 1 ? '' : 's'}: ${rows.map((p) => `${p.title} (${p.tracks})`).join(', ')}.` : "You haven't saved any tracks yet.",
      };
    },
  },
};

const PUBLIC_COMMS_TOOLS = new Set(['play_music']);

module.exports = { tools, PUBLIC_COMMS_TOOLS };
