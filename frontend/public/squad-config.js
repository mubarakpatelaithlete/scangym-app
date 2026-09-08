/**
 * ScanSquad creator-library size — one number, everywhere.
 *
 * The landing page and the "create" flow advertised "440+ ready-to-post clips"
 * while the creator dashboard and every other surface said "242+". A creator
 * who signs up on one number and finds another stops trusting the commission
 * numbers too. Update this constant when the library actually changes, and
 * keep tests/one-asset-count.test.js green.
 */
(function (root) {
  var COUNT = 242; // verified count in the creator library
  if (typeof module === 'object' && module.exports) module.exports = { SQUAD_ASSET_COUNT: COUNT };
  if (root) root.SQUAD_ASSET_COUNT = COUNT;
})(typeof window !== 'undefined' ? window : null);
