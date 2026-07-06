/**
 * GymMaster Gatekeeper API Adapter (DIRECT integration)
 * ══════════════════════════════════════════════════════
 * IMPORTANT: GymMaster is NOT available via Seam. The previous assumption
 * in access-control.js was wrong. This adapter talks directly to the
 * documented Gatekeeper API v2:
 *   https://www.gymmaster.com/gymmaster-gatekeeper-api/
 *
 * Auth: HTTP Basic — username = GM site name, password = API key.
 * Both are found by the gym owner in GymMaster under:
 *   Settings > Integrations > Gatekeeper API
 * Store them per-gym in gyms.access_config:
 *   { "gm_site": "mygym", "gm_api_key": "..." }
 *
 * Capabilities (v2 API is read + swipe-decision only):
 *   ✔ testConnection()          - verify credentials (GET /time)
 *   ✔ listDoors()               - doors + reader config (GET /doors)
 *   ✔ getMembers()              - member/tag sync (GET /members)
 *   ✔ verifySwipe()             - real-time access decision (POST /swipe)
 *   ✔ logVisit()                - record a granted/denied entry (POST /log_swipe)
 *   ✘ issueTempCredential()     - NOT supported by Gatekeeper API.
 *     Day-pass issuance for GymMaster gyms needs the main GymMaster API
 *     (member+passcode creation) — Sprint 2. Until then GymMaster gyms
 *     fall back to ScanGym's staff-verified QR flow automatically.
 */

const TIMEOUT_MS = 10000;

class GymMasterClient {
  /**
   * @param {Object} cfg - { gm_site: string, gm_api_key: string }
   */
  constructor(cfg = {}) {
    if (!cfg.gm_site || !cfg.gm_api_key) {
      throw new Error('GymMaster adapter requires access_config.gm_site and access_config.gm_api_key');
    }
    this.site = cfg.gm_site;
    this.baseUrl = `https://${cfg.gm_site}.gymmasteronline.com/gatekeeper_api/v2`;
    this.authHeader = 'Basic ' + Buffer.from(`${cfg.gm_site}:${cfg.gm_api_key}`).toString('base64');
  }

  async _request(method, path, body = null, query = null) {
    let url = this.baseUrl + path;
    if (query) url += '?' + new URLSearchParams(query).toString();
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: { Authorization: this.authHeader, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || (data && data.error)) {
        const err = new Error(`GymMaster API error ${res.status}: ${data.error || res.statusText}`);
        err.status = res.status;
        throw err;
      }
      return data;
    } finally {
      clearTimeout(t);
    }
  }

  /** Verify credentials + connectivity. Returns server time info. */
  async testConnection() {
    return this._request('GET', '/time');
  }

  /** All doors configured at the gym (id, name, reader_type, status...). */
  async listDoors() {
    const data = await this._request('GET', '/doors');
    return data.doors || [];
  }

  /**
   * Members incl. tags + memberships. Supports incremental sync.
   * @param {Object} opts - { memberid?, timestamp?, last_id?, companyid? }
   */
  async getMembers(opts = {}) {
    return this._request('GET', '/members', null, opts);
  }

  /** Membership types + per-door access rosters. */
  async getMembershipTypes() {
    const data = await this._request('GET', '/membershiptypes');
    return data.membershiptypes || [];
  }

  /**
   * Real-time access decision for a tag at a door.
   * @returns {{granted: boolean}}
   */
  async verifySwipe(doorid, cardserial) {
    return this._request('POST', '/swipe', { doorid, cardserial });
  }

  /**
   * Record a visit that was granted/denied outside GymMaster
   * (e.g. ScanGym staff-verified QR check-in) so the gym's
   * attendance reports stay accurate.
   * @param {Object} swipe - { doorid, memberid?, tagserial?, when, access: 1|0, comment? }
   */
  async logVisit(swipe) {
    return this._request('POST', '/log_swipe', { swipe: [swipe] });
  }

  /** What this integration can and cannot do (used by onboarding UI). */
  static capabilities() {
    return {
      provider: 'gymmaster',
      temp_credentials: false, // Gatekeeper API cannot issue day-pass PINs
      swipe_validation: true,
      visit_logging: true,
      member_sync: true,
      fallback: 'manual_qr',
      note: 'Day-pass PIN issuance requires GymMaster main API (Sprint 2).',
    };
  }
}

module.exports = { GymMasterClient };
