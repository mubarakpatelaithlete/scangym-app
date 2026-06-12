/**
 * Access Control Service Layer — Tier 2: 24/7 Self-Service Gym Integration
 * 
 * Architecture:
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  ScanGym booking confirmed                                      │
 * │    ├── Gym has Kisi?   → Kisi API → Access Link (time-limited QR)│
 * │    ├── Gym has Salto?  → Seam API → PIN / Mobile Key            │
 * │    ├── Gym has Brivo?  → Seam API → Mobile Credential           │
 * │    └── Gym has none?   → Standard QR (staff verifies)           │
 * │                                                                  │
 * │  All through Seam universal layer OR direct provider APIs        │
 * └──────────────────────────────────────────────────────────────────┘
 * 
 * Supported access systems:
 *   - Kisi (direct API — best gym support, Access Links for day passes)
 *   - Salto KS (via Seam — cloud REST API)
 *   - Brivo (via Seam — cloud REST API)
 *   - GymMaster (via Seam — all-in-one gym software)
 *   - Any Seam-supported system (30+ brands)
 *   - Manual/staff (fallback — existing QR flow)
 */

const SEAM_API_KEY = process.env.SEAM_API_KEY || '';
const KISI_API_KEY = process.env.KISI_API_KEY || '';
const SEAM_BASE = 'https://connect.getseam.com';
const KISI_BASE = 'https://api.kisi.io';

// ═══════════════════════════════════════════════════════════════════
// Seam Universal API Client
// One API to control Kisi, Salto KS, Brivo, Latch, ASSA ABLOY, etc.
// Docs: https://docs.seam.co
// ═══════════════════════════════════════════════════════════════════

class SeamClient {
  constructor(apiKey) {
    this.apiKey = apiKey || SEAM_API_KEY;
    this.baseUrl = SEAM_BASE;
  }

  async _request(method, path, body = null) {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    const data = await res.json();

    if (!res.ok) {
      const err = new Error(`Seam API error: ${res.status} — ${data.error?.message || JSON.stringify(data)}`);
      err.status = res.status;
      err.seamError = data.error;
      throw err;
    }
    return data;
  }

  // List connected access control systems
  async listSystems() {
    return this._request('POST', '/acs/systems/list');
  }

  // Get a specific ACS
  async getSystem(acsSystemId) {
    return this._request('POST', '/acs/systems/get', { acs_system_id: acsSystemId });
  }

  // Create an ACS user (gym visitor)
  async createUser(acsSystemId, { email, fullName, phone, startsAt, endsAt }) {
    return this._request('POST', '/acs/users/create', {
      acs_system_id: acsSystemId,
      email_address: email,
      full_name: fullName,
      phone_number: phone,
      access_schedule: startsAt && endsAt ? {
        starts_at: startsAt,
        ends_at: endsAt,
      } : undefined,
    });
  }

  // Add user to an access group (grants door access)
  async addUserToGroup(acsUserId, accessGroupId) {
    return this._request('POST', '/acs/access_groups/add_user', {
      acs_user_id: acsUserId,
      acs_access_group_id: accessGroupId,
    });
  }

  // Create a credential (PIN, mobile key, or card)
  async createCredential(acsUserId, accessMethod, opts = {}) {
    const body = {
      acs_user_id: acsUserId,
      access_method: accessMethod, // 'code' | 'mobile_key' | 'card'
      ...opts,
    };
    return this._request('POST', '/acs/credentials/create', body);
  }

  // Remove an ACS user (revoke all access)
  async deleteUser(acsUserId) {
    return this._request('POST', '/acs/users/delete', { acs_user_id: acsUserId });
  }

  // List entrances for a system
  async listEntrances(acsSystemId) {
    return this._request('POST', '/acs/entrances/list', { acs_system_id: acsSystemId });
  }

  // Lock/unlock a door directly (for admin-level control)
  async unlockDoor(deviceId) {
    return this._request('POST', '/locks/unlock_door', { device_id: deviceId });
  }

  // List connected devices (doors/locks)
  async listDevices(connectedAccountId) {
    const body = connectedAccountId ? { connected_account_id: connectedAccountId } : {};
    return this._request('POST', '/devices/list', body);
  }

  // ─── Connect Webview (OAuth-style gym owner onboarding) ────────
  // Creates an embeddable/redirect flow where gym owners log into
  // their lock provider (Kisi, Salto, Brivo, etc). Seam handles auth.

  async createConnectWebview(opts = {}) {
    return this._request('POST', '/connect_webviews/create', {
      accepted_providers: opts.accepted_providers || [],
      custom_redirect_url: opts.custom_redirect_url || null,
      custom_redirect_failure_url: opts.custom_redirect_failure_url || null,
      custom_metadata: opts.custom_metadata || {},
      wait_for_device_creation: opts.wait_for_device_creation || false,
    });
  }

  async getConnectWebview(connectWebviewId) {
    return this._request('POST', '/connect_webviews/get', {
      connect_webview_id: connectWebviewId,
    });
  }

  // List ACS systems for a connected account
  async listAcsSystems(connectedAccountId) {
    return this._request('POST', '/acs/systems/list', {
      connected_account_id: connectedAccountId,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Kisi Direct API Client
// Best gym-focused access control. Key feature: Access Links
// Docs: https://docs.kisi.io
// ═══════════════════════════════════════════════════════════════════

class KisiClient {
  constructor(apiKey) {
    this.apiKey = apiKey || KISI_API_KEY;
    this.baseUrl = KISI_BASE;
  }

  async _request(method, path, body = null) {
    const opts = {
      method,
      headers: {
        'Authorization': `KISI-LOGIN ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    const data = await res.json();

    if (!res.ok) {
      const err = new Error(`Kisi API error: ${res.status} — ${JSON.stringify(data)}`);
      err.status = res.status;
      err.kisiError = data;
      throw err;
    }
    return data;
  }

  // ─── Access Links: THE killer feature for day passes ───────────
  // Generates a time-limited QR code + web URL that unlocks the door.
  // No app download needed. User scans QR at Kisi reader → door opens.

  /**
   * Create an Access Link for a day-pass visitor
   * @param {number} groupId - Kisi group ID (the door/area to grant access to)
   * @param {string} email - Visitor's email
   * @param {string} name - Visitor's name
   * @param {Date} startsAt - Access window start
   * @param {Date} endsAt - Access window end (e.g. 24 hours later)
   * @returns {Object} { id, url, qr_url, expires_at }
   */
  async createAccessLink(groupId, { email, name, startsAt, endsAt }) {
    return this._request('POST', '/access_links', {
      access_link: {
        group_id: groupId,
        name: `ScanGym Day Pass — ${name}`,
        email: email,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        // Access link settings
        max_uses: 4,  // entry + exit, with buffer
      },
    });
  }

  // Delete/revoke an access link
  async deleteAccessLink(accessLinkId) {
    return this._request('DELETE', `/access_links/${accessLinkId}`);
  }

  // ─── Cloud Unlock (admin-level, for testing) ──────────────────
  async unlockDoor(lockId) {
    return this._request('POST', `/locks/${lockId}/unlock`);
  }

  // ─── Organization info ────────────────────────────────────────
  async listPlaces() {
    return this._request('GET', '/places');
  }

  async listGroups(placeId) {
    return this._request('GET', `/groups?place_id=${placeId}`);
  }

  async listLocks(placeId) {
    return this._request('GET', `/locks?place_id=${placeId}`);
  }

  // ─── User management (for recurring members) ─────────────────
  async createMember(email, name) {
    return this._request('POST', '/members', {
      member: { email, name },
    });
  }

  async addMemberToGroup(memberId, groupId) {
    return this._request('POST', '/group_memberships', {
      group_membership: { member_id: memberId, group_id: groupId },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Access Provisioning Service
// Called after booking is confirmed to create time-limited credentials
// ═══════════════════════════════════════════════════════════════════

class AccessProvisioningService {
  constructor() {
    this.seam = new SeamClient();
    this.kisi = new KisiClient();
  }

  /**
   * Provision access credentials for a confirmed booking
   * @param {Object} gym - Gym record from DB (with access_system fields)
   * @param {Object} booking - Booking record
   * @param {Object} user - User info { email, name, phone }
   * @returns {Object|null} Access credential info, or null if manual gym
   */
  async provisionAccess(gym, booking, user) {
    const system = gym.access_system;

    if (!system || system === 'manual' || system === 'none') {
      return null; // Use existing staff-verify QR flow
    }

    // Calculate access window (booking time ± buffer)
    const startsAt = new Date(booking.booking_date + 'T' + (booking.start_time || '00:00'));
    const endsAt = booking.end_time
      ? new Date(booking.booking_date + 'T' + booking.end_time)
      : new Date(startsAt.getTime() + 24 * 60 * 60 * 1000); // Default: 24 hours

    // Add 30-min buffer on each side
    startsAt.setMinutes(startsAt.getMinutes() - 30);
    endsAt.setMinutes(endsAt.getMinutes() + 30);

    try {
      switch (system) {
        case 'kisi':
          return await this._provisionKisi(gym, booking, user, startsAt, endsAt);
        case 'salto':
        case 'brivo':
        case 'latch':
        case 'seam':
          return await this._provisionSeam(gym, booking, user, startsAt, endsAt);
        default:
          console.warn(`Unknown access system: ${system} for gym ${gym.id}`);
          return null;
      }
    } catch (err) {
      console.error(`Access provisioning failed for gym ${gym.id} (${system}):`, err.message);
      // Don't block the booking — fall back to manual QR
      return { error: err.message, fallback: 'manual' };
    }
  }

  /**
   * Kisi provisioning — uses Access Links (no app needed)
   */
  async _provisionKisi(gym, booking, user, startsAt, endsAt) {
    const groupId = gym.access_group_id;
    if (!groupId) throw new Error('Gym missing Kisi group_id');

    const accessLink = await this.kisi.createAccessLink(groupId, {
      email: user.email,
      name: user.name || user.email,
      startsAt,
      endsAt,
    });

    return {
      type: 'kisi_access_link',
      provider: 'kisi',
      access_link_id: accessLink.id,
      access_url: accessLink.url,
      access_qr_url: accessLink.qr_url || null,
      pin: null,
      mobile_key: false,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      instructions: 'Scan this QR code at the gym door reader to unlock. No app download needed.',
    };
  }

  /**
   * Seam provisioning — universal API for Salto, Brivo, Latch, etc.
   */
  async _provisionSeam(gym, booking, user, startsAt, endsAt) {
    const acsSystemId = gym.access_system_id;
    const accessGroupId = gym.access_group_id;
    if (!acsSystemId) throw new Error('Gym missing Seam acs_system_id');

    // 1. Create temporary ACS user
    const userResult = await this.seam.createUser(acsSystemId, {
      email: user.email,
      fullName: user.name || user.email,
      phone: user.phone,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    const acsUser = userResult.acs_user;

    // 2. Add to access group (if specified)
    if (accessGroupId) {
      await this.seam.addUserToGroup(acsUser.acs_user_id, accessGroupId);
    }

    // 3. Create credential based on gym's preferred access type
    const accessType = gym.access_type || 'code'; // 'code' | 'mobile_key' | 'card'
    const credResult = await this.seam.createCredential(acsUser.acs_user_id, accessType);
    const credential = credResult.acs_credential;

    return {
      type: `seam_${accessType}`,
      provider: gym.access_system,
      seam_user_id: acsUser.acs_user_id,
      seam_credential_id: credential.acs_credential_id,
      access_url: null,
      access_qr_url: null,
      pin: credential.code || null,
      mobile_key: accessType === 'mobile_key',
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      instructions: accessType === 'code'
        ? `Your door PIN is: ${credential.code}. Enter this at the gym keypad.`
        : accessType === 'mobile_key'
          ? 'A mobile key has been sent to your phone. Hold your phone near the door reader to unlock.'
          : 'Your access card credential has been activated.',
    };
  }

  /**
   * Revoke access — called on booking cancellation or expiry
   */
  async revokeAccess(accessCredential) {
    try {
      if (!accessCredential) return;

      if (accessCredential.type === 'kisi_access_link' && accessCredential.access_link_id) {
        await this.kisi.deleteAccessLink(accessCredential.access_link_id);
      } else if (accessCredential.seam_user_id) {
        await this.seam.deleteUser(accessCredential.seam_user_id);
      }
    } catch (err) {
      console.error('Failed to revoke access:', err.message);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// Singleton + Helpers
// ═══════════════════════════════════════════════════════════════════

let _instance = null;
function getAccessService() {
  if (!_instance) _instance = new AccessProvisioningService();
  return _instance;
}

/**
 * Check if access control integration is configured
 */
function isAccessControlEnabled() {
  return !!(SEAM_API_KEY || KISI_API_KEY);
}

module.exports = {
  SeamClient,
  KisiClient,
  AccessProvisioningService,
  getAccessService,
  isAccessControlEnabled,
};
