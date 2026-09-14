/**
 * Social tools — Buttons v1.0 batch 2 (docs/BUTTONS-V1.md): Calendar, Facilities,
 * Reviews and Photos, said instead of tapped.
 *
 *   get_schedule     gyms.opening_hours + gym_schedule_overrides   ("is it open Sunday?", "next Friday")
 *   get_facilities   gym_amenities                                 ("do they have showers?")
 *   get_reviews      reviews                                       ("what do people say?")
 *   leave_review     reviews (INSERT, confirmed first)             ("give it five stars")
 *   get_gym_photos   review_media                                  ("show me photos")
 *   add_photo        screen: opens the review form's photo picker  (a file cannot be spoken)
 *
 * Same rules as account-tools: every write is scoped to the authenticated caller, no
 * argument can point a tool at another customer, and an empty read says so instead
 * of inventing. The SQL mirrors routes/reviews.js, routes/amenities.js,
 * routes/review-media.js and routes/gym-management.js so the voice answer and the
 * screen can never disagree.
 *
 * reply_to_review (gym owner) lives in partner-tools.js, next to the other owner tools.
 */

const pool = require('../middleware/db');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** YYYY-MM-DD for today + n, in UTC (matches book-tools.isoDate). */
function isoDate(n, now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The gym row; ids come from find_gyms so they are integers. */
async function gymRow(gymId, cols = 'id, name') {
  const id = Number.parseInt(gymId, 10);
  if (!Number.isInteger(id)) return null;
  const { rows } = await pool.query(`SELECT ${cols} FROM gyms WHERE id = $1`, [id]).catch(() => ({ rows: [] }));
  return rows[0] || null;
}

const AMENITY_COLUMNS = [
  ['has_locker', 'Lockers', 'locker_free'],
  ['has_towel', 'Towels', 'towel_free'],
  ['has_shower', 'Showers', 'shower_free'],
  ['has_changing_room', 'Changing room', null],
  ['has_hair_dryer', 'Hair dryer', null],
  ['has_music_system', 'Music', null],
  ['has_sauna', 'Sauna', null],
  ['has_wifi', 'WiFi', null],
  ['has_parking', 'Parking', null],
  ['has_water_fountain', 'Water fountain', null],
];

const tools = {
  get_schedule: {
    write: false,
    schema: {
      name: 'get_schedule',
      description:
        "A gym's opening hours and any closures or changed hours over the coming days, with each date's weekday. " +
        'Use when the customer asks if or when a gym is open, or wants to book "next Friday" / "the 20th" — it replaces the calendar. Never guess a date or an opening time.',
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'integer', description: 'The gym id from find_gyms.' },
          days: { type: 'integer', description: 'How many days ahead to cover (1–90). Default 14.' },
        },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const gym = await gymRow(args.gymId, 'id, name, opening_hours, is_24h');
      if (!gym) return { ok: false, message: "I couldn't find that gym." };
      const days = Math.min(90, Math.max(1, Number.parseInt(args.days, 10) || 14));
      const first = isoDate(0);
      const last = isoDate(days - 1);
      const { rows } = await pool
        .query(
          `SELECT override_date, is_closed, open_time, close_time, reason
             FROM gym_schedule_overrides
            WHERE gym_id = $1 AND override_date BETWEEN $2::date AND $3::date
            ORDER BY override_date`,
          [gym.id, first, last]
        )
        .catch(() => ({ rows: [] }));
      const overrides = rows.map((o) => ({
        date: o.override_date instanceof Date ? o.override_date.toISOString().slice(0, 10) : String(o.override_date).slice(0, 10),
        closed: o.is_closed === true,
        open: o.open_time ? String(o.open_time).slice(0, 5) : null,
        close: o.close_time ? String(o.close_time).slice(0, 5) : null,
        reason: o.reason || null,
      }));
      const closedSet = new Set(overrides.filter((o) => o.closed).map((o) => o.date));
      const dates = [];
      for (let i = 0; i < days; i++) {
        const date = isoDate(i);
        dates.push({ date, weekday: DAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()], closed: closedSet.has(date) });
      }
      return {
        ok: true,
        gym: { id: gym.id, name: gym.name },
        open24h: gym.is_24h === true,
        regularHours: gym.opening_hours || null,
        changes: overrides,
        dates,
        message: overrides.length ? `${gym.name} has ${overrides.length} changed day(s) in that period.` : `${gym.name} has no closures or changed hours in that period.`,
      };
    },
  },

  get_facilities: {
    write: false,
    schema: {
      name: 'get_facilities',
      description: "What a gym has on site — lockers, towels, showers, changing room, sauna, WiFi, parking — and whether each is free. Use for any 'do they have…' question.",
      parameters: {
        type: 'object',
        properties: { gymId: { type: 'integer', description: 'The gym id from find_gyms.' } },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const gym = await gymRow(args.gymId);
      if (!gym) return { ok: false, message: "I couldn't find that gym." };
      const { rows } = await pool.query('SELECT * FROM gym_amenities WHERE gym_id = $1', [gym.id]).catch(() => ({ rows: [] }));
      if (!rows.length) return { ok: true, gym, facilities: [], message: `${gym.name} hasn't listed its facilities yet.` };
      const a = rows[0];
      const facilities = AMENITY_COLUMNS.filter(([col]) => a[col] === true).map(([, name, freeCol]) => ({
        name,
        free: freeCol ? a[freeCol] === true : true,
      }));
      return { ok: true, gym, facilities, message: facilities.length ? `${gym.name} has ${facilities.map((f) => f.name.toLowerCase()).join(', ')}.` : `${gym.name} lists no facilities.` };
    },
  },

  get_reviews: {
    write: false,
    schema: {
      name: 'get_reviews',
      description: "A gym's rating, how many reviews it has, and the most recent (or best / worst) reviews with any owner reply.",
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'integer', description: 'The gym id from find_gyms.' },
          sort: { type: 'string', enum: ['newest', 'highest', 'lowest'], description: 'Default newest.' },
          limit: { type: 'integer', description: 'How many to read back (1–10). Default 5.' },
        },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const gym = await gymRow(args.gymId);
      if (!gym) return { ok: false, message: "I couldn't find that gym." };
      const ORDER = { highest: 'rating DESC, created_at DESC', lowest: 'rating ASC, created_at DESC', newest: 'created_at DESC' };
      const orderBy = ORDER[args.sort] || ORDER.newest;
      const limit = Math.min(10, Math.max(1, Number.parseInt(args.limit, 10) || 5));
      const stats = await pool
        .query('SELECT COUNT(*)::int AS total, COALESCE(AVG(rating), 0)::float AS avg FROM reviews WHERE gym_id = $1', [gym.id])
        .catch(() => ({ rows: [{ total: 0, avg: 0 }] }));
      const { rows } = await pool
        .query(
          `SELECT id, rating, comment, owner_response, created_at,
                  (booking_id IS NOT NULL) AS verified_visit
             FROM reviews WHERE gym_id = $1
            ORDER BY ${orderBy} LIMIT $2`,
          [gym.id, limit]
        )
        .catch(() => ({ rows: [] }));
      const total = stats.rows[0]?.total || 0;
      return {
        ok: true,
        gym,
        totalReviews: total,
        averageRating: total ? Number(Number(stats.rows[0].avg).toFixed(1)) : null,
        reviews: rows.map((r) => ({
          id: r.id,
          rating: r.rating,
          comment: r.comment,
          ownerReply: r.owner_response || null,
          verifiedVisit: r.verified_visit === true,
          date: r.created_at instanceof Date ? r.created_at.toISOString().slice(0, 10) : String(r.created_at || '').slice(0, 10),
        })),
        message: total ? `${gym.name}: ${Number(stats.rows[0].avg).toFixed(1)} stars from ${total} review${total === 1 ? '' : 's'}.` : `${gym.name} has no reviews yet.`,
      };
    },
  },

  leave_review: {
    write: true,
    schema: {
      name: 'leave_review',
      description:
        'Post the customer\'s own review of a gym: a star rating (1–5) and, optionally, what they said. Public and one per gym, so read the rating and words back before calling. Ties to their most recent visit there when one exists.',
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'integer', description: 'The gym id from find_gyms.' },
          rating: { type: 'integer', description: 'Stars, 1 to 5.' },
          comment: { type: 'string', description: 'Their words, as said. Omit if they only gave stars.' },
        },
        required: ['gymId', 'rating'],
        additionalProperties: false,
      },
    },
    async run(userId, args = {}) {
      if (!userId) return { ok: false, message: 'You need to be signed in to leave a review.' };
      const rating = Number.parseInt(args.rating, 10);
      if (!(rating >= 1 && rating <= 5)) return { ok: false, message: 'A rating is 1 to 5 stars — how many?' };
      const gym = await gymRow(args.gymId);
      if (!gym) return { ok: false, message: "I couldn't find that gym." };
      const comment = args.comment ? String(args.comment).trim().slice(0, 1000) : null;

      const dup = await pool.query('SELECT id FROM reviews WHERE user_id = $1 AND gym_id = $2', [userId, gym.id]).catch(() => ({ rows: [] }));
      if (dup.rows.length) return { ok: false, alreadyReviewed: true, reviewId: dup.rows[0].id, message: `You've already reviewed ${gym.name} — one review per gym.` };

      // The screen's 7-day rule: a review tied to a visit must be within 7 days of it.
      // By voice we tie it to the latest qualifying visit, or post it unverified.
      const visit = await pool
        .query(
          `SELECT id FROM bookings
            WHERE user_id = $1 AND gym_id = $2 AND booking_date >= CURRENT_DATE - INTERVAL '7 days' AND booking_date <= CURRENT_DATE
            ORDER BY booking_date DESC LIMIT 1`,
          [userId, gym.id]
        )
        .catch(() => ({ rows: [] }));
      const bookingId = visit.rows[0]?.id || null;

      const { rows } = await pool.query(
        `INSERT INTO reviews (gym_id, user_id, booking_id, rating, comment, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING id`,
        [gym.id, userId, bookingId, rating, comment]
      );
      await pool
        .query(
          `UPDATE gyms SET
             average_rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE gym_id = $1),
             total_reviews = (SELECT COUNT(*) FROM reviews WHERE gym_id = $1),
             updated_at = NOW()
           WHERE id = $1`,
          [gym.id]
        )
        .catch(() => null);
      return { ok: true, reviewId: rows[0].id, gym, rating, verifiedVisit: !!bookingId, message: `Posted your ${rating}-star review of ${gym.name}.` };
    },
  },

  get_gym_photos: {
    write: false,
    schema: {
      name: 'get_gym_photos',
      description: 'Photos and videos customers have posted of a gym (how many, and the latest with the review they came with).',
      parameters: {
        type: 'object',
        properties: {
          gymId: { type: 'integer', description: 'The gym id from find_gyms.' },
          type: { type: 'string', enum: ['photo', 'video'], description: 'Only one kind. Default both.' },
        },
        required: ['gymId'],
        additionalProperties: false,
      },
    },
    async run(_userId, args = {}) {
      const gym = await gymRow(args.gymId);
      if (!gym) return { ok: false, message: "I couldn't find that gym." };
      const params = [gym.id];
      let where = 'rm.gym_id = $1';
      if (args.type === 'photo' || args.type === 'video') {
        params.push(args.type);
        where += ' AND rm.media_type = $2';
      }
      const { rows } = await pool
        .query(
          `SELECT rm.id, rm.media_type,
                  COALESCE(rm.cdn_url, '/api/review-media/file/' || split_part(rm.file_path, '/', -1)) AS url,
                  rm.created_at, r.rating, r.comment
             FROM review_media rm LEFT JOIN reviews r ON r.id = rm.review_id
            WHERE ${where}
            ORDER BY rm.created_at DESC LIMIT 12`,
          params
        )
        .catch(() => ({ rows: [] }));
      const photos = rows.filter((m) => m.media_type === 'photo').length;
      const videos = rows.filter((m) => m.media_type === 'video').length;
      return {
        ok: true,
        gym,
        total: rows.length,
        photos,
        videos,
        media: rows.map((m) => ({ id: m.id, type: m.media_type, url: m.url, rating: m.rating, comment: m.comment })),
        // Describing pictures is not something the voice can do; the tab shows them.
        ui: rows.length ? { action: 'open_gym', gymId: gym.id, section: 'photos' } : undefined,
        message: rows.length ? `${gym.name} has ${photos} photo${photos === 1 ? '' : 's'} and ${videos} video${videos === 1 ? '' : 's'} from customers — on your screen now.` : `Nobody has posted photos of ${gym.name} yet.`,
      };
    },
  },

  add_photo: {
    write: false,
    schema: {
      name: 'add_photo',
      description:
        'The customer wants to add a photo or video of the gym they are looking at. A picture cannot be spoken, so this opens the review form with its camera/photo picker — tell them to tap it.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
    async run(userId) {
      if (!userId) return { ok: false, message: 'You need to be signed in to add a photo.' };
      return { ok: true, handoff: true, ui: { action: 'open_write_review' }, message: 'I have opened the review form — tap the camera to add your photo, and I will carry on from there.' };
    },
  },
};

const PUBLIC_SOCIAL_TOOLS = new Set(['get_schedule', 'get_facilities', 'get_reviews', 'get_gym_photos']);

module.exports = { tools, PUBLIC_SOCIAL_TOOLS, isoDate };
