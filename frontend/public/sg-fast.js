/* Owner 2026-10-02: "whole webapp is slow". Root cause found: ~16 scripts each
   watch the WHOLE page for changes (MutationObserver on body, subtree) and
   re-scan the DOM on every single change — dozens of times per second while a
   video feed, timers and toasts update. This shim batches those page-wide
   watchers to at most once per frame (how React/Chrome batch layout work),
   so the same fixes still run, just not 50 times in a row. Loaded first. */
(function () {
  'use strict';
  var N = window.MutationObserver;
  if (!N || N.__sgFast) return;
  var raf = window.requestAnimationFrame || function (f) { return setTimeout(f, 16); };
  function M(cb) {
    var self = this, q = [], sched = false;
    self.__co = false; self.__dead = false;
    self.__i = new N(function (recs) {
      if (!self.__co) { cb.call(self, recs, self); return; }
      for (var i = 0; i < recs.length; i++) q.push(recs[i]);
      if (sched) return;
      sched = true;
      raf(function () {
        sched = false;
        if (self.__dead) { q = []; return; }
        var r = q; q = [];
        if (r.length) { try { cb.call(self, r, self); } catch (e) { setTimeout(function () { throw e; }); } }
      });
    });
  }
  M.prototype.observe = function (t, o) {
    this.__dead = false;
    if (o && o.subtree && (t === document.body || t === document.documentElement)) this.__co = true;
    return this.__i.observe(t, o);
  };
  M.prototype.disconnect = function () { this.__dead = true; return this.__i.disconnect(); };
  M.prototype.takeRecords = function () { return this.__i.takeRecords(); };
  M.__sgFast = true;
  window.MutationObserver = M;
  if (window.WebKitMutationObserver) window.WebKitMutationObserver = M;
})();
