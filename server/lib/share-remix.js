'use strict';
/**
 * "Share & earn" remix links (owner request 2026-09-28).
 *
 * Every creation made in any chatbot gets a second link:
 *   https://www.scangym.com/s/<jobId>
 * A contact who opens it lands in Create with the SAME model, duration,
 * aspect ratio, resolution and prompt already filled in — they only add their
 * own idea/reference and tap Generate. The link carries the creator's
 * affiliate handle (?ref=), which app.ctr576.js stores for 30 days, so
 * whatever that contact goes on to buy is credited to the creator.
 *
 * The handle is looked up server-side from the job's owner, never read from
 * the URL, so a link cannot be re-pointed at someone else's handle.
 *   /s/<id>          → 302 → /creator?mode=…&prompt=…&model=…&ar=…&dur=…&res=…&ref=…
 *   /s/<id>?share=1  → one-tap share page (phone share sheet + WhatsApp /
 *                      Telegram / SMS / email / copy), for the chatbot reply.
 */

const BASE = (process.env.BASE_URL || 'https://www.scangym.com').replace(/\/+$/, '');
const ID_RE = /^[a-f0-9]{8,64}$/i;
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,100}$/;
const KINDS = new Set(['image', 'video', 'audio', 'music']);
const LABEL = { image: 'image', video: 'video', audio: 'voiceover', music: 'music track' };

function shareLink(jobId) {
  return jobId && ID_RE.test(String(jobId)) ? `${BASE}/s/${jobId}` : null;
}

/** The /creator URL a contact lands on. Pure, so it is easy to test. */
function targetFor(job, handle) {
  const p = job.params || {};
  const q = new URLSearchParams();
  q.set('mode', job.kind);
  q.set('prompt', String(job.prompt || '').slice(0, 600));
  if (job.model) q.set('model', String(job.model));
  if (p.aspectRatio) q.set('ar', String(p.aspectRatio));
  if (p.durationSeconds) q.set('dur', String(p.durationSeconds));
  if (p.resolution) q.set('res', String(p.resolution));
  q.set('from', String(job.id));
  if (handle && HANDLE_RE.test(handle)) { q.set('ref', handle); q.set('src', 'remix'); }
  return `/creator?${q.toString()}`;
}

async function loadShare(id, deps = {}) {
  if (!ID_RE.test(String(id || ''))) return null;
  const pool = deps.pool || require('../middleware/db');
  const r = await pool.query(
    `SELECT j.id, j.kind, j.model, j.prompt, j.params, j.video_url AS url,
            COALESCE(NULLIF(u.referral_handle, ''),
              (SELECT slug FROM creator_landing_pages c
                WHERE c.creator_user_id::text = j.user_id::text AND c.is_active = true
                ORDER BY c.created_at ASC LIMIT 1)) AS handle
       FROM squad_video_jobs j
       LEFT JOIN public.users u ON u.id::text = j.user_id::text
      WHERE j.id = $1 AND j.status = 'done'`,
    [String(id)],
  );
  const job = r.rows[0];
  if (!job || !KINDS.has(job.kind)) return null;
  return job;
}

const escHtml = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function sharePage(job) {
  const link = shareLink(job.id);
  const msg = `I made this ${LABEL[job.kind]} on ScanGym. Tap to make your own with the same settings: ${link}`;
  const e = encodeURIComponent(msg);
  const btn = (href, label) => `<a class="b" href="${escHtml(href)}">${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Share &amp; earn · ScanGym</title><meta name="robots" content="noindex">
<style>body{margin:0;font-family:system-ui,sans-serif;background:#0b1220;color:#e2e8f0;display:flex;justify-content:center}
main{max-width:420px;width:100%;padding:28px 18px}h1{font-size:22px;margin:0 0 6px}p{color:#94a3b8;margin:0 0 18px}
.b{display:block;text-align:center;padding:14px;margin:10px 0;border-radius:12px;background:#16233b;color:#fff;text-decoration:none;font-weight:700;border:0;width:100%;font-size:16px;cursor:pointer}
.p{background:linear-gradient(135deg,#FF6D00,#E66200)}</style></head><body><main>
<h1>💸 Share &amp; earn</h1><p>Send your ${escHtml(LABEL[job.kind])} to your contacts. When they make one or book, you earn.</p>
<button class="b p" id="n">📤 Share with contacts</button>
${btn(`https://wa.me/?text=${e}`, '🟢 WhatsApp')}${btn(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(msg.replace(`: ${link}`, ''))}`, '✈️ Telegram')}
${btn(`sms:?&body=${e}`, '💬 SMS')}${btn(`mailto:?subject=${encodeURIComponent('Made on ScanGym')}&body=${e}`, '✉️ Email')}
<button class="b" id="c">📋 Copy link</button>
<script>var m=${JSON.stringify(msg)},l=${JSON.stringify(link)};
document.getElementById('n').onclick=function(){if(navigator.share){navigator.share({text:m}).catch(function(){})}else{location.href='https://wa.me/?text='+encodeURIComponent(m)}};
document.getElementById('c').onclick=function(){(navigator.clipboard?navigator.clipboard.writeText(l):Promise.reject()).then(function(){document.getElementById('c').textContent='✅ Copied'}).catch(function(){prompt('Copy this link',l)})};
</script></main></body></html>`;
}

/** Express handler for GET /s/:id */
function handler(deps = {}) {
  return async (req, res) => {
    let job = null;
    try { job = await loadShare(req.params.id, deps); } catch (e) { console.error('[ShareRemix] lookup failed:', e.message); }
    if (!job) return res.redirect(302, '/creator');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query && req.query.share) return res.type('html').send(sharePage(job));
    return res.redirect(302, targetFor(job, job.handle));
  };
}

module.exports = { shareLink, targetFor, loadShare, sharePage, handler };
