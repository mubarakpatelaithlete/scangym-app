const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
test('Task 154 Chats 4: groups — migration, routes, members can read the thread', () => {
  assert.match(fs.readFileSync(path.join(root, 'migrations/20261002d_dm_groups.sql'), 'utf8'), /CREATE TABLE IF NOT EXISTS dm_group_members/);
  const g = fs.readFileSync(path.join(root, 'server/routes/dm-groups.js'), 'utf8');
  assert.match(g, /router\.post\('\/groups'/);
  const dm = fs.readFileSync(path.join(root, 'server/routes/dm.js'), 'utf8');
  assert.match(dm, /user_a='grp' AND \$\{groups\.MEMBER_SQL\}/);
  assert.match(dm, /if \(t\.user_a !== 'grp'\) autoReply/);
  require('../server/routes/dm-groups');
});
test('Task 154 Chats 4: New group in the Chats UI, sender names in groups', () => {
  const h = fs.readFileSync(path.join(root, 'frontend/public/chats/app.html'), 'utf8');
  assert.match(h, /function groupSheet\(\)/);
  assert.match(h, /api\('POST','\/groups'/);
  assert.match(h, /m\.from&&!m\.deleted/);
});
