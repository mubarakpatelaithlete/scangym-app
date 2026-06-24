/**
 * Shared code generation utilities.
 * Consolidates random code/token generators used across booking, QR, and group routes.
 */
const crypto = require('crypto');

const ALPHANUMERIC_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIXED_CASE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Generate an 8-character booking code (e.g. "ABCD-EF12").
 * Dash inserted after position 4.
 */
function generateBookingCode() {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += ALPHANUMERIC_CHARS[Math.floor(Math.random() * ALPHANUMERIC_CHARS.length)];
    if (i === 3) code += '-';
  }
  return code;
}

/**
 * Generate a machine-readable booking QR code string (hex-based).
 * Format: "BOOK_" + 16 uppercase hex chars.
 */
function generateQRCode() {
  return 'BOOK_' + crypto.randomBytes(8).toString('hex').toUpperCase();
}

/**
 * Generate a structured QR token for the 2-scan system.
 * Format: "SG-XXXXXX-XXXXXX-XXXXXX-XXXXXX" (4 segments of 6 mixed-case chars).
 */
function generateQRToken() {
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    for (let i = 0; i < 6; i++) {
      seg += MIXED_CASE_CHARS.charAt(Math.floor(Math.random() * MIXED_CASE_CHARS.length));
    }
    segments.push(seg);
  }
  return 'SG-' + segments.join('-');
}

/**
 * Generate a short group booking code (6 uppercase hex chars).
 */
function generateGroupCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

module.exports = {
  generateBookingCode,
  generateQRCode,
  generateQRToken,
  generateGroupCode,
};
