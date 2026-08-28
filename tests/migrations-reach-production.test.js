/**
 * The schema loader must actually find the schema in the image it ships in.
 *
 * `server/db/migrate.js` is described as "the only place the database schema is
 * created or changed". In production it changed nothing at all. The runtime image
 * copies `server/` to `/app`, so the loader sat at `/app/db/migrate.js` and looked
 * two levels up for `/migrations` — a path that has never existed in the image,
 * because the Dockerfile's runtime stage never copied `migrations/` either.
 * `existsSync` returned false, `migrationFiles()` returned `[]`, and `runMigrations`
 * returned success **without logging anything**. Every migration since the baseline
 * was a silent no-op, and the first symptom was a feature failing on
 * `relation "login_links" does not exist`.
 *
 * Two independent things have to hold, so both are tested:
 *   1. the image contains the SQL (Dockerfile)
 *   2. the loader looks where the image puts it, in both layouts (migrate.js)
 * And the failure mode that hid it — silence — is now a test too.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://user:pass@127.0.0.1:5432/none';

const ROOT = path.join(__dirname, '..');
const DOCKERFILE = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
const migrate = require('../server/db/migrate');

/** The runtime stage is everything after the second FROM. */
function runtimeStage() {
  const stages = DOCKERFILE.split(/^FROM /m);
  return stages[stages.length - 1];
}

test('the runtime image contains the migrations', () => {
  assert.match(
    runtimeStage(),
    /COPY migrations\/ \.\/migrations\//,
    'the runtime stage must copy migrations/ — without it the schema never ships'
  );
});

test('the runtime image puts them where the loader looks', () => {
  const stage = runtimeStage();
  // server/ is copied to /app, so migrate.js runs from /app/db.
  assert.match(stage, /COPY server\/ \.\/\n?/, 'server/ is expected at /app');
  const candidates = migrate.MIGRATION_DIR_CANDIDATES.map((p) => p.replace(/\\/g, '/'));
  // One candidate must be "one level up from the loader", which is /app/migrations.
  const oneUp = candidates.some((c) => /\/db\/\.\.\/migrations$/.test(c) || c.endsWith('/server/migrations'));
  assert.ok(oneUp, `no candidate matches the image layout: ${candidates.join(', ')}`);
});

test('the loader finds the real directory in this checkout', () => {
  const dir = migrate.migrationsDir();
  assert.ok(dir, 'the migrations directory must be found from the repo layout');
  assert.ok(fs.existsSync(dir));
  const files = migrate.migrationFiles();
  assert.ok(files.length >= 5, `expected the migration set, got ${files.length}`);
  assert.ok(files.includes('0005_login_links.sql'), 'the newest migration must be picked up');
  // Filename order is the apply order, so it must be sorted.
  assert.deepEqual(files, [...files].sort());
});

test('a missing directory is reported loudly, not returned as success', async () => {
  // Simulate the production image as it was: no migrations anywhere.
  const original = [...migrate.MIGRATION_DIR_CANDIDATES];
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-nomig-'));
  migrate.MIGRATION_DIR_CANDIDATES.length = 0;
  migrate.MIGRATION_DIR_CANDIDATES.push(path.join(empty, 'nope'), path.join(empty, 'also-nope'));

  const errors = [];
  try {
    const result = await migrate.runMigrations({
      pool: { async query() { return { rows: [] }; } },
      log: () => {},
      errorLog: (msg) => errors.push(String(msg)),
    });
    assert.equal(result.applied.length, 0);
    assert.equal(result.failed.length, 1, 'a missing schema directory is a failure, not a no-op');
    assert.match(errors.join('\n'), /no migrations directory found/i);
    assert.match(errors.join('\n'), /will NOT be updated/i, 'the log must say the schema was not updated');
  } finally {
    migrate.MIGRATION_DIR_CANDIDATES.length = 0;
    migrate.MIGRATION_DIR_CANDIDATES.push(...original);
    fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('every migration is idempotent enough to re-run against a live database', () => {
  // The baseline claim in migrate.js is that applying these to the existing
  // production database changes nothing already correct. Now that they will
  // actually run there for the first time, that has to be true of all of them.
  const dir = migrate.migrationsDir();
  for (const file of migrate.migrationFiles()) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const statements = sql
      .split(';')
      .map((s) => s.replace(/--.*$/gm, '').trim())
      .filter(Boolean);
    for (const st of statements) {
      if (/^CREATE TABLE/i.test(st)) {
        assert.match(st, /IF NOT EXISTS/i, `${file}: CREATE TABLE must be IF NOT EXISTS`);
      }
      if (/^CREATE INDEX/i.test(st)) {
        assert.match(st, /IF NOT EXISTS/i, `${file}: CREATE INDEX must be IF NOT EXISTS`);
      }
      if (/^ALTER TABLE .* ADD COLUMN/i.test(st)) {
        assert.match(st, /IF NOT EXISTS/i, `${file}: ADD COLUMN must be IF NOT EXISTS`);
      }
    }
  }
});
