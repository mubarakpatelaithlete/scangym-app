/* Task 156 B5 (owner, 2026-10-02): posting from Home, the TikTok / Tango way.
   71 one obvious "+" on Home  ·  72 two taps to post  ·  73 drafts  ·  74 upload progress.
   Uploads go to /api/creators/upload (reviewed before they show in the feed);
   "Create with AI" opens the Create tab. Drafts stay on this phone (IndexedDB). */
(function () {
  if (window.sgHomePost) return;
  var DB = 'sg-drafts', ST = 'd';
  function db() {
    return new Promise(function (ok, no) {
      if (!window.indexedDB) return no(new Error('no idb'));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(ST, { keyPath: 'id' }); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
    });
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, no) {
        var t = d.transaction(ST, mode), s = t.objectStore(ST), out = fn(s);
        t.oncomplete = function () { ok(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { no(t.error); };
      });
    });
  }
  function drafts() { return tx('readonly', function (s) { return s.getAll(); }).catch(function () { return []; }); }
  function saveDraft(blob, caption) { return tx('readwrite', function (s) { s.put({ id: Date.now(), blob: blob, caption: caption || '', at: new Date().toISOString() }); }); }
  function delDraft(id) { return tx('readwrite', function (s) { s.delete(id); }); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function sheet(html) {
    close();
    var bg = document.createElement('div');
    bg.id = 'sg-hp-sheet';
    bg.style.cssText = 'position:fixed;inset:0;z-index:var(--sg-z-overlay,10000);background:rgba(0,0,0,.35);display:flex;align-items:flex-end;justify-content:center';
    bg.innerHTML = '<div class="sg-glass-sheet" style="width:100%;max-width:520px;border-radius:22px 22px 0 0;padding:16px 16px calc(18px + env(safe-area-inset-bottom));color:#fff;font-family:inherit;max-height:85vh;overflow:auto">'
      + '<div style="display:flex;align-items:center;margin-bottom:12px"><b style="flex:1;font-size:17px">Post</b><button type="button" id="sg-hp-x" aria-label="Close" style="border:0;background:rgba(255,255,255,.14);color:#fff;width:32px;height:32px;border-radius:50%;font-size:16px;cursor:pointer">\u2715</button></div>'
      + html + '</div>';
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    bg.querySelector('#sg-hp-x').onclick = close;
    return bg;
  }
  function close() { var o = document.getElementById('sg-hp-sheet'); if (o) o.remove(); }
  var BTN = 'display:flex;align-items:center;gap:12px;width:100%;box-sizing:border-box;margin:0 0 8px;padding:14px;border-radius:16px;color:#fff;font-size:15px;font-weight:700;text-align:left;cursor:pointer';

  function menu() {
    drafts().then(function (ds) {
      var bg = sheet(
        '<button type="button" class="sg-glass-chip" id="sg-hp-ai" style="' + BTN + '"><span style="font-size:22px">\u2728</span><span>Create with AI<br><small style="font-weight:500;opacity:.65">Type an idea, get a video, tap Post</small></span></button>'
        + '<button type="button" class="sg-glass-chip" id="sg-hp-up" style="' + BTN + '"><span style="font-size:22px">\uD83D\uDCE4</span><span>Upload a video<br><small style="font-weight:500;opacity:.65">From your phone, up to 100MB</small></span></button>'
        + (ds.length ? '<div style="margin:8px 0 6px;font-size:12px;font-weight:800;opacity:.6">\uD83D\uDCDD Drafts (' + ds.length + ')</div><div style="display:flex;gap:8px;overflow-x:auto">'
          + ds.slice(-10).reverse().map(function (d) { return '<div data-d="' + d.id + '" style="flex:none;width:72px;cursor:pointer;text-align:center"><video muted playsinline preload="metadata" style="width:72px;height:96px;object-fit:cover;border-radius:10px;background:#111"></video><div style="font-size:10px;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(d.caption || 'Draft') + '</div></div>'; }).join('') + '</div>' : '')
        + '<input type="file" id="sg-hp-file" accept="video/*" style="display:none">');
      bg.querySelector('#sg-hp-ai').onclick = function () {
        close();
        if (window.parent !== window && window.parent.navigate) window.parent.navigate('/create');
        else if (typeof window.navigate === 'function') window.navigate('/create');
        else location.href = '/create';
      };
      var f = bg.querySelector('#sg-hp-file');
      bg.querySelector('#sg-hp-up').onclick = function () { f.click(); };
      f.onchange = function () { if (f.files && f.files[0]) compose(f.files[0], '', null); };
      ds.forEach(function (d) {
        var t = bg.querySelector('[data-d="' + d.id + '"]');
        if (!t) return;
        t.querySelector('video').src = URL.createObjectURL(d.blob) + '#t=0.1';
        t.onclick = function () { compose(d.blob, d.caption, d.id); };
      });
    });
  }

  function compose(blob, caption, draftId) {
    var url = URL.createObjectURL(blob);
    var bg = sheet(
      '<video src="' + url + '" autoplay loop muted playsinline style="display:block;width:100%;max-height:42vh;object-fit:contain;border-radius:14px;background:#000;margin-bottom:10px"></video>'
      + '<textarea id="sg-hp-cap" maxlength="300" placeholder="Caption + #hashtags" style="width:100%;box-sizing:border-box;height:64px;border-radius:12px;padding:10px;color:#fff;font-size:14px;resize:none;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.18)">' + esc(caption) + '</textarea>'
      + '<div id="sg-hp-prog" style="display:none;margin:10px 0 0"><div style="height:6px;border-radius:3px;background:rgba(255,255,255,.15);overflow:hidden"><div id="sg-hp-bar" style="height:100%;width:0;background:#FF6D00;transition:width .2s"></div></div><div id="sg-hp-pct" style="font-size:12px;opacity:.75;margin-top:4px">Uploading 0%</div></div>'
      + '<div id="sg-hp-err" style="display:none;color:#f87171;font-size:13px;margin-top:8px"></div>'
      + '<div style="display:flex;gap:8px;margin-top:12px"><button type="button" id="sg-hp-draft" class="sg-glass-chip" style="flex:1;padding:14px;border-radius:14px;color:#fff;font-weight:700;font-size:15px;cursor:pointer">\uD83D\uDCDD Save draft</button>'
      + '<button type="button" id="sg-hp-go" style="flex:1.4;padding:14px;border-radius:14px;border:0;background:#FF6D00;color:#fff;font-weight:800;font-size:15px;cursor:pointer">\uD83D\uDE80 Post</button></div>');
    var cap = bg.querySelector('#sg-hp-cap');
    bg.querySelector('#sg-hp-draft').onclick = function () {
      var p = draftId ? delDraft(draftId) : Promise.resolve();
      p.then(function () { return saveDraft(blob, cap.value); }).then(function () { close(); toast('Saved to drafts \uD83D\uDCDD'); }, function () { toast('Could not save the draft on this phone'); });
    };
    bg.querySelector('#sg-hp-go').onclick = function () {
      var go = this;
      go.disabled = true; go.textContent = 'Posting\u2026';
      upload(blob, cap.value, function (pct) {
        bg.querySelector('#sg-hp-prog').style.display = 'block';
        bg.querySelector('#sg-hp-bar').style.width = pct + '%';
        bg.querySelector('#sg-hp-pct').textContent = pct < 100 ? 'Uploading ' + pct + '%' : 'Processing\u2026';
      }).then(function (r) {
        if (draftId) delDraft(draftId);
        close();
        toast((r && r.message) || 'Posted! It shows in the feed after a quick review.');
      }, function (e) {
        go.disabled = false; go.textContent = '\uD83D\uDE80 Try again';
        var er = bg.querySelector('#sg-hp-err'); er.style.display = 'block';
        er.textContent = e === 401 ? 'Sign in to post (your draft is safe \u2014 tap Save draft).' : 'Upload failed \u2014 check your connection and try again.';
        if (e === 401 && window.sgAskSignIn) window.sgAskSignIn('post');
      });
    };
  }

  /* 74: real progress from XHR upload events (fetch has none). */
  function upload(blob, caption, onPct) {
    return new Promise(function (ok, no) {
      var fd = new FormData();
      var name = blob.name || ('scangym-' + Date.now() + (/webm/.test(blob.type) ? '.webm' : '.mp4'));
      fd.append('video', blob, name);
      fd.append('caption', caption || '');
      fd.append('category', 'ScanGym creators');
      var x = new XMLHttpRequest();
      x.open('POST', '/api/creators/upload');
      x.withCredentials = true;
      x.upload.onprogress = function (e) { if (e.lengthComputable) onPct(Math.round(e.loaded * 100 / e.total)); };
      x.onload = function () {
        var d = null; try { d = JSON.parse(x.responseText); } catch (e) {}
        if (x.status === 401) return no(401);
        if (x.status >= 200 && x.status < 300 && d && d.success) { onPct(100); return ok(d); }
        no(x.status);
      };
      x.onerror = function () { no(0); };
      x.send(fd);
    });
  }
  function toast(m) {
    if (typeof window.sgToast === 'function') return window.sgToast(m, 'success', 3500);
    var t = document.createElement('div');
    t.className = 'sg-glass-chip';
    t.textContent = m;
    t.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);z-index:var(--sg-z-toast,11000);padding:10px 16px;border-radius:18px;color:#fff;font-size:14px;font-weight:700';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 3500);
  }

  /* 71: one obvious "+" on Home, top right like Tango. */
  function plus() {
    if (document.getElementById('sg-hp-plus')) return;
    var b = document.createElement('button');
    b.id = 'sg-hp-plus';
    b.type = 'button';
    b.setAttribute('aria-label', 'Post a video');
    b.className = 'sg-glass-chip';
    b.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
    b.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top) + 12px);right:14px;z-index:9990;width:42px;height:42px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0';
    b.onclick = menu;
    /* Sit in the Home top bar, left of Search (live check: fixed position covered the search icon). */
    var srch = document.getElementById('reels-search-button');
    if (srch && srch.parentNode) {
      b.style.cssText = 'flex:0 0 auto;pointer-events:auto;width:40px;height:40px;border-radius:13px;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:0;margin-right:6px';
      srch.parentNode.insertBefore(b, srch);
    } else document.body.appendChild(b);
  }

  window.sgHomePost = { open: menu, compose: compose, upload: upload, drafts: drafts };
  if (document.body) plus(); else document.addEventListener('DOMContentLoaded', plus);
})();
