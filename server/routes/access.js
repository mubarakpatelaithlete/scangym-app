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
 *   GET  /api/access/owner/systems         — List available access systems
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
(async () => {
  try {
    // Add access control columns to gyms table
    await pool.query(`
      DO $$ BEGIN
        -- Which access control system the gym uses
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_system') THEN
          ALTER TABLE gyms ADD COLUMN access_system VARCHAR(50) DEFAULT NULL;
          COMMENT ON COLUMN gyms.access_system IS 'kisi | salto | brivo | latch | seam | manual | null';
        END IF;
        
        -- System-specific ID (Seam ACS system ID or Kisi place ID)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_system_id') THEN
          ALTER TABLE gyms ADD COLUMN access_system_id VARCHAR(255) DEFAULT NULL;
        END IF;
        
        -- Access group ID (which doors to unlock)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_group_id') THEN
          ALTER TABLE gyms ADD COLUMN access_group_id VARCHAR(255) DEFAULT NULL;
        END IF;
        
        -- Preferred access type for visitors
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_type') THEN
          ALTER TABLE gyms ADD COLUMN access_type VARCHAR(50) DEFAULT 'qr_unlock';
          COMMENT ON COLUMN gyms.access_type IS 'qr_unlock | pin | mobile_key | staff_verify';
        END IF;
        
        -- Provider-specific API key (encrypted in production)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_api_key') THEN
          ALTER TABLE gyms ADD COLUMN access_api_key TEXT DEFAULT NULL;
        END IF;

        -- Whether access control is active and tested
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gyms' AND column_name='access_verified') THEN
          ALTER TABLE gyms ADD COLUMN access_verified BOOLEAN DEFAULT FALSE;
        END IF;
      END $$;
    `);

    // Table for access credentials issued per booking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_access_credentials (
        id SERIAL PRIMARY KEY,
        booking_id INTEGER NOT NULL,
        gym_id INTEGER NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        
        -- Credential details
        credential_type VARCHAR(50) NOT NULL,
        provider VARCHAR(50) NOT NULL,
        access_link_id VARCHAR(255),
        seam_user_id VARCHAR(255),
        seam_credential_id VARCHAR(255),
        access_url TEXT,
        access_qr_url TEXT,
        pin VARCHAR(20),
        mobile_key BOOLEAN DEFAULT FALSE,
        instructions TEXT,
        
        -- Time window
        starts_at TIMESTAMP NOT NULL,
        ends_at TIMESTAMP NOT NULL,
        
        -- Status tracking
        status VARCHAR(20) DEFAULT 'active',
        revoked_at TIMESTAMP,
        error_message TEXT,
        
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_cred_booking ON booking_access_credentials(booking_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_cred_gym ON booking_access_credentials(gym_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_cred_user ON booking_access_credentials(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_access_cred_status ON booking_access_credentials(status)`);

    console.log('✅ Access control tables ready (Tier 2: Kisi/Seam integration)');
  } catch (err) {
    console.error('Access control migration error:', err.message);
  }
})();


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
      return res.status(400).json({ error: 'Invalid Kisi API key — could not connect', detail: e.message });
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
    res.status(500).json({ error: 'Failed to connect Kisi' });
  }
});

// POST /api/access/owner/connect-seam — Connect via Seam (Salto/Brivo/etc)
router.post('/owner/connect-seam', authenticateUser, async (req, res) => {
  try {
    const { gymId, seamAcsSystemId, accessGroupId, accessType, seamApiKey } = req.body;

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    // Validate Seam connection
    const seam = new SeamClient(seamApiKey || null);
    let system;
    try {
      system = await seam.getSystem(seamAcsSystemId);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid Seam system ID — could not connect', detail: e.message });
    }

    const providerName = system.acs_system?.external_type || 'seam';

    await pool.query(`
      UPDATE gyms SET
        access_system = $1,
        access_system_id = $2,
        access_group_id = $3,
        access_type = $4,
        access_verified = true,
        updated_at = NOW()
      WHERE id = $5
    `, [providerName, seamAcsSystemId, accessGroupId || null, accessType || 'code', gymId]);

    res.json({
      connected: true,
      system: providerName,
      acs_system_id: seamAcsSystemId,
      message: `${providerName} connected via Seam! Day-pass visitors will receive access credentials.`,
    });
  } catch (err) {
    console.error('Seam connection error:', err);
    res.status(500).json({ error: 'Failed to connect via Seam' });
  }
});

// GET /api/access/owner/systems — List available access systems for a gym
router.get('/owner/systems', authenticateUser, async (req, res) => {
  const systems = [
    {
      id: 'kisi',
      name: 'Kisi',
      description: 'Cloud-based access control with QR code door unlock. Best for gyms.',
      setup: 'Enter your Kisi API key — members get time-limited QR codes.',
      features: ['QR code unlock', 'Mobile app unlock', 'PIN codes', 'Apple/Google Wallet'],
      website: 'https://getkisi.com',
      logo: '🔐',
    },
    {
      id: 'salto',
      name: 'Salto KS',
      description: 'Cloud-based smart locks. Connected via Seam.',
      setup: 'Connect your Salto KS account through Seam — members get PIN codes or mobile keys.',
      features: ['PIN codes', 'Mobile credentials', 'Face recognition (XS4 Face)'],
      website: 'https://saltoks.com',
      logo: '🏢',
    },
    {
      id: 'brivo',
      name: 'Brivo',
      description: 'Enterprise cloud access control. Connected via Seam.',
      setup: 'Connect your Brivo account through Seam — members get mobile access passes.',
      features: ['Mobile Pass', 'Card access', 'Video integration'],
      website: 'https://brivo.com',
      logo: '🔑',
    },
    {
      id: 'gymmaster',
      name: 'GymMaster',
      description: 'All-in-one gym management with built-in access control.',
      setup: 'Connect your GymMaster account — RFID and Bluetooth entry managed automatically.',
      features: ['RFID', 'Bluetooth', 'Billing integration', 'Tailgating detection'],
      website: 'https://gymmaster.com',
      logo: '🏋️',
    },
    {
      id: 'manual',
      name: 'Staff Verification',
      description: 'Default mode. Staff scans the ScanGym QR code to verify the booking.',
      setup: 'No setup needed — this is the default.',
      features: ['QR code shown at reception', '2-scan system (entry + exit)'],
      logo: '👤',
    },
  ];

  res.json({ systems });
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
router.post('/owner/create-connect-webview', authenticateUser, async (req, res) => {
  try {
    const { gymId } = req.body;

    // Verify ownership
    const gym = await pool.query(
      'SELECT * FROM gyms WHERE id = $1 AND claimed_by::text = $2::text',
      [gymId, req.user.id]
    );
    if (gym.rows.length === 0) return res.status(403).json({ error: 'Not your gym' });

    const seam = new SeamClient(seamApiKey || null);
    const webview = await seam.createConnectWebview({
      accepted_providers: [
        'kisi', 'salto_ks', 'brivo', 'august', 'yale', 'schlage',
        'kwikset', 'nuki', 'dormakaba_oracode', 'latch',
        'assa_abloy_credential_service', 'pti_storlogix'
      ],
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

    const seam = new SeamClient(seamApiKey || null);

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
