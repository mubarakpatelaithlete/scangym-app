/* Task 66 (option C): no orange "Sign in" bar for logged-out visitors. The
   existing sign-in half sheet (red ✕, swipe down, back) opens only when they
   tap something that needs an account — Like, Comment, Follow, Save, Post,
   Create, Buy — and its title says what they were trying to do.
   Kept out of app.ctr576.js, whose size budget is full. */
(function () {
  var T = { like: 'Sign in to like this video', comment: 'Sign in to comment', follow: 'Sign in to follow',
    save: 'Sign in to save', repost: 'Sign in to repost', share: 'Sign in to share', post: 'Sign in to post',
    create: 'Sign in to create', buy: 'Sign in to buy', upload: 'Sign in to upload' };
  function titleFor(a) { return T[a] || null; }
  function retitle(a) {
    var t = titleFor(a), n = 0;
    if (!t) return;
    (function f() {
      var el = document.querySelector('.sg-auth-title');
      if (el && el.textContent !== 'Book it now') { el.textContent = t; return; }
      if (++n < 20) setTimeout(f, 50);
    })();
  }
  function loggedIn() { try { return !!(typeof state !== 'undefined' && state && state.user); } catch (e) { return false; } }
  function wrapAuth() {
    var o = window._sgShowAuthSheet;
    if (typeof o !== 'function') return false;
    if (o.__sgAsk) return true;
    var w = function (mode) {
      var a = window._sgAskAction || (mode === 'reels' ? window._pendingReelsAction : null);
      window._sgAskAction = null;
      var r = o.apply(this, arguments);
      if (a) retitle(a);
      return r;
    };
    w.__sgAsk = true;
    window._sgShowAuthSheet = w;
    return true;
  }
  function wrapBuy() {
    var o = window._sgShopBuy;
    if (typeof o !== 'function') return false;
    if (o.__sgAsk) return true;
    var w = function () { if (!loggedIn()) window._sgAskAction = 'buy'; return o.apply(this, arguments); };
    w.__sgAsk = true;
    window._sgShopBuy = w;
    return true;
  }
  /* One call for any script: sgAskSignIn('post') opens the half sheet titled "Sign in to post". */
  window.sgAskSignIn = function (action) {
    window._sgAskAction = action;
    if (typeof window._sgShowAuthSheet === 'function') window._sgShowAuthSheet(action === 'buy' ? 'book' : 'reels');
    else location.href = '/login';
  };
  function boot() { var a = wrapAuth(), b = wrapBuy(); return a && b; }
  /* Task 158: _sgShopBuy is defined by the sg-shop chunk; wrap it when that loads. */
  if (window.sgOnChunk) window.sgOnChunk('sg-shop', wrapBuy);
  if (!boot()) { var n = 0, t = setInterval(function () { if (boot() || ++n > 40) clearInterval(t); }, 250); }
  window._sgSignInAsk = { titleFor: titleFor };
})();
