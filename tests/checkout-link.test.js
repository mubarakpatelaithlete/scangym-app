'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { checkoutLink, prettyDate } = require('../server/lib/checkout-link');

test('chatbot pay link goes to the real checkout page', () => {
  assert.strictEqual(checkoutLink(227, 'MPN4-MG26'),
    'https://www.scangym.com/checkout?booking=227&code=MPN4-MG26');
  assert.strictEqual(checkoutLink(5, 'AB CD', 'https://scangym.com/'),
    'https://scangym.com/checkout?booking=5&code=AB%20CD');
});

test('never builds the dead /booking/:id/pay route', () => {
  assert.ok(!/\/booking\/\d+\/pay/.test(checkoutLink(227, 'X')));
  assert.strictEqual(checkoutLink(227, ''), 'https://www.scangym.com/bookings');
});

test('dates read like a person wrote them', () => {
  assert.strictEqual(prettyDate('2026-09-24T00:00:00.000Z'), 'Thu 24 Sep 2026');
  assert.strictEqual(prettyDate('tomorrow'), 'tomorrow');
});
