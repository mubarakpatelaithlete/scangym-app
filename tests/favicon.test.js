// Task 155: scangym.com had no favicon. The icon files must exist as real PNG/ICO
// and the shell must link them, or browsers fall back to /favicon.ico → SPA HTML.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PUB = path.join(__dirname, '..', 'frontend', 'public');
test('favicon files are real images and linked from the shell', () => {
  for (const f of ['favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
    const b = fs.readFileSync(path.join(PUB, f));
    assert.strictEqual(b.slice(1, 4).toString(), 'PNG', `${f} must be a PNG`);
  }
  assert.strictEqual(fs.readFileSync(path.join(PUB, 'favicon.ico')).readUInt16LE(2), 1, 'favicon.ico must be an ICO');
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  assert.match(html, /rel="icon" href="\/favicon\.ico"/);
  assert.match(html, /rel="apple-touch-icon" href="\/apple-touch-icon\.png"/);
  const m = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.json'), 'utf8'));
  assert.ok(m.icons.some((i) => i.src === '/icon-512.png'));
});

// Task 154 + 157 B3 (same PR): /create alias, Profile login reachable, retry button.
test('/create opens the Create tab instead of Page Not Found', () => {
  const app = fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8');
  assert.match(app, /path==='\/creator'\|\|path==='\/creator\/'\|\|path==='\/create'\|\|path==='\/create\/'\)page=CreatorFullPage\(\)/);
  assert.match(app, /p==='\/create'\|\|p==='\/creator-earnings'/);
});
test('logged-out Profile keeps its Log In button visible', () => {
  assert.match(fs.readFileSync(path.join(PUB, 'app.ctr576.js'), 'utf8'), /id="sg-profile-login"/);
  assert.match(fs.readFileSync(path.join(PUB, 'one-cta.css'), 'utf8'), /#sg-profile-login \{/);
});
test('a failed Create run offers Try again', () => {
  assert.match(fs.readFileSync(path.join(PUB, 'squad-create.js'), 'utf8'), /function addRetry\(out, fn\)/);
});
