-- Sprint 1: per-gym access provider + credentials
-- Idempotent: safe to run more than once.
-- "What controls your front door?" — the single most important
-- qualification field for every gym ScanGym onboards.

ALTER TABLE gyms ADD COLUMN IF NOT EXISTS access_system TEXT;      -- see allowed values below
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS access_system_id TEXT;   -- Seam acs_system_id (Seam-routed providers)
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS access_group_id TEXT;    -- Kisi group id / Seam access group
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS access_type TEXT DEFAULT 'code';  -- code | mobile_key | card
ALTER TABLE gyms ADD COLUMN IF NOT EXISTS access_config JSONB DEFAULT '{}'::jsonb; -- per-provider creds, e.g. {"gm_site":"...","gm_api_key":"..."}

-- Allowed access_system values (enforced in app code, not DB, so we can
-- add providers without migrations):
--   'kisi'       direct API           (US beachhead)
--   'salto'      via Seam             (UK/EU beachhead)
--   'brivo'      via Seam             (US larger independents)
--   'avigilon'   via Seam             (ex-Openpath)
--   'akiles'     via Seam             (Spain beachhead)
--   'ttlock'     via Seam             (covers Sifely + rebadged brands)
--   'igloohome'  via Seam             (APAC/offline PIN)
--   'latch'      via Seam
--   'seam'       generic Seam-connected system
--   'gymmaster'  direct Gatekeeper API (validation + visit logging only for now)
--   'hybridaf'   partnership pending  (store for pipeline, treat as manual)
--   'manual'     staff-verified QR fallback
--   'none'/NULL  unknown — sales team must qualify

CREATE INDEX IF NOT EXISTS idx_gyms_access_system ON gyms (access_system);
