#!/usr/bin/env node
/**
 * ScanGym Build Script — Pre-compress & minify static assets
 * 
 * Runs during Docker build (after files are copied):
 * 1. Minify JS files with terser (60-70% size reduction)
 * 2. Content-hash JS/CSS filenames for instant cache busting
 * 3. Pre-compress all text assets with Brotli (.br) and gzip (.gz)
 * 4. Log size savings
 * 
 * Result: Express serves pre-compressed files → zero runtime compression cost
 *         Content-hashed filenames → users always get fresh code after deploys
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const PUBLIC_DIR = path.join(__dirname, 'public');

// Check if public dir exists (Docker build context)
if (!fs.existsSync(PUBLIC_DIR)) {
  console.log('⚠️  No public/ dir found — skipping build step (dev mode)');
  process.exit(0);
}

console.log('🔨 ScanGym Build: Optimizing static assets...\n');

// ─── Step 1: Minify JS ────────────────────────────────────────────────
async function minifyJS() {
  let terser;
  try {
    terser = require('terser');
  } catch (e) {
    console.log('⚠️  terser not installed — skipping JS minification');
    return;
  }

  const jsFiles = findFiles(PUBLIC_DIR, '.js');
  let totalSaved = 0;

  for (const file of jsFiles) {
    // Skip already-minified files and service worker
    if (file.endsWith('.min.js')) continue;
    
    const code = fs.readFileSync(file, 'utf8');
    const originalSize = Buffer.byteLength(code);
    
    // Skip small files
    if (originalSize < 1024) continue;

    // Main app bundle needs special terser config to handle CSS-in-JS
    // template strings safely. Other files use aggressive settings.
    const isMainBundle = path.basename(file).startsWith('app.ctr');

    try {
      const result = await terser.minify(code, {
        compress: {
          dead_code: true,
          drop_console: false, // Keep console.log for debugging
          passes: isMainBundle ? 1 : 2,
          pure_getters: !isMainBundle,
          unsafe_math: !isMainBundle,
          // Safe settings for main bundle — preserve template literals
          ...(isMainBundle ? {
            collapse_vars: false,
            sequences: false,
          } : {}),
        },
        mangle: {
          toplevel: false, // Don't mangle top-level — vanilla JS relies on globals
          ...(isMainBundle ? {
            reserved: ['state', 'navigate', 'render', 'switchTab', 'sgToast',
              'sgPerf', 'curRoute', 'curUser', 'checkAuth'],
          } : {}),
        },
        format: {
          comments: false,
          // Preserve template literal backticks in main bundle
          ...(isMainBundle ? { ascii_only: false } : {}),
        },
      });

      if (result.code) {
        const newSize = Buffer.byteLength(result.code);
        const saved = originalSize - newSize;
        if (saved > 100) { // Only write if meaningful savings
          fs.writeFileSync(file, result.code);
          totalSaved += saved;
          console.log(`  ✅ ${path.relative(PUBLIC_DIR, file)}: ${fmt(originalSize)} → ${fmt(newSize)} (${pct(saved, originalSize)} smaller)`);
        }
      }
    } catch (err) {
      console.log(`  ⚠️  ${path.relative(PUBLIC_DIR, file)}: minify failed (${err.message.slice(0, 60)})`);
    }
  }

  console.log(`  📦 Total JS savings: ${fmt(totalSaved)}\n`);
}

// ─── Step 2: Content-hash filenames for cache busting ─────────────────
// Every deploy changes the hash → new URL → browser fetches fresh code instantly
// This is how Netflix, Vercel, Next.js, Stripe, and Airbnb all solve caching.
function contentHashAssets() {
  console.log('🔑 Content-hashing assets for cache busting...\n');

  // Assets to hash: [original filename, glob pattern for finding references]
  const ASSETS_TO_HASH = [
    'app.ctr576.js',
    'styles.css',
    'robust-location.js',
    'pricing.js',
    'phase2-improvements.js',
    'phase3-improvements.js',
  ];

  // Files that reference the assets (HTML, JS, SW)
  const REFERENCE_FILES = [
    ...findFiles(PUBLIC_DIR, '.html'),
    path.join(PUBLIC_DIR, 'sw.js'),
  ];

  const hashMap = {}; // original name → hashed name

  // 1. Compute content hash for each asset and rename
  for (const assetName of ASSETS_TO_HASH) {
    const assetPath = path.join(PUBLIC_DIR, assetName);
    if (!fs.existsSync(assetPath)) continue;

    const content = fs.readFileSync(assetPath);
    const hash = crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
    const ext = path.extname(assetName);
    const base = assetName.slice(0, -ext.length);
    const hashedName = `${base}.${hash}${ext}`;

    // Copy to hashed filename (keep original for perf dashboard self-reference)
    fs.copyFileSync(assetPath, path.join(PUBLIC_DIR, hashedName));
    hashMap[assetName] = hashedName;
    console.log(`  ✅ ${assetName} → ${hashedName}`);
  }

  // 2. Update all references in HTML files and SW
  for (const refFile of REFERENCE_FILES) {
    if (!fs.existsSync(refFile)) continue;
    let content = fs.readFileSync(refFile, 'utf8');
    let changed = false;

    for (const [original, hashed] of Object.entries(hashMap)) {
      // Replace references like /app.ctr576.js?v=5.3.1 or /app.ctr576.js or '/app.ctr576.js'
      // Handles: href="/X?v=...", src="/X?v=...", '/X', "/X"
      const escaped = original.replace(/\./g, '\\.');
      const regex = new RegExp(`(["'/])${escaped}(\\?[^"'\\s]*)?`, 'g');
      const newContent = content.replace(regex, `$1${hashed}`);
      if (newContent !== content) {
        content = newContent;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(refFile, content);
      console.log(`  📝 Updated references in ${path.relative(PUBLIC_DIR, refFile)}`);
    }
  }

  // 3. Update service worker cache name so it invalidates on every deploy
  const swPath = path.join(PUBLIC_DIR, 'sw.js');
  if (fs.existsSync(swPath)) {
    let swContent = fs.readFileSync(swPath, 'utf8');
    // Compute a combined hash of all hashed asset names for the cache version
    const cacheHash = crypto.createHash('md5')
      .update(Object.values(hashMap).sort().join(','))
      .digest('hex').slice(0, 8);
    swContent = swContent.replace(
      /const CACHE_NAME = '[^']+'/,
      `const CACHE_NAME = 'scangym-${cacheHash}'`
    );
    fs.writeFileSync(swPath, swContent);
    console.log(`  📝 Updated SW cache name → scangym-${cacheHash}`);
  }

  // 4. Write hash manifest for server.js to read at runtime
  const manifestPath = path.join(PUBLIC_DIR, '.asset-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(hashMap, null, 2));
  console.log(`  📝 Wrote asset manifest (${Object.keys(hashMap).length} entries)\n`);

  return hashMap;
}

// ─── Step 3: Pre-compress with Brotli + gzip ──────────────────────────
function preCompress() {
  const COMPRESSIBLE = ['.js', '.css', '.html', '.json', '.svg', '.txt', '.xml', '.webmanifest'];
  const files = [];
  COMPRESSIBLE.forEach(ext => files.push(...findFiles(PUBLIC_DIR, ext)));

  let totalBrSaved = 0;
  let totalGzSaved = 0;
  let count = 0;

  for (const file of files) {
    // Skip already-compressed versions
    if (file.endsWith('.br') || file.endsWith('.gz')) continue;

    const content = fs.readFileSync(file);
    const originalSize = content.length;

    // Skip tiny files (not worth compressing)
    if (originalSize < 256) continue;

    // Brotli compression (best ratio, ~15-25% better than gzip)
    try {
      const br = zlib.brotliCompressSync(content, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 11, // Max compression
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: originalSize,
        },
      });
      fs.writeFileSync(file + '.br', br);
      totalBrSaved += originalSize - br.length;
    } catch (e) {
      // Brotli failed, skip
    }

    // Gzip compression (wider compatibility)
    try {
      const gz = zlib.gzipSync(content, { level: 9 });
      fs.writeFileSync(file + '.gz', gz);
      totalGzSaved += originalSize - gz.length;
    } catch (e) {
      // Gzip failed, skip
    }

    count++;
  }

  console.log(`  🗜️  Pre-compressed ${count} files`);
  console.log(`  📦 Brotli savings: ${fmt(totalBrSaved)}`);
  console.log(`  📦 Gzip savings: ${fmt(totalGzSaved)}\n`);
}

// ─── Step 4: Log final sizes ──────────────────────────────────────────
function logSummary() {
  // Read manifest to show hashed filenames
  const manifestPath = path.join(PUBLIC_DIR, '.asset-manifest.json');
  let manifest = {};
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {}
  }
  const keyFiles = [
    manifest['app.ctr576.js'] || 'app.ctr576.js',
    manifest['styles.css'] || 'styles.css',
    manifest['robust-location.js'] || 'robust-location.js',
    'sw.js',
    'index.html'
  ];
  
  console.log('📊 Final asset sizes:');
  console.log('  File                    Original   Brotli     Gzip');
  console.log('  ───────────────────────────────────────────────────');

  for (const name of keyFiles) {
    const file = path.join(PUBLIC_DIR, name);
    if (!fs.existsSync(file)) continue;

    const orig = fs.statSync(file).size;
    const brFile = file + '.br';
    const gzFile = file + '.gz';
    const br = fs.existsSync(brFile) ? fs.statSync(brFile).size : '-';
    const gz = fs.existsSync(gzFile) ? fs.statSync(gzFile).size : '-';

    console.log(`  ${name.padEnd(24)} ${fmt(orig).padStart(8)}   ${(typeof br === 'number' ? fmt(br) : br).padStart(8)}   ${(typeof gz === 'number' ? fmt(gz) : gz).padStart(8)}`);
  }
  console.log('');
}

// ─── Helpers ──────────────────────────────────────────────────────────
function findFiles(dir, ext) {
  const results = [];
  const items = fs.readdirSync(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      results.push(...findFiles(full, ext));
    } else if (item.name.endsWith(ext)) {
      results.push(full);
    }
  }
  return results;
}

function fmt(bytes) {
  if (bytes < 1024) return bytes + 'B';
  return (bytes / 1024).toFixed(1) + 'KB';
}

function pct(saved, original) {
  return Math.round((saved / original) * 100) + '%';
}

// ─── Step 5: Validate JS syntax (catch octal escapes in template literals etc.) ─
function validateJS() {
  const jsFiles = findFiles(PUBLIC_DIR, '.js');
  let errors = 0;

  for (const file of jsFiles) {
    if (file.endsWith('.min.js') || file.endsWith('.br') || file.endsWith('.gz')) continue;

    const code = fs.readFileSync(file, 'utf8');
    // Quick parse check — catches SyntaxError before deploy
    try {
      new Function(code);
    } catch (e) {
      console.error(`  ❌ ${path.relative(PUBLIC_DIR, file)}: ${e.message}`);
      errors++;
    }
  }

  if (errors > 0) {
    console.error(`\n🚨 ${errors} JS file(s) have syntax errors — fix before deploying!\n`);
    process.exit(1);
  }
  console.log(`  ✅ All JS files pass syntax validation\n`);
}

// ─── Run ──────────────────────────────────────────────────────────────
(async () => {
  await minifyJS();
  validateJS();
  contentHashAssets();
  preCompress();
  logSummary();
  console.log('✅ Build complete!\n');
})();
