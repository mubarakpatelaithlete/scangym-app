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
 *
 * Where the files are, and why it is two paths: in the repo this file is
 * server/db/migrate.js and the SQL lives in ../../migrations. In the runtime
 * image the Dockerfile copies server/ to /app, so this file is /app/db/migrate.js
 * and the SQL is /app/migrations — one level up, not two. The single hard-coded
 * path resolved to /migrations in production, `existsSync` said no, and this
 * module returned an empty list **without a word in the logs**: for the whole
 * life of the runtime image, not one migration had ever run in production, and
 * nothing anywhere said so. The missing table only surfaced when a feature tried
 * to use it. Hence: look in both places, and if neither exists, say so loudly.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pool = require('../middleware/db');

/** Repo layout first, runtime-image layout second. */
const MIGRATION_DIR_CANDIDATES = [
  path.join(__dirname, '..', '..', 'migrations'), // repo: server/db -> ../../migrations
  path.join(__dirname, '..', 'migrations'),       // image: /app/db  -> /app/migrations
];

function migrationsDir() {
  return MIGRATION_DIR_CANDIDATES.find((dir) => fs.existsSync(dir)) || null;
}

// Kept as a named export because tests and tooling read it.
const MIGRATIONS_DIR = migrationsDir() || MIGRATION_DIR_CANDIDATES[0];

function migrationFiles() {
  const dir = migrationsDir();
  if (!dir) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex').slice(0, 16);
}

async function runMigrations({ log = console.log, errorLog = console.error, pool: db = pool } = {}) {
  const result = { applied: [], skipped: [], failed: [] };
  const dir = migrationsDir();
  if (!dir) {
    errorLog(
      '[migrate] no migrations directory found — looked in ' +
        MIGRATION_DIR_CANDIDATES.join(' and ') +
        '. The schema will NOT be updated. This is a packaging bug, not a database problem.'
    );
    result.failed.push({ file: '(directory)', error: 'migrations directory missing from the image' });
    return result;
  }
  const files = migrationFiles();
  if (!files.length) {
    log(`[migrate] no .sql files in ${dir} — nothing to apply`);
    return result;
  }
  log(`[migrate] ${files.length} migration file(s) in ${dir}`);

  try {
    await db.query(`
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
    (await db.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename)
  );

  for (const file of files) {
    if (done.has(file)) {
      result.skipped.push(file);
      continue;
    }
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await db.connect();
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

module.exports = { runMigrations, migrationFiles, checksum, MIGRATIONS_DIR, migrationsDir, MIGRATION_DIR_CANDIDATES };
