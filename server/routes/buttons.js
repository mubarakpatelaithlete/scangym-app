'use strict';

/**
 * GET /api/buttons — every destination ScanGym can send a customer to, with the
 * live state of each, computed from the environment at request time.
 *
 * The frontend renders whatever this returns; it holds no URL list of its own.
 * That means a credential landing in Railway (or a store listing going public,
 * once its URL is filled into LISTINGS) turns the button on for every customer
 * on their next page load, with no deploy.
 *
 * Never returns a href for a destination that is not ready — the no-dead-links
 * rule is enforced here rather than trusted to each caller.
 */

const express = require('express');
const { resolve, groups } = require('../lib/buttons-catalog');

const router = express.Router();

router.get('/', (req, res) => {
  const items = resolve(process.env);
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    ok: true,
    total: items.length,
    ready: items.filter((i) => i.ready).length,
    groups: groups(process.env),
  });
});

module.exports = router;
