/**
 * Guest checkout — buy a pass with a card and an email, no account.
 *
 * The whole thing already existed on the server and nothing could reach it:
 *
 *   POST /api/bookings/guest-create   creates a pending booking from an email
 *   POST /api/payment/create-intent   works with no session at all
 *   POST /api/payment/confirm-intent  issues the QR and emails the pass
 *
 * The web app never called the first one, and the one place that came close —
 * the /checkout landing page's Pay button — ended by opening the sign-in sheet
 * instead of taking the money. So a visitor with a card in their hand had no
 * way to spend it, which is the most expensive bug a marketplace can have.
 *
 * This file is that missing path, and only that: three requests, a Stripe card
 * field, and a pass on screen and in an inbox. Sign-in is offered *after* the
 * purchase ("save this pass to an account"), where it costs nothing.
 *
 * The amount on the button is always the amount the server returned for the
 * booking — never a number this file worked out — so the displayed price is the
 * charged price by construction.
 */
(function () {
  'use strict';

  var GUEST_CREATE = '/api/bookings/guest-create';
  var CREATE_INTENT = '/api/payment/create-intent';
  var CONFIRM_INTENT = '/api/payment/confirm-intent';
  var GUEST_LOOKUP = '/api/bookings/guest-lookup';
  var SEND_LINK = '/api/auth/send-link';

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  function today() { return new Date().toISOString().split('T')[0]; }

  function post(url, body, fetchImpl) {
    return (fetchImpl || fetch)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        return { ok: r.ok, status: r.status, data: d || {} };
      });
    });
  }

  /* ── The flow, with every dependency injectable so it can be tested ── */

  async function createBooking(opts, deps) {
    deps = deps || {};
    var res = await post(GUEST_CREATE, {
      gymId: opts.gymId,
      date: opts.date || today(),
      time: opts.time || 'anytime',
      email: opts.email,
      name: opts.name || 'Guest',
      passType: opts.passType || 'Day Pass',
      referral_code: opts.referralCode || undefined,
    }, deps.fetch);
    if (!res.ok || !res.data || !res.data.booking) {
      return { ok: false, message: (res.data && (res.data.message || res.data.error)) || 'We could not hold that booking. Try again.' };
    }
    var b = res.data.booking;
    return { ok: true, bookingId: b.id, bookingCode: b.bookingCode, amount: b.price, currency: b.currency, gymName: b.gymName };
  }

  async function startPayment(bookingId, email, deps) {
    deps = deps || {};
    var res = await post(CREATE_INTENT, { bookingId: bookingId, email: email }, deps.fetch);
    if (!res.ok || !res.data || !res.data.clientSecret) {
      return { ok: false, message: (res.data && res.data.error) || 'We could not start the payment. Try again.' };
    }
    return { ok: true, clientSecret: res.data.clientSecret, amount: res.data.amount, gymName: res.data.gymName };
  }

  async function finish(bookingId, paymentIntentId, email, deps) {
    deps = deps || {};
    var res = await post(CONFIRM_INTENT, { bookingId: bookingId, paymentIntentId: paymentIntentId, email: email }, deps.fetch);
    if (!res.ok || !res.data || !res.data.success) {
      /* The money may already be taken at this point, so never imply it was not. */
      return { ok: false, message: 'Your payment went through but we could not show the pass. Check your email — it is on its way.' };
    }
    return { ok: true, booking: res.data.booking, qr: res.data.qr, access: res.data.access };
  }

  /**
   * Pay for a booking that already exists (the /checkout landing page).
   * `confirmCard` is the Stripe call, injected so tests never touch Stripe.
   */
  async function payExisting(bookingId, email, confirmCard, deps) {
    var started = await startPayment(bookingId, email, deps);
    if (!started.ok) return started;
    var confirmed = await confirmCard(started.clientSecret, email);
    if (!confirmed || confirmed.error || !confirmed.paymentIntent) {
      return { ok: false, message: (confirmed && confirmed.error && confirmed.error.message) || 'That card was declined.' };
    }
    return finish(bookingId, confirmed.paymentIntent.id, email, deps);
  }

  /** The full guest purchase: booking, intent, card, pass. */
  async function buy(opts, confirmCard, deps) {
    var booked = await createBooking(opts, deps);
    if (!booked.ok) return booked;
    var paid = await payExisting(booked.bookingId, opts.email, confirmCard, deps);
    if (!paid.ok) return paid;
    paid.bookingCode = booked.bookingCode;
    paid.amount = booked.amount;
    return paid;
  }

  /* ── UI ───────────────────────────────────────────────────────────────
   * Two steps on purpose. Step one takes an email and creates the booking;
   * step two shows what the *server* said that booking costs, next to the card
   * field. So the number on the Pay button is never a number this file worked
   * out from a day rate — it is the amount that will be charged.
   */

  var _stripe = null;
  var _card = null;
  var _ctx = null;   // { container, opts, booking }

  function el(id) { return document.getElementById(id); }

  function say(msg) {
    var e = el('sg-guest-err');
    if (e) { e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }
  }

  function busy(btnId, on, label) {
    var b = el(btnId);
    if (!b) return;
    b.disabled = !!on;
    b.style.opacity = on ? '.6' : '1';
    if (label) b.innerHTML = label;
  }

  var FIELD = 'width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);' +
    'border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:14px 16px;' +
    'color:#fff;font-size:16px;outline:none;margin-bottom:10px';
  var GREEN = 'width:100%;padding:16px;border:none;border-radius:14px;font-size:16px;' +
    'font-weight:800;color:#fff;background:linear-gradient(135deg,#22c55e,#16a34a);cursor:pointer';
  var SMALL = 'color:rgba(255,255,255,.3);font-size:11px;text-align:center;margin-top:12px';

  /* Stripe.js is loaded lazily elsewhere in the app (on scroll/touch or when
     the native sheet opens). Someone arriving at /checkout from a chatbot link
     and tapping Pay straight away had no window.Stripe yet, so the card form
     said "Card payments are unavailable right now". Load it ourselves. */
  var _stripeJs = null;
  function loadStripeJs() {
    if (typeof window.Stripe === 'function') return Promise.resolve();
    if (_stripeJs) return _stripeJs;
    _stripeJs = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.async = true;
      s.onload = resolve;
      s.onerror = resolve;
      document.head.appendChild(s);
      setTimeout(resolve, 10000);
    });
    return _stripeJs;
  }

  async function ensureStripe() {
    if (_stripe) return _stripe;
    await loadStripeJs();
    if (typeof window.Stripe !== 'function') return null;
    var key = window._sgStripePublishableKey;
    if (!key && window.__configPromise) {
      try { var c = await window.__configPromise; key = c && c.stripeKey; window._sgStripePublishableKey = key; } catch (e) {}
    }
    if (!key) return null;
    _stripe = window.Stripe(key);
    return _stripe;
  }

  function mountCard() {
    if (!_stripe || !el('sg-guest-card')) return false;
    var elements = _stripe.elements();
    _card = elements.create('card', {
      style: { base: { color: '#fff', fontSize: '16px', '::placeholder': { color: 'rgba(255,255,255,.3)' } },
        invalid: { color: '#f87171' } },
    });
    _card.mount('#sg-guest-card');
    return true;
  }

  function confirmWithStripe(clientSecret, email) {
    if (!_stripe || !_card) return Promise.resolve({ error: { message: 'Card form not ready — reload and try again.' } });
    return _stripe.confirmCardPayment(clientSecret, {
      payment_method: { card: _card, billing_details: { email: email } },
    });
  }

  function money(amount, currency) {
    var sym = currency === 'USD' ? '$' : currency === 'EUR' ? '\u20ac' : currency === 'INR' ? '\u20b9' : '\u00a3';
    return sym + Number(amount || 0).toFixed(2);
  }

  /* Step 1 — who gets the pass. */
  function emailStepHtml(opts) {
    return '' +
      '<div style="text-align:center;margin-bottom:14px">' +
      '<div style="color:#fff;font-size:21px;font-weight:800">Pay and go</div>' +
      '<div style="color:rgba(255,255,255,.45);font-size:13px;margin-top:4px">' +
      'No account needed \u2014 your QR pass arrives by email.</div></div>' +
      (opts.gymName ? '<div style="color:rgba(255,255,255,.6);font-size:13px;text-align:center;margin-bottom:12px">'
        + opts.gymName + '</div>' : '') +
      '<input id="sg-guest-email" type="email" inputmode="email" autocomplete="email" ' +
      'placeholder="you@email.com" style="' + FIELD + '">' +
      '<div id="sg-guest-err" style="display:none;color:#f87171;font-size:13px;text-align:center;margin-bottom:8px"></div>' +
      '<button id="sg-guest-next" type="button" style="' + GREEN + '">Continue \u2192</button>' +
      '<div style="' + SMALL + '">We only use it to send the pass and your receipt.</div>' +
      '<div id="sg-guest-signin" style="color:rgba(255,255,255,.45);font-size:12px;text-align:center;' +
      'margin-top:10px;cursor:pointer">Rather sign in first?</div>';
  }

  /* Step 2 — the amount the server will charge, and a card. */
  function payStepHtml(b, email) {
    var amount = money(b.amount, b.currency);
    return '' +
      '<div style="text-align:center;margin-bottom:14px">' +
      '<div style="color:#fff;font-size:21px;font-weight:800">' + amount + ' \u00b7 ' + (b.gymName || 'Your gym') + '</div>' +
      '<div style="color:rgba(255,255,255,.45);font-size:13px;margin-top:4px">Pass for ' + email + '</div></div>' +
      '<div id="sg-guest-card" style="padding:14px 16px;background:rgba(255,255,255,.06);' +
      'border:1px solid rgba(255,255,255,.12);border-radius:12px;margin-bottom:10px;min-height:20px"></div>' +
      '<div id="sg-guest-err" style="display:none;color:#f87171;font-size:13px;text-align:center;margin-bottom:8px"></div>' +
      '<button id="sg-guest-pay" type="button" style="' + GREEN + '">Pay ' + amount + ' \u2192</button>' +
      '<div style="' + SMALL + '">Free cancellation up to 2 hours before \u00b7 Secured by Stripe</div>';
  }

  function doneHtml(res, email) {
    var qr = res.qr && res.qr.dataUrl;
    var code = res.booking && res.booking.bookingCode;
    return '' +
      '<div style="text-align:center;padding:6px 0">' +
      '<div style="font-size:40px">\uD83C\uDF89</div>' +
      '<div style="color:#fff;font-size:20px;font-weight:800;margin:6px 0 2px">You\u2019re in</div>' +
      '<div style="color:rgba(255,255,255,.5);font-size:13px;margin-bottom:14px">Pass sent to ' + email + '</div>' +
      (qr ? '<img src="' + qr + '" alt="Your entry QR code" style="width:190px;height:190px;background:#fff;border-radius:14px;padding:8px">' : '') +
      (code ? '<div style="color:#4ade80;font-family:monospace;letter-spacing:2px;font-size:15px;font-weight:800;margin-top:12px">'
        + code + '</div>' : '') +
      '<div style="color:rgba(255,255,255,.4);font-size:12px;margin-top:10px">Show this at the door. It is in your email too.</div>' +
      '<button id="sg-guest-save" type="button" style="width:100%;margin-top:16px;padding:14px;border:none;' +
      'border-radius:14px;font-size:15px;font-weight:700;color:#fff;background:rgba(255,255,255,.08);cursor:pointer">' +
      'Save this pass to an account</button>' +
      '<div id="sg-guest-err" style="display:none;color:#f87171;font-size:13px;margin-top:8px"></div></div>';
  }

  function wireDone(res, email) {
    _ctx.container.innerHTML = doneHtml(res, email);
    var save = el('sg-guest-save');
    if (save) save.onclick = async function () {
      save.disabled = true;
      save.textContent = 'Sending a sign-in link\u2026';
      var r = await post(SEND_LINK, { contact: email });
      save.textContent = (r.data && r.data.ok) ? 'Check your email for the link' : 'Could not send the link';
    };
    if (typeof window.sgToast === 'function') window.sgToast('Pass sent to ' + email, 'success', 4000);
  }

  /** Step 2 renderer, shared by the new-booking and existing-booking paths. */
  async function showPayStep(booking, email, onPay) {
    _ctx.booking = booking;
    _ctx.container.innerHTML = payStepHtml(booking, email);
    var s = await ensureStripe();
    if (!s || !mountCard()) {
      say('Card payments are unavailable right now \u2014 please sign in and try again.');
      return false;
    }
    var btn = el('sg-guest-pay');
    if (btn) btn.onclick = onPay;
    return true;
  }

  async function onContinue() {
    var email = ((el('sg-guest-email') || {}).value || '').trim();
    if (!EMAIL_RE.test(email)) { say('That email doesn\u2019t look right \u2014 we need it to send your pass.'); return; }
    say('');
    try { localStorage.setItem('sg_last_email', email); } catch (e) {}
    busy('sg-guest-next', true, 'Holding your slot\u2026');

    var booked = await createBooking({
      gymId: _ctx.opts.gymId, date: _ctx.opts.date, time: _ctx.opts.time,
      passType: _ctx.opts.passType, referralCode: _ctx.opts.referralCode, email: email,
    });
    if (!booked.ok) { busy('sg-guest-next', false, 'Continue \u2192'); say(booked.message); return; }

    await showPayStep(booked, email, async function () {
      busy('sg-guest-pay', true, 'Taking payment\u2026');
      var res = await payExisting(booked.bookingId, email, confirmWithStripe);
      if (!res.ok) { busy('sg-guest-pay', false, 'Pay ' + money(booked.amount, booked.currency) + ' \u2192'); say(res.message); return; }
      wireDone(res, email);
    });
  }

  /**
   * Render guest checkout into a container.
   * opts: { gymId, gymName, date, time, passType, referralCode, onSignIn }
   */
  async function render(container, opts) {
    if (!container) return false;
    _ctx = { container: container, opts: opts || {} };
    container.innerHTML = emailStepHtml(_ctx.opts);
    var next = el('sg-guest-next');
    if (next) next.onclick = onContinue;
    var signin = el('sg-guest-signin');
    if (signin && _ctx.opts.onSignIn) signin.onclick = _ctx.opts.onSignIn;
    var e = el('sg-guest-email');
    try { if (e) e.value = localStorage.getItem('sg_last_email') || ''; } catch (err) {}
    /* Warm Stripe up while they type, so step two is instant. */
    ensureStripe();
    return true;
  }

  /** The /checkout landing page: the booking exists, just take the money. */
  async function payForExistingBooking(bookingId, bookingCode, container) {
    if (!container) return false;
    _ctx = { container: container, opts: {} };
    var lookup = await fetch(GUEST_LOOKUP + '?booking=' + encodeURIComponent(bookingId) +
      '&code=' + encodeURIComponent(bookingCode), { credentials: 'include' })
      .then(function (r) { return r.json(); }).catch(function () { return null; });
    var b = lookup && lookup.booking;
    if (!b) return false;
    var email = b.email || '';
    var booking = { amount: b.price, currency: b.currency || 'GBP', gymName: b.gymName, bookingId: bookingId };
    return showPayStep(booking, email, async function () {
      busy('sg-guest-pay', true, 'Taking payment\u2026');
      var res = await payExisting(bookingId, email, confirmWithStripe);
      if (!res.ok) { busy('sg-guest-pay', false, 'Pay ' + money(b.price, booking.currency) + ' \u2192'); say(res.message); return; }
      wireDone(res, email);
    });
  }

  window.sgGuestCheckout = {
    render: render,
    payForExistingBooking: payForExistingBooking,
    /* Pure flow, exported for tests and for the assistant to reuse. */
    flow: { createBooking: createBooking, startPayment: startPayment, finish: finish,
      payExisting: payExisting, buy: buy },
    endpoints: { GUEST_CREATE: GUEST_CREATE, CREATE_INTENT: CREATE_INTENT,
      CONFIRM_INTENT: CONFIRM_INTENT, SEND_LINK: SEND_LINK },
  };
})();
