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

/**
 * Second failure mode, found the same day: `CREATE TABLE IF NOT EXISTS` is a
 * no-op when the table exists in an *older, narrower shape*, so the baseline can
 * "declare" a column that production has never had. That is how
 * booking_feedback.user_id and eight gym_equipment columns went missing while the
 * routes using them returned 500s, and how 0003 came to fail as a whole.
 *
 * These tests keep the SQL self-consistent, which is what can be checked without
 * a database: every column an index needs must be declared by some migration, and
 * a file whose statements may legitimately not apply must not be all-or-nothing.
 */
const MIG_DIR = migrate.migrationsDir();
const allSql = migrate.migrationFiles()
  .map((f) => fs.readFileSync(path.join(MIG_DIR, f), 'utf8'))
  .join('\n');

test('every column an index is built on is declared by a migration', () => {
  const declared = new Set();
  // CREATE TABLE bodies
  const tableRe = /CREATE TABLE IF NOT EXISTS\s+(?:public\.)?"?([a-zA-Z_]+)"?\s*\(/g;
  let m;
  while ((m = tableRe.exec(allSql))) {
    let i = tableRe.lastIndex;
    let depth = 1;
    let body = '';
    while (i < allSql.length && depth > 0) {
      const ch = allSql[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (!depth) break; }
      body += ch;
      i++;
    }
    tableRe.lastIndex = i;
    for (const line of body.split('\n')) {
      // Column names may be quoted ("expire" in user_sessions, from connect-pg-simple).
      const c = line.trim().match(/^"?([a-z_][a-z0-9_]*)"?\s+[A-Za-z]/);
      if (c && !/^(primary|unique|check|foreign|constraint)$/i.test(c[1])) declared.add(`${m[1]}.${c[1]}`);
    }
  }
  // ADD COLUMN statements
  for (const a of allSql.matchAll(/ALTER TABLE\s+(?:public\.)?([a-zA-Z_]+)\s+ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)/gi)) {
    declared.add(`${a[1]}.${a[2]}`);
  }

  const undeclared = [];
  for (const stmt of allSql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+"?[a-zA-Z_]+"?\s+ON\s+(?:public\.)?"?([a-zA-Z_]+)"?\s*\(([^)]*)\)/gi)) {
    const table = stmt[1];
    for (const raw of stmt[2].split(',')) {
      const col = raw.trim().replace(/"/g, '').split(/\s+/)[0];
      if (!col || /\(/.test(col)) continue; // expression index
      if (!declared.has(`${table}.${col}`)) undeclared.push(`${table}.${col}`);
    }
  }
  assert.deepEqual(
    undeclared,
    [],
    `indexed columns that no migration declares (production will reject these): ${undeclared.join(', ')}`
  );
});

test('the index baseline cannot be taken down by one bad statement', () => {
  const sql = fs.readFileSync(path.join(MIG_DIR, '0003_baseline_indexes.sql'), 'utf8');
  assert.match(sql, /FOREACH s IN ARRAY stmts/, 'statements must run one at a time');
  assert.match(sql, /EXCEPTION[\s\S]*undefined_column[\s\S]*undefined_table/, 'a missing column or table must be survivable');
  assert.match(sql, /RAISE WARNING/, 'a skipped index must say so in the logs');
  const count = (sql.match(/\$stmt\$CREATE/g) || []).length;
  assert.ok(count >= 49, `expected the full index set inside the guarded loop, found ${count}`);
});

test('the drift repair covers exactly what production was missing', () => {
  const sql = fs.readFileSync(path.join(MIG_DIR, '0006_repair_drifted_tables.sql'), 'utf8');
  const expected = [
    ['booking_feedback', 'user_id'],
    ['gym_equipment', 'brand'],
    ['gym_equipment', 'equipment_condition'],
    ['gym_equipment', 'is_out_of_order'],
    ['gym_equipment', 'out_of_order_since'],
    ['gym_equipment', 'out_of_order_reason'],
    ['gym_equipment', 'photo_url'],
    ['gym_equipment', 'sort_order'],
    ['gym_equipment', 'updated_at'],
  ];
  for (const [table, col] of expected) {
    assert.match(
      sql,
      new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col}\\b`),
      `0006 must repair ${table}.${col}`
    );
  }
  // The index 0003 now skips has to be created here instead, or it is never built.
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_unique/);
});
