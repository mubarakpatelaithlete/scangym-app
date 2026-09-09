'use strict';

/**
 * What to say when Twilio will not send the code.
 *
 * Production logs showed two different failures behind one message:
 *
 *   60200  Invalid parameter `To`: +447700900123
 *   60605  The destination phone number has been blocked by Verify
 *          Geo-Permissions. GG is blocked for sms channel for all services
 *
 * The first is the customer's mistake and "check the number" fixes it. The
 * second is ours: the account's Verify geo-permissions do not include their
 * region, so no amount of retrying will ever work — and "Try again" is a lie
 * that costs the sale. A blocked region needs a different door offered in the
 * same breath, and it needs to be loud in the logs, because only a human with
 * the Twilio console can unblock it.
 *
 * Provider text never reaches the visitor: it names our vendor and how we call
 * them, and it tells the customer nothing they can act on.
 */

/* Bad number: the customer can fix this one. */
const INVALID_NUMBER = new Set([
  60200, // Invalid parameter `To`
  21211, // Invalid 'To' phone number
  60033, // not a valid mobile
]);

/* We are the problem: region blocked, channel disabled, no route. */
const BLOCKED_REGION = new Set([
  60605, // blocked by Verify Geo-Permissions
  60410, // verification delivery attempt blocked
  60223, // delivery channel disabled
  60203, // max send attempts reached (region/carrier throttling)
]);

const MESSAGES = {
  invalid_number: "That phone number doesn't look right — check the number and country code",
  blocked_region: "We can't text a code to your region yet. Use Google, Apple, or get a sign-in link by email instead.",
  unavailable: "We couldn't send your code just now. Try email or Google, or give it a minute.",
};

/**
 * @param {{code?: number|string, status?: number}} providerError
 * @returns {{kind: 'invalid_number'|'blocked_region'|'unavailable', message: string,
 *            httpStatus: number, alert: boolean}}
 */
function classifySmsFailure(providerError) {
  const raw = providerError && providerError.code;
  const code = typeof raw === 'string' ? parseInt(raw, 10) : raw;

  if (INVALID_NUMBER.has(code)) {
    return { kind: 'invalid_number', message: MESSAGES.invalid_number, httpStatus: 400, alert: false };
  }
  if (BLOCKED_REGION.has(code)) {
    /* alert:true — this is a console setting only a human can change. */
    return { kind: 'blocked_region', message: MESSAGES.blocked_region, httpStatus: 400, alert: true };
  }
  return { kind: 'unavailable', message: MESSAGES.unavailable, httpStatus: 400, alert: true };
}

/** One line an operator can grep for, with no customer PII beyond the region. */
function alertLine(providerError, phone) {
  const code = providerError && providerError.code;
  /* Keep '+' and three digits — enough to identify the region that is blocked,
     not enough to be a customer's phone number sitting in a log. */
  const region = String(phone || '').replace(/^(\+\d{3})\d+$/, '$1');
  return `[SMS-BLOCKED] Twilio ${code} for ${region}xxx — sign-in by SMS is failing for real customers. ` +
    'Check Twilio Console → Verify → Geo Permissions.';
}

module.exports = { classifySmsFailure, alertLine, MESSAGES, INVALID_NUMBER, BLOCKED_REGION };
