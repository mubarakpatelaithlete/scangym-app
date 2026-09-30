/**
 * reel-shop.js — "Shop this reel" (owner task 6, 2026-09-30).
 *
 * "scangym home tab all videos Every videos has button like tiktok has shop
 * button on each tiktok video when scrolling."
 *
 * Every reel in the Home frame has a Shop button (reels/index.html). A tap is
 * posted to this document (rails.js forwards {sg:'row-act', key:'shop'}) and
 * opens the shared half sheet over the video, the way TikTok Shop does: the
 * products that match the reel, then everything else in the shop. A product
 * tap opens the shop's own product sheet with its Buy button (_sgShopOpen), so
 * checkout is the one already live on the Shop tab, not a copy of it.
 *
 * When the shop has nothing listed yet, the sheet still sells something real:
 * a gym day pass, plus the way in for creators to list the first product.
 */
(function () {
  'use strict';

  /* Reel categories -> shop categories. Anything unmapped shows the whole shop. */
  var MAP = {
    fitness: 'Workout plans', workout: 'Workout plans', training: 'Workout plans',
    ugc: 'Video programs', cinematic: 'Video programs',
    nutrition: 'Meal guides', meal: 'Meal guides', food: 'Meal guides',
    promo: 'Templates', 'price compare': 'Templates'
  };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function shopCategory(cat) {
    var k = String(cat || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s*videos?$/, '').trim();
    return MAP[k] || '';
  }

  /* Kept a minute, and fetched once while the page is idle, so the sheet
     opens on the tap (task 14: no waiting on the server after a tap). */
  var cache = {};
  function getJSON(url) {
    var c = cache[url];
    if (c && Date.now() - c.t < 60000) return c.p;
    var p = fetch(url, { credentials: 'include' }).then(function (r) { return r.json(); })
      .catch(function () { delete cache[url]; return {}; });
    cache[url] = { t: Date.now(), p: p };
    return p;
  }

  function dayPrice() {
    try { var p = window.sgPrice && window.sgPrice('day'); if (p && p.display) return p.display; } catch (e) {}
    return '';
  }

  function row(p) {
    var cover = p.coverImageUrl
      ? '<img src="' + esc(p.coverImageUrl) + '" alt="" style="width:56px;height:56px;border-radius:12px;object-fit:cover;flex:none">'
      : '<div style="width:56px;height:56px;border-radius:12px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,109,0,.15);font-size:24px">\uD83D\uDCC4</div>';
    return '<button type="button" data-sg-reel-product="' + esc(p.id) + '" style="display:flex;gap:12px;align-items:center;width:100%;text-align:left;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(255,255,255,.04);color:#fff;padding:10px;margin:0 0 10px;cursor:pointer">'
      + cover
      + '<span style="flex:1;min-width:0"><b style="display:block;font-size:14px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.title) + '</b>'
      + '<span style="display:block;color:rgba(255,255,255,.45);font-size:11px;margin-top:2px">@' + esc(p.creatorHandle) + ' \u00b7 ' + esc(p.category) + '</span></span>'
      + '<span style="font-weight:900;color:#FF6D00;font-size:14px;white-space:nowrap">' + esc(p.price) + '</span></button>';
  }

  function emptyState() {
    var price = dayPrice();
    return '<p style="margin:0 0 14px;color:rgba(255,255,255,.6);font-size:13px;line-height:1.5">No products are listed for this reel yet.</p>'
      + '<button type="button" data-sg-reel-go="book" style="width:100%;border:0;border-radius:14px;padding:15px;background:#FF6D00;color:#fff;font-weight:800;font-size:15px;cursor:pointer;margin-bottom:10px">\uD83D\uDCAA Gym day pass' + (price ? ' \u2014 ' + esc(price) : '') + '</button>'
      + '<button type="button" data-sg-reel-go="sell" style="width:100%;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;background:transparent;color:#fff;font-weight:700;font-size:14px;cursor:pointer">\uD83D\uDECD\uFE0F Sell your own digital product</button>';
  }

  function wire(sheetRoot, products) {
    if (!sheetRoot) return;
    sheetRoot.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-sg-reel-product],[data-sg-reel-go]');
      if (!b) return;
      var go = b.getAttribute('data-sg-reel-go');
      if (go) {
        if (typeof window.sgCloseSheet === 'function') window.sgCloseSheet();
        /* Closing the sheet steps history back; switch after that lands, or the
           back step undoes the switch. */
        setTimeout(function () {
          if (typeof window.switchTab === 'function') window.switchTab(go === 'sell' ? 'shop' : 'book');
          if (go === 'sell') setTimeout(function () { if (typeof window._sgShopOpenSell === 'function') window._sgShopOpenSell(); }, 350);
        }, 120);
        return;
      }
      var id = b.getAttribute('data-sg-reel-product');
      var p = products.filter(function (x) { return String(x.id) === id; })[0];
      if (!p || typeof window._sgShopOpen !== 'function' || !window._sgShopState) return;
      /* The shop's own product sheet reads from its state; hand it these. */
      var have = window._sgShopState.products || [];
      if (!have.some(function (x) { return x.id === p.id; })) window._sgShopState.products = have.concat([p]);
      window._sgShopOpen(p.id);
    });
  }

  function open(d) {
    d = d || {};
    var cat = shopCategory(d.category);
    var base = '/api/shop/products?limit=8';
    var first = cat ? getJSON(base + '&category=' + encodeURIComponent(cat)) : Promise.resolve({ products: [] });
    first.then(function (a) {
      var list = (a && a.products) || [];
      if (list.length >= 3) return list;
      return getJSON(base).then(function (b) {
        var seen = {};
        return list.concat((b && b.products) || []).filter(function (p) {
          if (seen[p.id]) return false; seen[p.id] = 1; return true;
        }).slice(0, 8);
      });
    }).then(function (products) {
      var html = '<div id="sg-reel-shop">' + (products.length ? products.map(row).join('') : emptyState()) + '</div>';
      if (typeof window.sgOpenSheet === 'function') {
        window.sgOpenSheet(html, { title: 'Shop this reel', sub: d.title ? String(d.title).slice(0, 60) : 'Digital products from ScanSquad creators', icon: '\uD83D\uDECD\uFE0F' });
      } else if (typeof window._sgShopSimpleSheet === 'function') {
        window._sgShopSimpleSheet(html, {});
      } else { if (typeof window.switchTab === 'function') window.switchTab('shop'); return; }
      wire(document.getElementById('sg-reel-shop'), products);
    });
  }

  window.sgReelShop = open;
  var warm = function () { getJSON('/api/shop/products?limit=8'); };
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 4000 }); else setTimeout(warm, 2500);
})();
