/* Shop extras (Tasks 108/119 batch 4) — kept out of app.ctr576.js, whose core
   size budget is full (tests/code-split.test.js). Wraps the Shop render and adds
   rows on top of it.
   1. 🏆 Top creators (Fiverr / Upwork "Top rated sellers"): tap → seller store. */
(function () {
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function topCreators(items) {
    var cr = {};
    items.forEach(function (x) { var h = x.creatorHandle; if (!h) return; var c = cr[h] = cr[h] || { h: h, n: 0, sold: 0 }; c.n++; c.sold += x.salesCount || 0; });
    return Object.keys(cr).map(function (k) { return cr[k]; }).sort(function (a, b) { return b.sold - a.sold || b.n - a.n; }).slice(0, 10);
  }
  function rowHtml(list) {
    return '<div id="sg-shop-top" style="margin:0 0 14px"><p style="margin:0 0 8px;font-size:15px;font-weight:800">\uD83C\uDFC6 Top creators</p>'
      + '<div style="display:flex;gap:10px;overflow-x:auto;scrollbar-width:none">' + list.map(function (c) {
        return '<button type="button" data-h="' + esc(c.h) + '" style="flex:none;width:96px;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 6px;background:rgba(255,255,255,.04);color:#fff;font-size:12px;font-weight:700;cursor:pointer;text-align:center">'
          + '<span style="display:flex;width:44px;height:44px;margin:0 auto 6px;border-radius:50%;background:#FF6D00;align-items:center;justify-content:center;font-size:18px;font-weight:900">' + esc(c.h.charAt(0).toUpperCase()) + '</span>'
          + '<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">@' + esc(c.h) + '</span>'
          + '<span style="color:rgba(255,255,255,.55);font-size:11px;font-weight:500">' + c.n + ' \u00b7 ' + c.sold + ' sold</span></button>';
      }).join('') + '</div></div>';
  }
  /* 2. Batch 5: \uD83C\uDFF7 Deals under \u00a35 (Amazon "Deals" row). */
  function deals(items) {
    return items.filter(function (x) { return x.pricePence > 0 && x.pricePence <= 500; })
      .sort(function (a, b) { return a.pricePence - b.pricePence; }).slice(0, 12);
  }
  function dealsHtml(list) {
    return '<div id="sg-shop-deals" style="margin:0 0 14px"><p style="margin:0 0 8px;font-size:15px;font-weight:800">\uD83C\uDFF7\uFE0F Deals under \u00a35</p>'
      + '<div style="display:flex;gap:10px;overflow-x:auto;scrollbar-width:none">' + list.map(function (x) {
        return '<button type="button" data-id="' + esc(x.id) + '" style="flex:none;width:120px;border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:8px;background:rgba(255,255,255,.04);color:#fff;font-size:12px;font-weight:700;cursor:pointer;text-align:left">'
          + '<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(x.title || x.name || 'Product') + '</span>'
          + '<span style="color:#FF6D00;font-size:13px;font-weight:900">\u00a3' + (x.pricePence / 100).toFixed(2) + '</span></button>';
      }).join('') + '</div></div>';
  }
  /* 3. Batch 6: \uD83C\uDD95 New arrivals (Amazon) — listed in the last 14 days, newest first. */
  function arrivals(items, now) {
    now = now || Date.now();
    return items.filter(function (x) { var t = Date.parse(x.createdAt); return t && now - t < 14 * 864e5; })
      .sort(function (a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt); }).slice(0, 12);
  }
  /* 4. Batch 7 (Tasks 108/119): \uD83D\uDD25 Best sellers (Amazon) — most sold first. */
  function bestSellers(items) {
    return items.filter(function (x) { return (x.salesCount || 0) > 0; })
      .sort(function (a, b) { return b.salesCount - a.salesCount; }).slice(0, 12);
  }
  /* 5. Batch 8 (Tasks 108/119): \uD83C\uDF81 Free (Amazon/Skool free picks) — free products, newest first. */
  function freebies(items) {
    return items.filter(function (x) { return x.pricePence === 0; })
      .sort(function (a, b) { return (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0); }).slice(0, 12);
  }
  /* 6. Batch 9 (Tasks 108/119): \uD83D\uDCB7 Under \u00a310 (Amazon price bands) — £5.01–£10, cheapest first (under £5 has its own row). */
  function under10(items) {
    return items.filter(function (x) { return x.pricePence > 500 && x.pricePence <= 1000; })
      .sort(function (a, b) { return a.pricePence - b.pricePence; }).slice(0, 12);
  }
  function after() {
    var st = window._sgShopState, box = document.getElementById('sg-digital-shop-results');
    if (!st || !box || st.q || st.category !== 'All' || document.getElementById('sg-shop-top')) return;
    var u10 = under10(st.products || []);
    if (u10.length >= 2 && !document.getElementById('sg-shop-u10')) {
      box.insertAdjacentHTML('afterbegin', dealsHtml(u10).replace('sg-shop-deals', 'sg-shop-u10').replace(/\uD83C\uDFF7\uFE0F Deals under \u00a35/, '\uD83D\uDCB7 Under \u00a310'));
      Array.prototype.forEach.call(box.querySelectorAll('#sg-shop-u10 [data-id]'), function (b) {
        b.addEventListener('click', function () { var id = b.getAttribute('data-id'), x = u10.filter(function (p) { return String(p.id) === id; })[0]; if (x && window._sgShopOpen) window._sgShopOpen(x.id); });
      });
    }
    var fr = freebies(st.products || []);
    if (fr.length >= 2 && !document.getElementById('sg-shop-free')) {
      box.insertAdjacentHTML('afterbegin', dealsHtml(fr).replace('sg-shop-deals', 'sg-shop-free').replace(/\uD83C\uDFF7\uFE0F Deals under \u00a35/, '\uD83C\uDF81 Free'));
      Array.prototype.forEach.call(box.querySelectorAll('#sg-shop-free [data-id]'), function (b) {
        b.addEventListener('click', function () { var id = b.getAttribute('data-id'), x = fr.filter(function (p) { return String(p.id) === id; })[0]; if (x && window._sgShopOpen) window._sgShopOpen(x.id); });
      });
    }
    var bs = bestSellers(st.products || []);
    if (bs.length >= 2 && !document.getElementById('sg-shop-best')) {
      box.insertAdjacentHTML('afterbegin', dealsHtml(bs).replace('sg-shop-deals', 'sg-shop-best').replace(/\uD83C\uDFF7\uFE0F Deals under \u00a35/, '\uD83D\uDD25 Best sellers'));
      Array.prototype.forEach.call(box.querySelectorAll('#sg-shop-best [data-id]'), function (b) {
        b.addEventListener('click', function () { var id = b.getAttribute('data-id'), x = bs.filter(function (p) { return String(p.id) === id; })[0]; if (x && window._sgShopOpen) window._sgShopOpen(x.id); });
      });
    }
    var na = arrivals(st.products || []);
    if (na.length >= 2 && !document.getElementById('sg-shop-new')) {
      box.insertAdjacentHTML('afterbegin', dealsHtml(na).replace('sg-shop-deals', 'sg-shop-new').replace(/\uD83C\uDFF7\uFE0F Deals under \u00a35/, '\uD83C\uDD95 New arrivals'));
      Array.prototype.forEach.call(box.querySelectorAll('#sg-shop-new [data-id]'), function (b) {
        b.addEventListener('click', function () { var id = b.getAttribute('data-id'), x = na.filter(function (p) { return String(p.id) === id; })[0]; if (x && window._sgShopOpen) window._sgShopOpen(x.id); });
      });
    }
    var dl = deals(st.products || []);
    if (dl.length >= 2 && !document.getElementById('sg-shop-deals')) {
      box.insertAdjacentHTML('afterbegin', dealsHtml(dl));
      Array.prototype.forEach.call(box.querySelectorAll('#sg-shop-deals [data-id]'), function (b) {
        b.addEventListener('click', function () { var id = b.getAttribute('data-id'), x = dl.filter(function (p) { return String(p.id) === id; })[0]; if (x && window._sgShopOpen) window._sgShopOpen(x.id); });
      });
    }
    var list = topCreators(st.products || []);
    if (list.length < 2) return;
    box.insertAdjacentHTML('afterbegin', rowHtml(list));
    Array.prototype.forEach.call(box.querySelectorAll('#sg-shop-top [data-h]'), function (b) {
      b.addEventListener('click', function () { if (window._sgShopStore) window._sgShopStore(b.getAttribute('data-h')); });
    });
  }
  function wrap() {
    var orig = window._sgShopRender;
    if (typeof orig !== 'function' || orig.__sgExtras) return false;
    var w = function () { var r = orig.apply(this, arguments); try { after(); } catch (e) {} return r; };
    w.__sgExtras = true;
    window._sgShopRender = w;
    return true;
  }
  if (!wrap()) { var n = 0, t = setInterval(function () { if (wrap() || ++n > 40) clearInterval(t); }, 250); }
  window._sgShopExtras = { topCreators: topCreators, deals: deals, arrivals: arrivals, bestSellers: bestSellers, freebies: freebies, under10: under10 };
})();
