/**
 * The only place the database schema is created or changed.
 *
 * Before this existed, 32 different server files ran their own
 * `CREATE TABLE IF NOT EXISTS` on startup (and a few on every request), which
 * meant the shape of a table depended on which module happened to load first —
 * `workout_logs` was declared twice, in two incompatible shapes, and the loser
 * was silently ignored.
 *
 * How it works: every `.sql` file in /migrations is run once, in filename
 * order, inside a transaction, and recorded in `schema_migrations`. The
 * baseline files are all idempotent (IF NOT EXISTS / DO $$ guards), so running
 * them against the existing production database changes nothing that is
 * already correct.
 *
 * Adding a schema change: create `migrations/0005_what_it_does.sql`. Never add
 * DDL back into a route file — tests/one-version.test.js will fail the build.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../middleware/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

function migrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function runMigrations({ log = console.log, errorLog = console.error } = {}) {
  const result = { applied: [], skipped: [], failed: [] };
  const files = migrationFiles();
  if (!files.length) return result;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        checksum   TEXT,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  } catch (err) {
    errorLog('[migrate] cannot reach the database, schema left untouched:', err.message);
    result.failed.push({ file: 'schema_migrations', error: err.message });
    return result;
  }

  const done = new Set(
    (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  for (const file of files) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2) ON CONFLICT (filename) DO NOTHING',
        [file, checksum(sql)]
      );
      await client.query('COMMIT');
      result.applied.push(file);
      log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      result.failed.push({ file, error: err.message });
      errorLog(`[migrate] FAILED ${file}: ${err.message}`);
    } finally {
      client.release();
    }
  }

  if (result.applied.length || result.failed.length) {
    log(`[migrate] ${result.applied.length} applied, ${result.skipped.length} already up to date, ${result.failed.length} failed`);
  }
  return result;
}

module.exports = { runMigrations, migrationFiles, checksum, MIGRATIONS_DIR };
