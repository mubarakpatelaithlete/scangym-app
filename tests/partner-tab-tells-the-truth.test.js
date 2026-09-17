/**
 * The Partner tab must not promise things the gym cannot do.
 *
 * Found by pressing every Partner control as the signed-in owner of a real
 * claimed gym (17 Sep 2026):
 *   • Picking Salto KS: `create-connect-webview` returned 500, the code fell
 *     back to `connect-seam`, and because that answers `connected: true` (the
 *     API key was stored) the app showed "🎉 All Set! Visitors now get auto
 *     door access with every booking" — while `connection-status` still said
 *     `connected: false` and Seam had found no hardware. The owner learns the
 *     truth when a paying customer is locked out.
 *   • The Partner page loaded its gym from a single setTimeout fired 200ms
 *     after script load. Anyone who opened the Partner tab later — the normal
 *     way in — never triggered it: the header kept the "Tap to set your gym
 *     address" placeholder for an owner with a claimed gym, and
 *     `_partnerGymId` stayed undefined.
 *   • `/api/gym-partner/admin/unclaim` was labelled "dev/testing only" but only
 *     required being signed in: any customer could unclaim any gym, i.e. take
 *     a listing off the owner who runs it.
 *   • The dashboard sent a bare price number and the header defaulted to "£",
 *     so a Bharuch gym priced 104.49 rupees was shown to its owner as £4.49.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const LOCK_FINDER = read('frontend/public/smart-lock-finder.js');
const UX_V5 = read('frontend/public/ux-v5-improvements.js');
const APP = read('frontend/public/app.ctr576.js');
const GYM_PARTNER = read('server/routes/gym-partner.js');

test('"All Set — visitors get auto door access" needs verified hardware, not just a stored key', () => {
  assert.ok(
    /if \(d2\.connected && d2\.verified\)/.test(LOCK_FINDER),
    'the success screen must require verified, not merely connected',
  );
  assert.ok(
    /'pending'\)/.test(LOCK_FINDER),
    'a stored key with no hardware should land on the pending screen',
  );
});

test('there is an honest screen for "key saved, no lock found yet"', () => {
  assert.ok(/pending: \{/.test(UX_V5), 'a pending mode must exist');
  const pending = UX_V5.slice(UX_V5.indexOf('pending: {'), UX_V5.indexOf('requested: {'));
  assert.ok(!/auto door access/i.test(pending), 'pending must not promise door access');
  assert.ok(/no lock hardware yet/i.test(pending), 'pending should say what is missing');
});

test('the Partner page loads its gym whenever the tab is opened, not once at boot', () => {
  assert.ok(/function _sgPartnerPageInit\(\)/.test(APP), 'init must be a named, re-callable function');
  assert.ok(
    /setInterval\(function\(\)\{[\s\S]{0,400}_sgPartnerPageInit\(\)/.test(APP),
    'it must re-run when the partner page appears later',
  );
});

test('unclaiming a gym is admin-only and leaves no half-claimed state', () => {
  assert.ok(
    /'\/admin\/unclaim', authenticateUser, requireAdmin/.test(GYM_PARTNER),
    'any signed-in user could take a gym from its owner — require admin',
  );
  assert.ok(
    /claimed_by = NULL, claimed_at = NULL, is_claimed = FALSE/.test(GYM_PARTNER),
    'clear is_claimed too, or the claim contradiction comes back',
  );
});

test('the partner dashboard sends each gym its own currency', () => {
  assert.ok(/currencySymbol: _gymCurrency\(g\.country\)\.symbol/.test(GYM_PARTNER));
  assert.ok(/function _gymCurrency\(countryCode\)/.test(GYM_PARTNER));
});
