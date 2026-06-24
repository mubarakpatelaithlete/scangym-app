/**
 * Shared pagination utilities.
 * Consolidates the repeated offset calculation pattern across route files.
 */

/**
 * Parse pagination parameters from request query and compute the SQL offset.
 *
 * @param {object} query - Express req.query object
 * @param {object} [defaults] - Optional defaults
 * @param {number} [defaults.page=1] - Default page
 * @param {number} [defaults.limit=20] - Default page size
 * @returns {{ page: number, limit: number, offset: number }}
 */
function parsePagination(query, defaults = {}) {
  const page = Math.max(parseInt(query.page, 10) || defaults.page || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaults.limit || 20, 1), 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

module.exports = { parsePagination };
