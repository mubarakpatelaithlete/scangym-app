/**
 * "Accepting bookings" is `is_accepting_bookings`. Never `is_active`.
 *
 * The gyms table has both, and they mean different things:
 *
 *   is_accepting_bookings  the owner's own open/pause toggle. Search reads it
 *                          (liveSearch.js) and the owner dashboard writes it
 *                          (owner.js) — this is what "pause my bookings" means.
 *   is_active              whether the listing is live at all: claim confirmed,
 *                          suspended for strikes, deactivated by an admin
 *                          (gym-partner.js).
 *
 * partner-tools.js `set_bookings_open` used to write `is_active`. So an owner who
 * told the assistant "pause new bookings" flipped the *suspension* flag instead:
 * search kept sending them customers (it reads the other column), while their gym
 * quietly looked deactivated in the partner dashboards. Two columns one word apart,
 * and no error either way — the query succeeds, it just changes the wrong thing.
 *
 * This test pins the assistant to the same column the rest of the product uses.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the partner assistant reads and writes is_accepting_bookings', () => {
  const src = read('server/lib/partner-tools.js');

  assert.ok(
    /UPDATE gyms SET is_accepting_bookings/.test(src),
    'set_bookings_open must write is_accepting_bookings'
  );
  assert.ok(
    /SELECT[^`]*is_accepting_bookings[^`]*FROM gyms/s.test(src),
    'resolveGym must read is_accepting_bookings'
  );
});

test('the partner assistant never touches gyms.is_active', () => {
  const src = read('server/lib/partner-tools.js');
  assert.equal(
    /\bis_active\b/.test(src),
    false,
    'is_active is the suspension flag — the assistant must not set it'
  );
});

test('assistant and owner dashboard write the same column', () => {
  const owner = read('server/routes/owner.js');
  const tools = read('server/lib/partner-tools.js');

  const column = (src) => {
    const m = src.match(/UPDATE gyms SET (is_[a-z_]+)\s*=\s*\$1[^`]*?(?:WHERE|RETURNING)/s);
    return m && m[1];
  };

  assert.equal(
    column(tools),
    column(owner),
    'the assistant and the dashboard must mean the same thing by "open"'
  );
});
