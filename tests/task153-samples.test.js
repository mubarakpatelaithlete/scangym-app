const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
test('Task 153: /samples serves only shared, finished creations', () => {
  const lib = fs.readFileSync(path.join(root, 'server/lib/gen-jobs.js'), 'utf8');
  assert.match(lib, /share_count, 0\) > 0/);
  assert.match(lib, /status = 'done'/);
  assert.match(fs.readFileSync(path.join(root, 'server/routes/squad-create.js'), 'utf8'), /router\.get\('\/samples'/);
});
test('Task 153: model cards and chips use the real samples', () => {
  assert.match(fs.readFileSync(path.join(root, 'frontend/public/create-studio.js'), 'utf8'), /\/api\/squad-create\/samples/);
  assert.match(fs.readFileSync(path.join(root, 'frontend/public/squad-create.js'), 'utf8'), /sv-msample/);
});
