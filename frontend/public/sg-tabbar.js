/**
 * ScanGym — shared bottom tab bar for the standalone pages.
 *
 * WHY THIS EXISTS
 * /reels and /scansquad are not rendered by the SPA; they are their own HTML
 * documents. Neither one contained a single reference to `sg-tab-bar`, so the
 * bottom navigation simply vanished when a visitor landed on them. From Reels
 * there was no way back to Book at all except the browser's back button, and
 * ScanSquad offered only a "<-" arrow. Two of the five tabs dead-ended.
 *
 * This renders the same five-item bar those pages were missing, using plain
 * links (the SPA's switchTab() does not exist in these documents), and marks
 * the current tab active from the pathname.
 *
 * The SPA keeps its own richer bar — this is only for documents that have none.
 */
(function () {
  'use strict';

  if (document.querySelector('nav.sg-tab-bar')) return;   // SPA already has one

  var TABS = [
    { key: 'reels', label: 'Reels', href: '/reels', match: /^\/reels/,
      icon: '<rect x="2" y="2" width="20" height="20" rx="4"></rect>' +
            '<line x1="2" y1="8" x2="22" y2="8"></line>' +
            '<line x1="10" y1="2" x2="10" y2="8"></line>' +
            '<polygon points="10 13 16 16 10 19" fill="rgba(255,255,255,.35)" stroke="none"></polygon>' },
    { key: 'book', label: 'Book', href: '/explore', match: /^\/(explore|nearby)?$/,
      icon: '<circle cx="11" cy="11" r="7"></circle>' +
            '<line x1="16.5" y1="16.5" x2="21" y2="21"></line>' +
            '<circle cx="11" cy="11" r="2.5" fill="#FF6D00" stroke="none"></circle>' },
    { key: 'creator', label: 'ScanSquad', href: '/scansquad', match: /^\/(scansquad|creator)/,
      icon: '<rect x="2" y="2" width="20" height="20" rx="4"></rect>' +
            '<circle cx="12" cy="12" r="3" fill="rgba(255,255,255,.3)"></circle>' +
            '<path d="M12 2v4M12 18v4M2 12h4M18 12h4" stroke-width="1.5"></path>' },
    { key: 'partner', label: 'Partner', href: '/partner', match: /^\/partners?/,
      icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"></path>' +
            '<polyline points="9 22 9 12 15 12 15 22"></polyline>' +
            '<circle cx="12" cy="7" r="1.5" fill="rgba(255,255,255,.3)"></circle>' },
    { key: 'more', label: 'Profile', href: '/more/profile', match: /^\/(more|profile)/,
      icon: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>' +
            '<circle cx="12" cy="7" r="4"></circle>' }
  ];

  var CSS =
    '.sg-tab-bar{position:fixed;bottom:0;left:0;right:0;height:56px;' +
      'background:rgba(8,8,18,.98);-webkit-backdrop-filter:blur(24px) saturate(1.8);' +
      'backdrop-filter:blur(24px) saturate(1.8);display:flex;align-items:center;' +
      'justify-content:space-around;border-top:1px solid rgba(255,255,255,.06);' +
      'z-index:9000;padding-bottom:env(safe-area-inset-bottom,0px);box-sizing:content-box}' +
    '.sg-tab-item{display:flex;flex-direction:column;align-items:center;gap:2px;' +
      'cursor:pointer;padding:6px 4px;text-decoration:none;background:none;border:0;' +
      'transition:.25s cubic-bezier(.4,0,.2,1);-webkit-tap-highlight-color:transparent;' +
      '-webkit-user-select:none;user-select:none;touch-action:manipulation}' +
    '.sg-tab-item svg{width:20px;height:20px;stroke:rgba(255,255,255,.4);fill:none;' +
      'stroke-width:1.8;transition:.25s cubic-bezier(.4,0,.2,1)}' +
    '.sg-tab-item .sg-tab-label{font-size:8px;font-weight:600;letter-spacing:.2px;' +
      'color:rgba(255,255,255,.62);transition:.25s cubic-bezier(.4,0,.2,1)}' +
    '.sg-tab-item.active svg{stroke:#FF6D00;filter:drop-shadow(0 0 6px rgba(255,109,0,.35))}' +
    '.sg-tab-item.active .sg-tab-label{color:#FF6D00}' +
    '.sg-tab-item:active{transform:scale(.92)}' +
    '@media (max-height:500px) and (orientation:landscape){' +
      '.sg-tab-bar{height:44px}.sg-tab-item svg{width:16px;height:16px}' +
      '.sg-tab-item .sg-tab-label{font-size:7px}}';

  function render() {
    if (document.querySelector('nav.sg-tab-bar')) return;

    var style = document.createElement('style');
    style.id = 'sg-tabbar-css';
    style.textContent = CSS;
    document.head.appendChild(style);

    var path = location.pathname.replace(/\/+$/, '') || '/';
    var nav = document.createElement('nav');
    nav.className = 'sg-tab-bar';
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Main navigation');

    nav.innerHTML = TABS.map(function (t) {
      var active = t.match.test(path);
      return '<a class="sg-tab-item' + (active ? ' active' : '') + '"' +
        ' role="tab" aria-selected="' + (active ? 'true' : 'false') + '"' +
        ' aria-label="' + t.label + '" href="' + t.href + '">' +
        '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round">' +
        t.icon + '</svg>' +
        '<span class="sg-tab-label">' + t.label + '</span></a>';
    }).join('');

    document.body.appendChild(nav);

    /* Keep the page's own content clear of the bar. */
    var pad = 'calc(56px + env(safe-area-inset-bottom,0px))';
    if (!document.body.style.paddingBottom) {
      document.body.style.paddingBottom = pad;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  window.sgRenderTabBar = render;   // exposed for tests
})();
