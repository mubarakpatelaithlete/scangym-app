/**
 * Nine live credentials were committed to this repo, split into string fragments and
 * rejoined with .join('') specifically so GitHub's secret scanner would not see them.
 * They sat in git history for months while every one of them was also set correctly in
 * Railway, so the fallbacks bought nothing and leaked everything.
 *
 * This test fails the build if a credential is ever inlined again.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..', 'server');

/** Every file we actually ship, excluding dependencies and build output. */
function sourceFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/**
 * Provider-issued key shapes. These are prefixes, not values — matching one means a
 * real credential is sitting in source, whether or not it has been split up.
 */
const SECRET_SHAPES = [
  { name: 'SendGrid API key', re: /['"`]SG\.[A-Za-z0-9_-]{6,}/ },
  { name: 'Groq API key', re: /['"`]gsk_[A-Za-z0-9]{6,}/ },
  { name: 'OpenAI API key', re: /['"`]sk-[A-Za-z0-9]{12,}/ },
  { name: 'Slack bot/user token', re: /['"`]xox[bpsa]-[A-Za-z0-9]{6,}/ },
  { name: 'Twilio account SID', re: /['"`]AC[0-9a-f]{10,}/ },
  { name: 'Google/Gemini API key', re: /['"`]AIza[A-Za-z0-9_-]{10,}/ },
  { name: 'Discord bot token', re: /['"`][MNO][A-Za-z0-9]{23}\.[A-Za-z0-9_-]{6}\./ },
  { name: 'Azure AD client secret', re: /['"`][A-Za-z0-9]{3}~[A-Za-z0-9~._-]{20,}/ },
  { name: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

const files = sourceFiles(SERVER);
assert.ok(files.length > 20, 'expected to scan a real server tree');

// ── No credential may appear in source, split or whole ─────────────────────
const findings = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');

  for (const { name, re } of SECRET_SHAPES) {
    if (re.test(src)) findings.push(`${path.relative(SERVER, file)}: ${name}`);
  }

  // The evasion trick itself: a credential name assigned from joined fragments.
  const joined = /(?:KEY|TOKEN|SECRET|PASSWORD|SID|AUTH)\s*=\s*[^;\n]*\[[^\]]*\]\s*\.join\(''\)/gi;
  if (joined.test(src)) {
    findings.push(`${path.relative(SERVER, file)}: credential assembled with .join('')`);
  }
}

assert.deepStrictEqual(
  findings,
  [],
  'hardcoded credentials found in server source — read them from process.env instead:\n  ' +
    findings.join('\n  ')
);

// ── The specific files that carried the nine must stay clean ───────────────
for (const rel of ['chatbot/email.js', 'chatbot/message-handler.js', 'chatbot/msteams.js', 'chatbot/twilio.js']) {
  const src = fs.readFileSync(path.join(SERVER, rel), 'utf8');
  assert.ok(!src.includes(".join('')"), `${rel} must not rebuild credentials from fragments`);
}

// ── A missing key must read as missing, not silently borrow another one ────
const handler = fs.readFileSync(path.join(SERVER, 'chatbot/message-handler.js'), 'utf8');
assert.ok(
  !/GEMINI_API_KEY\s*=\s*[^;\n]*GOOGLE_MAPS_API_KEY/.test(handler),
  'Gemini must not fall back to GOOGLE_MAPS_API_KEY — different key, different product'
);

console.log(`no-hardcoded-secrets: scanned ${files.length} server files, all clean`);
