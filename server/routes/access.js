/**
 * Access Control Routes — Tier 2: 24/7 Self-Service Gym Integration
 *
 * Endpoints:
 *   POST /api/access/provision         — Provision access after booking (internal)
 *   POST /api/access/revoke            — Revoke access on cancellation (internal)
 *   GET  /api/access/credential/:bookingId — Get access credential for a booking
 *   GET  /api/access/status/:gymId     — Check if gym has access control
 *
 * Owner Endpoints (gym owners connecting their access system):
 *   POST /api/access/owner/connect-kisi    — Connect Kisi account
 *   POST /api/access/owner/connect-seam    — Connect via Seam (Salto/Brivo/etc)
 *   POST /api/access/owner/connect-gymmaster — Connect GymMaster (direct Gatekeeper API)
 *   POST /api/access/owner/request-integration — Log interest for upcoming integrations
 *   GET  /api/access/owner/systems         — List available access systems (60+ brands)
 *   PUT  /api/access/owner/configure/:gymId — Configure access settings
 *   DELETE /api/access/owner/disconnect/:gymId — Disconnect access system
 *
 * Admin/Debug:
 *   GET  /api/access/admin/stats       — Integration statistics
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser, optionalAuth } = require('../middleware/auth');
const { getAccessService, isAccessControlEnabled, KisiClient, SeamClient } = require('../lib/access-control');

// ═══════════════════════════════════════════════════════════════════
// DB Migration — adds access control columns to gyms table
// Runs once on startup, idempotent
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// POST /api/access/provision — Create access credentials after booking
// Called internally by payment flow after booking is confirmed
// ═══════════════════════════════════════════════════════════════════
router.post('/provision', authenticateUser, async (req, res) => {
  try {
    const { bookingId } = req.body;
    if (!bookingId) return res.status(400).json({ error: 'bookingId required' });

    // Get booking details
    const bookingResult = await pool.query(`
      SELECT b.*, g.access_system, g.access_system_id, g.access_group_id, 
             g.access_type, g.access_api_key, g.access_verified, g.name as gym_name
      FROM public.bookings b
      JOIN public.gyms g ON b.gym_id = g.id
      WHERE b.id = $1 AND b.user_id = $2
    `, [bookingId, req.user.id]);

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];
    const gym = {
      id: booking.gym_id,
      name: booking.gym_name,
      access_system: booking.access_system,
      access_system_id: booking.access_system_id,
      access_group_id: booking.access_group_id,
      access_type: booking.access_type,
      access_api_key: booking.access_api_key,
      access_verified: booking.access_verified,
    };

    // Skip if gym doesn't have access control
    if (!gym.access_system || gym.access_system === 'manual') {
      return res.json({ 
        provisioned: false, 
        access_type: 'staff_verify',
        message: 'This gym uses staff verification — show your QR code at reception.' 
      });
    }

    // Check for existing credential
    const existing = await pool.query(
      'SELECT * FROM booking_access_credentials WHERE booking_id = $1 AND status = $2',
      [bookingId, 'active']
    );
    if (existing.rows.length > 0) {
      return res.json({ provisioned: true, credential: formatCredentialForClient(existing.rows[0]) });
    }

    // Get user info
    const userResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.user.id]);
    const user = userResult.rows[0] || { email: req.user.email, name: req.user.name };

    // Provision access
    const service = getAccessService();
    const credential = await service.provisionAccess(gym, booking, user);

    if (!credential || credential.fallback === 'manual') {
      return res.json({ 
        provisioned: false, 
        access_type: 'staff_verify',
        error: credential?.error,
        message: 'Access system temporarily unavailable — show your QR code at reception.' 
      });
    }

    // Store credential in DB
    await pool.query(`
      INSERT INTO booking_access_credentials
        (booking_id, gym_id, user_id, credential_type, provider,
         access_link_id, seam_user_id, seam_credential_id,
         access_url, access_qr_url, pin, mobile_key, instructions,
         starts_at, ends_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'active')
    `, [
      bookingId, gym.id, req.user.id,
      credential.type, credential.provider,
      credential.access_link_id || null,
      credential.seam_user_id || null,
      credential.seam_credential_id || null,
      credential.access_url || null,
      credential.access_qr_url || null,
      credential.pin || null,
      credential.mobile_key || false,
      credential.instructions || null,
      credential.starts_at, credential.ends_at,
    ]);

    res.json({ provisioned: true, credential: formatCredentialForClient(credential) });
  } catch (err) {
    console.error('Access provisioning error:', err);
    res.status(500).json({ 
      error: 'Access provisioning failed', 
      access_type: 'staff_verify',
      message: 'Could not generate door access — show your QR code at reception instead.'
    });
  }
});


// ═══════════════════════════════════════════════════════════════════
// POST /api/access/revoke — Revoke access on booking cancellation
// ═══════════════════════════════════════════════════════════════════
router.post('/revoke', authenticateUser, async (req, res) => {
  try {
    const { bookingId } = req.body;

    const credResult = await pool.query(
      'SELECT * FROM booking_access_credentials WHERE booking_id = $1 AND status = $2',
      [bookingId, 'active']
    );

    if (credResult.rows.length === 0) {
      return res.json({ revoked: false, message: 'No active credential found' });
    }

    const cred = credResult.rows[0];
    const service = getAccessService();
    await service.revokeAccess(cred);

    await pool.query(
      'UPDATE booking_access_credentials SET status = $1, revoked_at = NOW() WHERE id = $2',
      ['revoked', cred.id]
    );

    res.json({ revoked: true });
  } catch (err) {
    console.error('Access revocation error:', err);
    res.status(500).json({ error: 'Failed to revoke access' });
  }
});


// ═══════════════════════════════════════════════════════════════════
// GET /api/access/credential/:bookingId — Get access info for a booking
// Frontend calls this to show access method on booking confirmation
// ═══════════════════════════════════════════════════════════════════
router.get('/credential/:bookingId', authenticateUser, async (req, res) => {
  try {
    const { bookingId } = req.params;

    const result = await pool.query(`
      SELECT bac.*, g.name as gym_name, g.access_system, g.access_type
      FROM booking_access_credentials bac
      JOIN public.gyms g ON bac.gym_id = g.id
      WHERE bac.booking_id = $1 AND bac.user_id = $2 AND bac.status = 'active'
      ORDER BY bac.created_at DESC LIMIT 1
    `, [bookingId, req.user.id]);

    if (result.rows.length === 0) {
      // Check if gym even has access control
      const gymResult = await pool.query(`
        SELECT g.access_system, g.access_type FROM public.bookings b
        JOIN public.gyms g ON b.gym_id = g.id WHERE b.id = $1
      `, [bookingId]);

      const gym = gymResult.rows[0];
      return res.json({
        has_access_control: !!(gym?.access_system && gym.access_system !== 'manual'),
        credential: null,
        access_type: gym?.access_type || 'staff_verify',
        message: 'Show your booking QR code at reception.',
      });
    }

    const cred = result.rows[0];
    res.json({
      has_access_control: true,
      credential: formatCredentialForClient(cred),
      access_type: cred.credential_type,
      gym_name: cred.gym_name,
    });
  } catch (err) {
    console.error('Get credential error:', err);
    res.status(500).json({ error: 'Failed to fetch access credential' });
  }
});


// ═══════════════════════════════════════════════════════════════════
// GET /api/access/status/:gymId — Check gym access control status
// Frontend uses this to show access method BEFORE booking
// ═══════════════════════════════════════════════════════════════════
router.get('/status/:gymId', optionalAuth, async (req, res) => {
  try {
    const { gymId } = req.params;
    const result = await pool.query(
      'SELECT access_system, access_type, access_verified FROM gyms WHERE id = $1',
      [gymId]
    );

    if (result.rows.length === 0) {
      return res.json({ has_access_control: false, access_type: 'staff_verify' });
    }

    const gym = result.rows[0];
    const hasAccess = !!(gym.access_system && gym.access_system !== 'manual');

    res.json({
      has_access_control: hasAccess,
      access_system: hasAccess ? gym.access_system : null,
      access_type: gym.access_type || 'staff_verify',
      verified: gym.access_verified || false,
      // Display labels for frontend
      access_label: hasAccess
        ? getAccessLabel(gym.access_system, gym.access_type)
        : 'Staff verification at reception',
      access_icon: hasAccess ? '🔓' : '👤',
    });
  } catch (err) {
    console.error('Access status error:', err);
    res.status(500).json({ error: 'Failed to check access status' });
  }
});


// ═══════════════════════════════════════════════════════════════════
// OWNER ENDPOINTS — Gym owners connecting their access system
// ═══════════════════════════════════════════════════════════════════

// POST /api/access/owner/connect-kisi — Connect Kisi to a gym
router.post('/owner/connect-kisi', authenticateUser, async (req, res) => {
  try {
    const { gymId, kisiApiKey, placeId, groupId } = req.body;

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    // Validate Kisi credentials by listing places
    const kisi = new KisiClient(kisiApiKey);
    let places;
    try {
      places = await kisi.listPlaces();
    } catch (e) {
      console.error('[access] kisi connect failed:', e.message);
      return res.status(400).json({ error: 'Invalid API key — could not connect to access system' });
    }

    // Find the right place and group
    let resolvedPlaceId = placeId;
    let resolvedGroupId = groupId;

    if (!resolvedPlaceId && places.length > 0) {
      resolvedPlaceId = places[0].id;
    }

    if (!resolvedGroupId && resolvedPlaceId) {
      const groups = await kisi.listGroups(resolvedPlaceId);
      if (groups.length > 0) resolvedGroupId = groups[0].id;
    }

    // Update gym record
    await pool.query(`
      UPDATE gyms SET
        access_system = 'kisi',
        access_system_id = $1,
        access_group_id = $2,
        access_type = 'qr_unlock',
        access_api_key = $3,
        access_verified = true,
        updated_at = NOW()
      WHERE id = $4
    `, [String(resolvedPlaceId), String(resolvedGroupId), kisiApiKey, gymId]);

    res.json({
      connected: true,
      system: 'kisi',
      place_id: resolvedPlaceId,
      group_id: resolvedGroupId,
      message: 'Kisi connected! Day-pass visitors will receive QR codes that unlock your door.',
    });
  } catch (err) {
    console.error('Kisi connection error:', err);
    res.status(500).json({ error: 'Failed to connect access system' });
  }
});

// POST /api/access/owner/connect-seam — Connect via Seam (Salto/Brivo/etc)
router.post('/owner/connect-seam', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, seamAcsSystemId, accessGroupId, accessType, seamApiKey } = req.body;

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    // Connect to Seam and discover systems
    const seam = new SeamClient(seamApiKey || null);
    let system = null;
    let providerName = 'seam';
    let resolvedSystemId = seamAcsSystemId || null;
    let verified = false;

    // Step 1: If a specific ACS system ID was provided, validate it
    if (seamAcsSystemId) {
      try {
        system = await seam.getSystem(seamAcsSystemId);
        providerName = system.acs_system?.external_type || 'seam';
        verified = true;
      } catch (e) {
        // If the provided ID fails, try listing all systems
        console.warn('[Seam] getSystem failed for', seamAcsSystemId, '- trying listSystems');
      }
    }

    // Step 2: If no valid system yet, discover available systems
    if (!system) {
      try {
        const systemsRes = await seam.listSystems();
        const systems = systemsRes.acs_systems || [];
        if (systems.length > 0) {
          system = systems[0];
          resolvedSystemId = system.acs_system_id;
          providerName = system.external_type || 'seam';
          verified = true;
        }
      } catch (e) {
        console.warn('[Seam] listSystems failed:', e.message);
      }
    }

    // Step 3: Save the connection (even if no ACS systems found yet)
    // Store the API key so we can provision access later when hardware is added
    await pool.query(`
      UPDATE gyms SET
        access_system = $1,
        access_system_id = $2,
        access_group_id = $3,
        access_type = $4,
        access_api_key = $5,
        access_verified = $6,
        updated_at = NOW()
      WHERE id = $7
    `, [
      providerName,
      resolvedSystemId,
      accessGroupId || null,
      accessType || 'code',
      seamApiKey || null,
      verified,
      gymId
    ]);

    if (verified) {
      res.json({
        connected: true,
        verified: true,
        system: providerName,
        acs_system_id: resolvedSystemId,
        message: `${providerName} connected via Seam! Day-pass visitors will receive access credentials.`,
      });
    } else {
      res.json({
        connected: true,
        verified: false,
        system: 'seam',
        message: 'Seam API key saved! No access control hardware detected yet. ' +
          'Once you connect a lock system in your Seam Console (console.seam.co), ' +
          'it will be automatically discovered and activated.',
      });
    }
  } catch (err) {
    console.error('Seam connection error:', err);
    console.error('[access] smart access connect failed:', err.message);
    res.status(500).json({ error: 'Failed to connect smart access system' });
  }
});

// POST /api/access/owner/connect-gymmaster — Connect GymMaster (direct Gatekeeper API)
router.post('/owner/connect-gymmaster', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, gmSite, gmApiKey } = req.body;
    if (!gymId || !gmSite || !gmApiKey) {
      return res.status(400).json({ error: 'gymId, gmSite and gmApiKey are required' });
    }

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    // Test the connection with the GymMaster Gatekeeper API
    const { GymMasterClient } = require('../lib/gymmaster-adapter');
    const gm = new GymMasterClient({ gm_site: gmSite.trim(), gm_api_key: gmApiKey.trim() });

    try {
      const timeResult = await gm.testConnection();
      console.log(`[GymMaster] Connection test OK for ${gmSite}:`, timeResult);
    } catch (e) {
      return res.status(400).json({
        error: 'Could not connect to GymMaster — check your site name and API key.',
        detail: e.message,
      });
    }

    // Test passed — store the connection
    // Use access_config JSONB column (from PR #508 migration) for credentials
    const accessConfig = JSON.stringify({ gm_site: gmSite.trim(), gm_api_key: gmApiKey.trim() });

    await pool.query(`
      UPDATE gyms SET
        access_system = 'gymmaster',
        access_system_id = $1,
        access_type = 'code',
        access_verified = true,
        access_config = $2::jsonb,
        updated_at = NOW()
      WHERE id = $3
    `, [gmSite.trim(), accessConfig, gymId]).catch(async () => {
      // Fallback: access_config column might not exist yet (migration not run)
      await pool.query(`
        UPDATE gyms SET
          access_system = 'gymmaster',
          access_system_id = $1,
          access_type = 'code',
          access_api_key = $2,
          access_verified = true,
          updated_at = NOW()
        WHERE id = $3
      `, [gmSite.trim(), accessConfig, gymId]);
    });

    // Fetch door list for confirmation
    let doorsCount = 0;
    try {
      const doors = await gm.listDoors();
      doorsCount = doors.length;
    } catch (e) { /* non-critical */ }

    res.json({
      connected: true,
      system: 'gymmaster',
      site: gmSite,
      doors_found: doorsCount,
      message: `GymMaster connected! Visit logging is active.${doorsCount ? ' ' + doorsCount + ' door(s) detected.' : ''} Day-pass PIN issuance coming soon.`,
    });
  } catch (err) {
    console.error('GymMaster connection error:', err);
    res.status(500).json({ error: 'Failed to connect GymMaster' });
  }
});

// GET /api/access/owner/systems — Full catalogue of supported access systems
// Includes Seam-routed (60+), direct API, and request-integration brands
router.get('/owner/systems', authenticateUser, async (req, res) => {
  const systems = [
    // ── ⭐ GYM FAVOURITES (Direct + Seam) ─────────────────────────
    { id: 'kisi',       name: 'Kisi',       connection: 'direct', popular: true,  cat: 'gym', tags: ['gym-focused', 'qr-unlock'], website: 'https://getkisi.com',  description: 'Cloud-based access with QR code door unlock — #1 for gyms' },
    { id: 'salto',      name: 'Salto KS',   connection: 'seam',   popular: true,  cat: 'gym', tags: ['uk-popular', 'eu-popular'], website: 'https://saltoks.com',   description: 'Cloud smart locks — UK/EU gyms' },
    { id: 'brivo',      name: 'Brivo',       connection: 'seam',   popular: true,  cat: 'gym', tags: ['us-popular', 'enterprise'], website: 'https://brivo.com',     description: 'Enterprise cloud access — US gyms' },
    { id: 'gymmaster',  name: 'GymMaster',   connection: 'direct', popular: true,  cat: 'gym', tags: ['gym-software'],             website: 'https://gymmaster.com', description: 'All-in-one gym software + Gatekeeper door access' },
    { id: 'paxton',     name: 'Paxton',      connection: 'seam',   popular: true,  cat: 'gym', tags: ['uk-popular'],               website: 'https://paxton.co.uk',  description: 'Very popular in UK gyms — Net2/10' },
    { id: 'dormakaba',  name: 'Dormakaba',   connection: 'seam',   popular: true,  cat: 'gym', tags: ['commercial'],               website: 'https://dormakaba.com', description: 'Commercial locks — popular in gyms' },

    // ── 🔒 SMART LOCKS (via Seam) ─────────────────────────────────
    { id: 'ttlock',      name: 'TTLock / Sifely',  connection: 'seam', popular: false, cat: 'smart', tags: ['budget'], website: 'https://ttlock.com',     description: 'Budget-friendly smart locks — PIN codes' },
    { id: 'yale',        name: 'Yale',              connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://yalehome.com',   description: 'Smart locks — Assure, Linus, Conexis' },
    { id: 'schlage',     name: 'Schlage',            connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://schlage.com',    description: 'Encode WiFi smart deadbolts' },
    { id: 'august',      name: 'August',             connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://august.com',     description: 'WiFi smart locks — retrofit friendly' },
    { id: 'nuki',        name: 'Nuki',               connection: 'seam', popular: false, cat: 'smart', tags: ['eu'],     website: 'https://nuki.io',        description: 'European smart locks — BLE + WiFi' },
    { id: 'tedee',       name: 'Tedee',              connection: 'seam', popular: false, cat: 'smart', tags: ['eu'],     website: 'https://tedee.com',      description: 'Compact smart locks — Bluetooth/WiFi' },
    { id: 'lockly',      name: 'Lockly',             connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://lockly.com',     description: 'PIN Genie rotating keypad' },
    { id: 'ultraloq',    name: 'Ultraloq',           connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://u-tec.com',      description: 'Fingerprint + keypad smart locks' },
    { id: 'igloohome',   name: 'igloohome',          connection: 'seam', popular: false, cat: 'smart', tags: ['offline'],website: 'https://igloohome.co',   description: 'Offline-capable — works without WiFi' },
    { id: 'kwikset',     name: 'Kwikset',            connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://kwikset.com',    description: 'Halo WiFi smart locks' },
    { id: 'level',       name: 'Level',              connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://level.co',       description: 'Invisible smart lock — hidden inside door' },
    { id: 'wyze',        name: 'Wyze',               connection: 'seam', popular: false, cat: 'smart', tags: ['budget'], website: 'https://wyze.com',       description: 'Affordable smart home locks' },
    { id: 'smonet',      name: 'Smonet',             connection: 'seam', popular: false, cat: 'smart', tags: [],         website: 'https://smonetlock.com', description: 'Keyless entry — fingerprint' },
    { id: 'welock',      name: 'Welock',             connection: 'seam', popular: false, cat: 'smart', tags: ['eu'],     website: 'https://welock.com',     description: 'European fingerprint + card locks' },
    { id: '33lock',      name: '33 Lock',            connection: 'seam', popular: false, cat: 'smart', tags: [],         description: 'Smart locks with remote access' },
    { id: '4suites',     name: '4SUITES',            connection: 'seam', popular: false, cat: 'smart', tags: [],         description: 'Hospitality smart locks' },
    { id: 'smartthings', name: 'SmartThings',        connection: 'seam', popular: false, cat: 'smart', tags: [],         description: 'Samsung smart home — locks & sensors' },
    { id: 'switchbot',   name: 'SwitchBot',          connection: 'seam', popular: false, cat: 'smart', tags: [],         description: 'Smart home locks — BLE + WiFi' },
    { id: 'ring',        name: 'Ring',               connection: 'seam', popular: false, cat: 'smart', tags: [],         description: 'Video doorbell + smart locks' },
    { id: 'nest',        name: 'Google Nest',        connection: 'seam', popular: false, cat: 'smart', tags: [],         description: 'Nest × Yale smart locks' },
    { id: 'tapkey',      name: 'Tapkey',             connection: 'request', popular: false, cat: 'smart', tags: ['api'], description: 'NFC + Bluetooth — digital keys for cylinders' },

    // ── 🏢 COMMERCIAL ACCESS CONTROL (via Seam + request) ─────────
    { id: 'avigilon',    name: 'Avigilon Alta / Openpath', connection: 'seam',    popular: false, cat: 'commercial', tags: ['touchless'],  description: 'Touchless wave-to-unlock — REST API' },
    { id: 'latch',       name: 'Latch',                    connection: 'seam',    popular: false, cat: 'commercial', tags: ['multitenant'], description: 'Smart access for multi-tenant buildings' },
    { id: 'assaabloy',   name: 'ASSA ABLOY',               connection: 'seam',    popular: false, cat: 'commercial', tags: ['enterprise'],  description: 'Global leader — Aperio, Incedo, HID' },
    { id: 'hid',         name: 'HID Global',               connection: 'seam',    popular: false, cat: 'commercial', tags: ['enterprise'],  description: 'Enterprise card readers & mobile access' },
    { id: 'allegion',    name: 'Allegion',                  connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Schlage, Von Duprin — commercial hardware' },
    { id: 'honeywell',   name: 'Honeywell',                connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Building automation + access control' },
    { id: '2n',          name: '2N',                        connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'IP intercoms + access — Axis company' },
    { id: 'akiles',      name: 'Akiles',                    connection: 'seam',    popular: false, cat: 'commercial', tags: ['spain'],       description: 'Smart access — popular in Spain' },
    { id: 'verkada',     name: 'Verkada',                   connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Cloud security — cameras + access' },
    { id: 'genetec',     name: 'Genetec',                   connection: 'seam',    popular: false, cat: 'commercial', tags: ['enterprise'],  description: 'Unified security platform' },
    { id: 'lenel',       name: 'Lenel S2',                  connection: 'seam',    popular: false, cat: 'commercial', tags: ['enterprise'],  description: 'Enterprise access — Carrier company' },
    { id: 'pdk',         name: 'ProdataKey (PDK)',          connection: 'request', popular: false, cat: 'commercial', tags: ['api'],         description: 'Cloud access control — open REST API' },
    { id: 'swiftlane',   name: 'Swiftlane',                connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Facial recognition + mobile access' },
    { id: 'pti',         name: 'PTI Security',              connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Self-storage & facility access' },
    { id: 'kantech',     name: 'Kantech',                   connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Tyco/Johnson Controls access' },
    { id: 'doorking',    name: 'DoorKing',                  connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Gate & door entry systems' },
    { id: 'doorbird',    name: 'DoorBird',                  connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'IP video door stations + access' },
    { id: 'iloq',        name: 'iLOQ',                      connection: 'seam',    popular: false, cat: 'commercial', tags: [],              description: 'Self-powered digital locks' },

    // ── 🏋️ GYM SOFTWARE (Open APIs — request) ─────────────────────
    { id: 'perfectgym',  name: 'PerfectGym',           connection: 'request', popular: false, cat: 'gymsw', tags: ['openapi3'],   description: 'Gym software with OpenAPI 3.0 — access + CRM' },
    { id: 'gymdesk',     name: 'Gymdesk',              connection: 'request', popular: false, cat: 'gymsw', tags: ['api'],        description: 'Gym management with door access integrations' },
    { id: 'glofox',      name: 'Glofox / ABC Fitness', connection: 'request', popular: false, cat: 'gymsw', tags: ['api'],        description: 'Member apps + Kisi/Brivo integration' },
    { id: 'clubready',   name: 'ClubReady',            connection: 'request', popular: false, cat: 'gymsw', tags: ['api'],        description: 'Club management with access control APIs' },
    { id: 'mindbody',    name: 'Mindbody',             connection: 'request', popular: false, cat: 'gymsw', tags: ['api'],        description: 'Fitness & wellness platform with access APIs' },
    { id: 'ezfacility',  name: 'EZFacility',           connection: 'request', popular: false, cat: 'gymsw', tags: ['api'],        description: 'Facility management with door integrations' },

    // ── 🔗 CATCH-ALL ──────────────────────────────────────────────
    { id: 'seam',    name: 'Other / Not Listed (60+ brands)', connection: 'seam', popular: false, cat: 'other', tags: ['catch-all'], description: 'Auto-detect via Seam Connect — August, Nuki, and more' },
    { id: 'manual',  name: 'No Smart Lock / Staff Verification', connection: 'none', popular: false, cat: 'other', tags: ['fallback'], description: 'Staff scans ScanGym QR to verify visitors' },
  ];

  res.json({ systems });
});

// POST /api/access/owner/request-integration — Log interest for upcoming integrations
router.post('/owner/request-integration', authenticateUser, express.json(), async (req, res) => {
  try {
    const { gymId, system, email, note } = req.body;
    // Log the request (store in a simple table or just console log for now)
    console.log(`[Integration Request] gym=${gymId} system=${system} email=${email} note=${note} user=${req.user.id}`);

    // Try to store in DB if integration_requests table exists, otherwise just log
    try {
      await pool.query(`
        INSERT INTO integration_requests (gym_id, user_id, system_id, email, note, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `, [gymId, req.user.id, system, email || '', note || '']);
    } catch (e) {
      // Table may not exist yet — that's fine, we logged it above
      console.log('[Integration Request] DB insert skipped (table may not exist):', e.message);
    }

    res.json({ requested: true, system, message: `We've logged your interest in ${system}. We'll reach out when it's ready!` });
  } catch (err) {
    console.error('Integration request error:', err);
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// PUT /api/access/owner/configure/:gymId — Update access settings
router.put('/owner/configure/:gymId', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.params;
    const { accessType, accessGroupId } = req.body;

    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    const updates = [];
    const values = [];
    let idx = 1;

    if (accessType) { updates.push(`access_type = $${idx++}`); values.push(accessType); }
    if (accessGroupId) { updates.push(`access_group_id = $${idx++}`); values.push(accessGroupId); }
    updates.push(`updated_at = NOW()`);
    values.push(gymId);

    await pool.query(
      `UPDATE gyms SET ${updates.join(', ')} WHERE id = $${idx}`,
      values
    );

    res.json({ updated: true });
  } catch (err) {
    console.error('Configure access error:', err);
    res.status(500).json({ error: 'Failed to configure access' });
  }
});

// DELETE /api/access/owner/disconnect/:gymId — Remove access system
router.delete('/owner/disconnect/:gymId', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.params;

    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    await pool.query(`
      UPDATE gyms SET
        access_system = NULL,
        access_system_id = NULL,
        access_group_id = NULL,
        access_type = 'staff_verify',
        access_api_key = NULL,
        access_verified = FALSE,
        updated_at = NOW()
      WHERE id = $1
    `, [gymId]);

    res.json({ disconnected: true, message: 'Access system disconnected. Reverting to staff QR verification.' });
  } catch (err) {
    console.error('Disconnect access error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});


// ═══════════════════════════════════════════════════════════════════
// Admin / Stats
// ═══════════════════════════════════════════════════════════════════
router.get('/admin/stats', authenticateUser, async (req, res) => {
  try {
    const [gymStats, credStats] = await Promise.all([
      pool.query(`
        SELECT access_system, COUNT(*) as count 
        FROM gyms WHERE access_system IS NOT NULL 
        GROUP BY access_system ORDER BY count DESC
      `),
      pool.query(`
        SELECT credential_type, status, COUNT(*) as count 
        FROM booking_access_credentials 
        GROUP BY credential_type, status ORDER BY count DESC
      `),
    ]);

    res.json({
      connected_gyms: gymStats.rows,
      credentials_issued: credStats.rows,
      integration_enabled: isAccessControlEnabled(),
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});


// ═══════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════

function formatCredentialForClient(cred) {
  return {
    type: cred.credential_type || cred.type,
    provider: cred.provider,
    access_url: cred.access_url,
    access_qr_url: cred.access_qr_url,
    pin: cred.pin,
    mobile_key: cred.mobile_key,
    instructions: cred.instructions,
    starts_at: cred.starts_at,
    ends_at: cred.ends_at,
    status: cred.status || 'active',
  };
}

// ═══════════════════════════════════════════════════════════════════
// SEAM CONNECT WEBVIEW — Drop-in OAuth-style flow for gym owners
// Gym owner clicks "Connect Lock System" → Seam handles all the auth
// ═══════════════════════════════════════════════════════════════════

// POST /api/access/owner/create-connect-webview — Create a Seam Connect Webview
// Map ScanGym provider ids (smart-lock-finder.js) → Seam provider keys.
// 'seam' (universal) or an unmapped id → [] which shows Seam's full brand list.
const SEAM_PROVIDER_KEYS = {
  salto: ['salto_ks'],
  brivo: ['brivo'],
  paxton: [],                       // not yet a dedicated Seam key — show full list
  dormakaba: ['dormakaba_oracode'],
  ttlock: ['ttlock'],
  yale: ['yale'],
  schlage: ['schlage'],
  august: ['august'],
  nuki: ['nuki'],
  tedee: ['tedee'],
  lockly: ['lockly'],
  ultraloq: ['ultraloq'],
  igloohome: ['igloohome'],
  kwikset: ['kwikset'],
  wyze: ['wyze'],
  smartthings: ['smartthings'],
  avigilon: ['avigilon_alta'],
  latch: ['latch'],
  assaabloy: ['assa_abloy_credential_service'],
  '4suites': ['four_suites'],
  akiles: ['akiles'],
  '2n': ['two_n'],
};

router.post('/owner/create-connect-webview', authenticateUser, async (req, res) => {
  try {
    const { gymId, provider } = req.body;

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    // Narrow the webview to the brand the owner tapped; 'seam' or unknown → all brands
    const acceptedProviders =
      provider && provider !== 'seam' && SEAM_PROVIDER_KEYS[provider] && SEAM_PROVIDER_KEYS[provider].length
        ? SEAM_PROVIDER_KEYS[provider]
        : [];

    // Use the workspace key from env (SEAM_API_KEY). This handler doesn't take
    // a per-request key, so referencing seamApiKey here throws ReferenceError.
    const seam = new SeamClient();
    const webview = await seam.createConnectWebview({
      accepted_providers: acceptedProviders,
      custom_redirect_url: `${req.protocol}://${req.get('host')}/gympartners-dashboard/connect-access?status=complete&gym_id=${gymId}`,
      custom_redirect_failure_url: `${req.protocol}://${req.get('host')}/gympartners-dashboard/connect-access?status=failed&gym_id=${gymId}`,
      custom_metadata: { gym_id: String(gymId), owner_id: String(req.user.id) },
      wait_for_device_creation: true,
    });

    res.json({
      connect_webview_id: webview.connect_webview.connect_webview_id,
      url: webview.connect_webview.url,
      status: webview.connect_webview.status,
    });
  } catch (err) {
    console.error('Create connect webview error:', err);
    res.status(500).json({ error: 'Failed to create connection flow' });
  }
});

// POST /api/access/owner/complete-connect — Finalize after Seam Connect Webview
router.post('/owner/complete-connect', authenticateUser, async (req, res) => {
  try {
    const { gymId, connectWebviewId } = req.body;

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    const seam = new SeamClient();

    // Get the webview status
    const wv = await seam.getConnectWebview(connectWebviewId);
    if (!wv.connect_webview.login_successful) {
      return res.status(400).json({ error: 'Connection not completed yet', status: wv.connect_webview.status });
    }

    const connectedAccountId = wv.connect_webview.connected_account_id;
    if (!connectedAccountId) {
      return res.status(400).json({ error: 'No connected account found' });
    }

    // List devices from the connected account
    const devices = await seam.listDevices(connectedAccountId);
    const locks = (devices.devices || []).filter(d =>
      d.device_type?.includes('lock') ||
      d.capabilities?.includes('lock') ||
      d.properties?.locked !== undefined
    );

    // List ACS systems from the connected account
    let acsSystems = [];
    try {
      acsSystems = await seam.listAcsSystems(connectedAccountId);
    } catch (e) {
      // Not all providers have ACS systems
    }

    // Determine provider name
    const provider = wv.connect_webview.selected_provider || 'seam';
    const accessType = (provider.includes('kisi') || provider.includes('salto')) ? 'qr_unlock' : 'code';

    // Store first ACS system ID if available
    const acsSystemId = acsSystems.length > 0 ? acsSystems[0].acs_system_id : null;

    // Update gym record
    await pool.query(`
      UPDATE gyms SET
        access_system = $1,
        access_system_id = $2,
        access_type = $3,
        access_verified = true,
        access_api_key = $4,
        updated_at = NOW()
      WHERE id = $5
    `, [
      provider,
      acsSystemId || connectedAccountId,
      accessType,
      connectedAccountId,  /* store connected_account_id for future API calls */
      gymId,
    ]);

    res.json({
      connected: true,
      provider,
      connected_account_id: connectedAccountId,
      locks_found: locks.length,
      acs_systems: acsSystems.length,
      access_type: accessType,
      message: `${provider} connected! Your members will automatically receive door access when they book a day pass.`,
    });
  } catch (err) {
    console.error('Complete connect error:', err);
    res.status(500).json({ error: 'Failed to finalize connection' });
  }
});

// GET /api/access/owner/connection-status/:gymId — Check connection status
router.get('/owner/connection-status/:gymId', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.params;
    const gym = await pool.query(
      `SELECT id, name, access_system, access_system_id, access_type, access_verified
       FROM gyms WHERE id = $1 AND claimed_by::text = $2::text`,
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    const g = gym.rows[0];
    res.json({
      connected: !!g.access_system && g.access_verified,
      system: g.access_system,
      system_id: g.access_system_id,
      access_type: g.access_type,
      verified: g.access_verified,
    });
  } catch (err) {
    console.error('Connection status error:', err);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/access/owner/devices — Connected doors/locks for the owner's gyms
// Optional ?gymId= to scope to one gym. Lists live devices from Seam for
// seam-routed connections; direct providers (kisi/gymmaster) report
// connection status only.
// ═══════════════════════════════════════════════════════════════════
router.get('/owner/devices', authenticateUser, async (req, res) => {
  try {
    const params = [req.user.id];
    let where = `claimed_by::text = $1::text AND access_system IS NOT NULL`;
    if (req.query.gymId) {
      params.push(req.query.gymId);
      where += ` AND id = $2`;
    }
    const gyms = await pool.query(
      `SELECT id, name, access_system, access_api_key, access_verified, access_type
       FROM gyms WHERE ${where} ORDER BY id`,
      params
    );

    const seam = new SeamClient();
    const out = [];
    for (const g of gyms.rows) {
      const entry = {
        gym_id: g.id,
        gym_name: g.name,
        provider: g.access_system,
        verified: !!g.access_verified,
        access_type: g.access_type,
        devices: [],
      };
      const seamRouted = g.access_api_key && !['kisi', 'gymmaster', 'manual'].includes(g.access_system);
      if (seamRouted) {
        try {
          const resp = await seam.listDevices(g.access_api_key);
          entry.devices = (resp.devices || []).map(d => ({
            device_id: d.device_id,
            name: (d.properties && d.properties.name) || d.display_name || 'Smart Lock',
            online: !!(d.properties && d.properties.online),
            locked: d.properties ? d.properties.locked : undefined,
            battery: d.properties && d.properties.battery_level != null
              ? Math.round(d.properties.battery_level * 100)
              : null,
            manufacturer: (d.properties && d.properties.manufacturer) || d.device_type || null,
          }));
        } catch (e) {
          console.error(`Owner devices: Seam list failed for gym ${g.id}:`, e.message);
          entry.error = 'Could not load live device list';
        }
      }
      out.push(entry);
    }
    res.json({ gyms: out });
  } catch (err) {
    console.error('Owner devices error:', err);
    res.status(500).json({ error: 'Failed to load devices' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/access/admin/overview — All gyms with lock connections
// Mirrors the admin-dashboard auth model: restricted to ADMIN_USER_IDS
// when set, otherwise any logged-in user (with a server-side warning).
// ═══════════════════════════════════════════════════════════════════
const ACCESS_ADMIN_IDS = (process.env.ADMIN_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

router.get('/admin/overview', authenticateUser, async (req, res) => {
  try {
    if (ACCESS_ADMIN_IDS.length > 0 && !ACCESS_ADMIN_IDS.includes(String(req.user.id))) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    if (ACCESS_ADMIN_IDS.length === 0) {
      console.warn('[AccessAdmin] ADMIN_USER_IDS not set — /admin/overview visible to ANY logged-in user');
    }

    const gyms = await pool.query(`
      SELECT g.id, g.name, g.city, g.access_system, g.access_type, g.access_verified,
             g.access_api_key, g.updated_at,
             (SELECT COUNT(*)::int FROM booking_access_credentials c WHERE c.gym_id = g.id) AS credentials_issued
      FROM gyms g
      WHERE g.access_system IS NOT NULL
      ORDER BY g.updated_at DESC
    `);

    const seam = new SeamClient();
    const deviceCounts = {};
    const rows = [];
    for (const g of gyms.rows) {
      let deviceCount = null;
      const seamRouted = g.access_api_key && !['kisi', 'gymmaster', 'manual'].includes(g.access_system);
      if (seamRouted) {
        if (deviceCounts[g.access_api_key] === undefined) {
          try {
            const resp = await seam.listDevices(g.access_api_key);
            deviceCounts[g.access_api_key] = (resp.devices || []).length;
          } catch (e) {
            deviceCounts[g.access_api_key] = null;
          }
        }
        deviceCount = deviceCounts[g.access_api_key];
      }
      rows.push({
        gym_id: g.id,
        gym_name: g.name,
        city: g.city,
        provider: g.access_system,
        access_type: g.access_type,
        verified: !!g.access_verified,
        devices: deviceCount,
        credentials_issued: g.credentials_issued,
        connected_at: g.updated_at,
      });
    }

    res.json({ total_connected: rows.length, gyms: rows });
  } catch (err) {
    console.error('Access admin overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

function getAccessLabel(system, type) {
  const labels = {
    kisi: '🔓 QR code unlocks the door — no app needed',
    salto: type === 'code' ? '🔢 PIN code entry' : '📱 Mobile key unlock',
    brivo: '📱 Brivo Mobile Pass',
    gymmaster: '🏋️ GymMaster access',
    seam: type === 'code' ? '🔢 PIN code entry' : '📱 Mobile key unlock',
  };
  return labels[system] || 'Staff verification at reception';
}

module.exports = router;
