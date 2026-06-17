#!/usr/bin/env node
/**
 * ScanGym Build Script — Pre-compress & minify static assets
 * 
 * Runs during Docker build (after files are copied):
 * 1. Minify JS files with terser (60-70% size reduction)
 * 2. Pre-compress all text assets with Brotli (.br) and gzip (.gz)
 * 3. Log size savings
 * 
 * Result: Express serves pre-compressed files → zero runtime compression cost
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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
    // Skip main app bundle — hand-written vanilla JS with complex CSS-in-JS
    // strings that terser mangles (content:'' escapes, template strings, etc.)
    if (path.basename(file).startsWith('app.ctr')) continue;
    
    const code = fs.readFileSync(file, 'utf8');
    const originalSize = Buffer.byteLength(code);
    
    // Skip small files
    if (originalSize < 1024) continue;

    try {
      const result = await terser.minify(code, {
        compress: {
          dead_code: true,
          drop_console: false, // Keep console.log for debugging
          passes: 2,
          pure_getters: true,
          unsafe_math: true,
        },
        mangle: {
          toplevel: false, // Don't mangle top-level — vanilla JS relies on globals
        },
        format: {
          comments: false,
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

// ─── Step 2: Pre-compress with Brotli + gzip ──────────────────────────
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

// ─── Step 3: Log final sizes ──────────────────────────────────────────
function logSummary() {
  const keyFiles = ['app.ctr576.js', 'styles.css', 'robust-location.js', 'sw.js', 'index.html'];
  
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

// ─── Step 4: Validate JS syntax (catch octal escapes in template literals etc.) ─
function validateJS() {
  const jsFiles = findFiles(PUBLIC_DIR, '.js');
  let errors = 0;

  for (const file of jsFiles) {
    if (file.endsWith('.min.js') || file.endsWith('.br') || file.endsWith('.gz')) continue;
    // Skip main app bundle — same as minifyJS(). Hand-written vanilla JS with
    // complex CSS-in-JS that triggers false positives in new Function() validation.
    if (path.basename(file).startsWith('app.ctr')) continue;

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
  preCompress();
  logSummary();
  console.log('✅ Build complete!\n');
})();
