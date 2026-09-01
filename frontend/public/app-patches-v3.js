/**
 * ScanGym App Patches v3 — USP strip.
 *
 * What is left of this file: the one-line trust strip under the tab bar
 * ("No membership needed · Instant QR · Free cancel").
 *
 * What used to be here, and why it is gone:
 *
 *  - #62 live visitor counter: the poller called /api/stats/live-visitors, which
 *    has never existed on the server. Removed earlier; the strip it lived in is
 *    kept because the static copy is the part that was doing the work.
 *
 *  - #75/#76 AI Trainer tab: injected a DOM tab that bypassed SPA routing.
 *    Replaced by the native TrainerTabPage in app.ctr576.js.
 *
 *  - #98/#99/#100 owner quick controls: injected a panel into
 *    `#sg-owner-controls` / `[class*="owner-controls"]` and called
 *    `PUT /api/gym-mgmt/:id/quick-toggle` and `/quick-price`. None of those four
 *    things exist — not the element, not either route. So the panel could never
 *    appear and the buttons could only ever 404. The cost of keeping it was not
 *    zero: it ran a MutationObserver over document.body with subtree:true for
 *    every visitor on every page, for the entire session, waiting for an element
 *    that is never created. Deleted. tests/no-dead-patches.test.js keeps it out.
 *    (If gym owners do want a quick open/closed + price control, the working
 *    version already exists: the Partner tab toggle in batch2.js, which posts to
 *    the real PATCH /api/gym-partner/toggle-active.)
 */
(function(){
'use strict';
function injectStyle(id,css){if(document.getElementById(id))return;var s=document.createElement('style');s.id=id;s.textContent=css;document.head.appendChild(s);}

function initUspStrip(){
  injectStyle('sg-sps-s','#sg-sps{position:relative;z-index:100;background:rgba(255,109,0,.08);border-bottom:1px solid rgba(255,109,0,.15);padding:6px 16px;display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(255,255,255,.7);font-weight:600}');
  setTimeout(function(){var bc=document.querySelector('.sg-tab-content');if(!bc||document.getElementById('sg-sps'))return;var s=document.createElement('div');s.id='sg-sps';s.innerHTML='\u{1F525} <span id="sg-lvt">No membership needed</span> \u00b7 \u26A1 Instant QR \u00b7 \u2705 Free cancel';bc.insertBefore(s,bc.firstChild);},3000);
}

function init(){initUspStrip();}
if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',init);}else{setTimeout(init,600);}
})();
