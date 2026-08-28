/**
 * Account tools — the Profile and Reels tabs given something to actually do.
 *
 * Section 9 of the product vision: "not five clicks, not one — you say it and it
 * happens." Voice is already armed on all five tabs (voice-always.js), and Book,
 * Partner and ScanSquad each have real tools behind them. Profile and Reels do not:
 * both point at the Book agent, so the only jobs they can finish are booking jobs.
 * Ask the Profile tab "what's in my wallet" or "am I verified" — the two questions
 * that tab exists for — and the assistant had no way to find out, so it either
 * apologised or, worse, guessed.
 *
 * These tools are the answers, read straight from the tables the screens read:
 *
 *   get_my_wallet        wallets + wallet_transactions   ("how much have I got?")
 *   get_my_pass          bookings + booking_qr_codes     ("where's my pass?")
 *   get_my_verification  users.identity_verified         ("am I verified?")
 *   get_my_streak        gym_streaks                     ("what's my streak?")
 *   get_saved_gyms       gym_saves                       ("what have I saved?")
 *   save_gym             gym_saves                       ("save that one")
 *
 * Two rules they all follow:
 *
 * 1. Scoped to the caller. Every query filters on the authenticated user id; none of
 *    them takes a user id from the model. There is no argument that can point one
 *    customer's tool at another customer's wallet.
 * 2. They never invent. A missing wallet row is "£0.00 and nothing loaded yet", not
 *    a guess, and an empty result says so plainly, because the agent will read
 *    whatever is returned out loud as fact.
 *
 * get_my_wallet deliberately does NOT run the reconciliation the /api/wallet route
 * runs (back-paying commissions and partner revenue). Asking a question should not
 * move money. If the two ever disagree, the screen is right and the reconciler is
 * what makes it right.
 */
const pool = require('../middleware/db');

/** Pence to pounds. The sign goes outside the symbol: a spend is -£4.49, not £-4.49. */
const money = (pence) => {
  const n = (Number(pence) || 0) / 100;
  return (n < 0 ? '-£' : '£') + Math.abs(n).toFixed(2);
};
const pounds = (n) => '£' + (Number(n) || 0).toFixed(2);

/** Every query goes through here so a failed read can never look like a real answer. */
async function q(sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return { ok: true, rows };
  } catch (err) {
    console.error('[AccountTools] query failed:', err.message);
    return { ok: false, rows: [] };
  }
}

const DB_DOWN = { ok: false, message: 'I could not reach your account just then — nothing has changed. Try me again in a moment.' };

const tools = {
  /* ---------- reads: no confirmation, they change nothing ---------- */

  get_my_wallet: {
    write: false,
    schema: {
      name: 'get_my_wallet',
      description:
        "The customer's ScanGym wallet: balance and recent activity. Use for \"how much have I got\", \"what's my balance\", \"what did I spend\".",
      parameters: {
        type: 'object',
        properties: {
          recentCount: { type: 'integer', minimum: 1, maximum: 10, description: 'How many recent transactions to include (default 5).' },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const limit = Math.min(Math.max(parseInt(args.recentCount, 10) || 5, 1), 10);
      const wallet = await q('SELECT id, balance_pence, total_loaded_pence, total_spent_pence FROM wallets WHERE user_id = $1', [userId]);
      if (!wallet.ok) return DB_DOWN;

      if (!wallet.rows.length) {
        return {
          ok: true,
          balance: 0,
          balanceText: money(0),
          recent: [],
          message: 'Your wallet is empty — nothing loaded into it yet. You can pay by card without topping it up.',
        };
      }

      const w = wallet.rows[0];
      const tx = await q(
        `SELECT type, amount_pence, description, created_at
           FROM wallet_transactions
          WHERE wallet_id = $1
          ORDER BY created_at DESC
          LIMIT ${limit}`,
        [w.id]
      );

      return {
        ok: true,
        balance: (Number(w.balance_pence) || 0) / 100,
        balanceText: money(w.balance_pence),
        totalLoaded: money(w.total_loaded_pence),
        totalSpent: money(w.total_spent_pence),
        recent: tx.rows.map((t) => ({
          type: t.type,
          amount: money(t.amount_pence),
          description: t.description,
          at: t.created_at,
        })),
        message: `Wallet balance ${money(w.balance_pence)}.`,
      };
    },
  },

  get_my_pass: {
    write: false,
    schema: {
      name: 'get_my_pass',
      description:
        'The pass for the next session, with the entry code and whether it has been scanned. Use for "where is my pass", "show my QR", "am I checked in".',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'A specific booking, if the customer named one. Otherwise the next upcoming session.' },
        },
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const params = [String(userId)];
      let where = 'b.user_id::text = $1::text AND b.status NOT IN (\'cancelled\')';
      if (args.bookingId) {
        params.push(String(args.bookingId));
        where += ' AND b.id::text = $2::text';
      } else {
        where += ' AND b.booking_date >= CURRENT_DATE';
      }

      const booking = await q(
        `SELECT b.id, b.booking_date, b.start_time, b.booking_code, b.status,
                g.name AS gym_name, g.address
           FROM public.bookings b
           LEFT JOIN public.gyms g ON g.id = b.gym_id
          WHERE ${where}
          ORDER BY b.booking_date, b.start_time
          LIMIT 1`,
        params
      );
      if (!booking.ok) return DB_DOWN;
      if (!booking.rows.length) {
        return { ok: true, hasPass: false, message: 'You have no upcoming session, so there is no pass to show yet.' };
      }

      const b = booking.rows[0];
      const qr = await q(
        `SELECT id, created_at FROM booking_qr_codes
          WHERE booking_id = $1 AND user_id = $2
          ORDER BY created_at DESC LIMIT 1`,
        [b.id, userId]
      );
      let scans = [];
      if (qr.rows.length) {
        const checkins = await q(
          `SELECT scan_type, scanned_at FROM booking_checkins WHERE qr_code_id = $1 ORDER BY scanned_at`,
          [qr.rows[0].id]
        );
        scans = checkins.rows.map((c) => ({ type: c.scan_type, at: c.scanned_at }));
      }

      return {
        ok: true,
        hasPass: true,
        gymName: b.gym_name,
        address: b.address,
        date: b.booking_date,
        time: b.start_time,
        entryCode: b.booking_code,
        status: b.status,
        qrReady: qr.rows.length > 0,
        scanned: scans.length > 0,
        scans,
        // The pass itself is a screen, not something an assistant can say out loud.
        openPath: '/profile',
        message: scans.length
          ? `Already scanned in at ${b.gym_name}.`
          : `Pass ready for ${b.gym_name}${b.booking_code ? `, entry code ${b.booking_code}` : ''}.`,
      };
    },
  },

  get_my_verification: {
    write: false,
    schema: {
      name: 'get_my_verification',
      description:
        'Whether the customer has passed ID verification. Use for "am I verified", "did my ID go through". Reports what the account says — never claim a check has passed that has not.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const res = await q('SELECT identity_verified, identity_session_id FROM users WHERE id = $1', [userId]);
      if (!res.ok) return DB_DOWN;
      if (!res.rows.length) return { ok: false, message: 'I could not find your account.' };

      const row = res.rows[0];
      if (row.identity_verified) return { ok: true, verified: true, message: 'Your ID is verified.' };
      if (row.identity_session_id) {
        return {
          ok: true,
          verified: false,
          started: true,
          // The live Stripe status is checked by /api/identity/status, which is a
          // screen away. Saying "still being checked" is true; guessing is not.
          message: 'Your ID check has been started but is not verified yet.',
        };
      }
      return { ok: true, verified: false, started: false, message: 'You have not started ID verification yet.' };
    },
  },

  get_my_streak: {
    write: false,
    schema: {
      name: 'get_my_streak',
      description: 'The customer\'s gym streak. Use for "what is my streak", "how many weeks am I on".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const res = await q(
        'SELECT current_streak, longest_streak, last_workout_date FROM gym_streaks WHERE user_id = $1',
        [userId]
      );
      if (!res.ok) return DB_DOWN;
      if (!res.rows.length) {
        return { ok: true, currentStreak: 0, message: 'No streak yet — your first session starts it.' };
      }
      const s = res.rows[0];
      return {
        ok: true,
        currentStreak: Number(s.current_streak) || 0,
        longestStreak: Number(s.longest_streak) || 0,
        lastWorkout: s.last_workout_date,
        message: `Current streak ${Number(s.current_streak) || 0}, best ${Number(s.longest_streak) || 0}.`,
      };
    },
  },

  get_saved_gyms: {
    write: false,
    schema: {
      name: 'get_saved_gyms',
      description: 'Gyms the customer has saved. Use for "what have I saved", "my list", "the one I saved earlier".',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      const res = await q(
        `SELECT gs.gym_id, COALESCE(g.name, gs.gym_name) AS name, g.address, g.day_pass_price
           FROM gym_saves gs
           LEFT JOIN gyms g ON g.id = gs.gym_id
          WHERE gs.user_id = $1
          ORDER BY gs.created_at DESC
          LIMIT 20`,
        [userId]
      );
      if (!res.ok) return DB_DOWN;
      if (!res.rows.length) return { ok: true, gyms: [], message: 'Nothing saved yet.' };
      return {
        ok: true,
        gyms: res.rows.map((r) => ({
          gymId: r.gym_id,
          name: r.name,
          address: r.address,
          dayPass: r.day_pass_price ? pounds(r.day_pass_price) : null,
        })),
        message: `${res.rows.length} saved gym${res.rows.length === 1 ? '' : 's'}.`,
      };
    },
  },

  /* ---------- one state change, and why it does not ask twice ----------
   *
   * Saving a gym moves no money and is undone by saying "unsave it". Routing it
   * through the confirm-before-write flow would put a Yes/No tap between "save that
   * one" and it being saved — the exact tap this product exists to delete. Money
   * still confirms: book_and_pay is unchanged. The `saved` flag is explicit rather
   * than a toggle so a misheard "save it" can never quietly remove a gym.
   */
  save_gym: {
    write: false,
    schema: {
      name: 'save_gym',
      description:
        'Save a gym to the customer\'s list, or remove it. Use for "save that one", "add it to my list", "take it off my list". Needs the gym id from find_gyms, get_gym or the reel on screen.',
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'string', description: 'The gym id.' },
          saved: { type: 'boolean', description: 'true to save (default), false to remove.' },
        },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      const gymId = String(args.gymId || '').trim();
      if (!gymId) return { ok: false, message: 'I need to know which gym — say the name and I will find it first.' };
      const wantSaved = args.saved !== false;

      const gym = await q('SELECT id, name FROM gyms WHERE id::text = $1::text', [gymId]);
      if (!gym.ok) return DB_DOWN;
      if (!gym.rows.length) return { ok: false, message: 'I could not find that gym, so I have not changed your list.' };
      const name = gym.rows[0].name;

      if (!wantSaved) {
        const del = await q('DELETE FROM gym_saves WHERE user_id = $1 AND gym_id = $2', [userId, gym.rows[0].id]);
        if (!del.ok) return DB_DOWN;
        return { ok: true, saved: false, gymName: name, message: `${name} removed from your list.` };
      }

      // Same default-board behaviour as POST /api/referrals/gyms/save, so a gym
      // saved by voice lands in the same place as one saved by tapping the heart.
      const board = await q('SELECT id FROM gym_boards WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1', [userId]);
      if (!board.ok) return DB_DOWN;
      let boardId = board.rows.length ? board.rows[0].id : null;
      if (!boardId) {
        const made = await q(
          `INSERT INTO gym_boards (user_id, name, emoji) VALUES ($1, 'Saved Gyms', '💪') RETURNING id`,
          [userId]
        );
        if (!made.ok || !made.rows.length) return DB_DOWN;
        boardId = made.rows[0].id;
      }

      const ins = await q(
        `INSERT INTO gym_saves (user_id, gym_id, gym_name, board_id)
         VALUES ($1, $2, $3, $4) ON CONFLICT (user_id, gym_id) DO NOTHING`,
        [userId, gym.rows[0].id, name, boardId]
      );
      if (!ins.ok) return DB_DOWN;

      return { ok: true, saved: true, gymId: gym.rows[0].id, gymName: name, message: `${name} saved to your list.` };
    },
  },
};

module.exports = { tools };
