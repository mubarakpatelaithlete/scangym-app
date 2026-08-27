#!/usr/bin/env node
/**
 * Split app.ctr576.js into a core bundle plus lazy per-area chunks.
 *
 * Development tool, run by hand — NOT part of the Docker build. It rewrites
 * frontend/public/app.ctr576.js in place and emits frontend/public/sg-<area>.js.
 *
 * Why a parser and not a regex: the bundle is 23k lines of top-level globals
 * with IIFEs, event listeners and bare statements interleaved between the
 * function declarations. Cutting on line ranges would drag that surrounding
 * top-level code into a chunk, where it would run late or not at all. acorn
 * gives exact declaration offsets, so a cut moves precisely one function.
 *
 * Usage:  node tools/split-bundle.js --plan     (report only, writes nothing)
 *         node tools/split-bundle.js --apply
 */
'use strict';

const fs = require('fs');
const path = require('path');
// acorn arrives transitively via terser in server/node_modules. This is a dev
// tool, so resolve it wherever it happens to be installed (the repo root, the
// server dir, or the main clone when running from a git worktree) rather than
// adding a dependency the Docker build would have to carry.
const acorn = (function () {
  const tries = [
    path.join(__dirname, '..', 'server', 'node_modules', 'acorn'),
    path.join(__dirname, '..', 'node_modules', 'acorn'),
    path.join(__dirname, '..', '..', '..', 'server', 'node_modules', 'acorn'),
    'acorn',
  ];
  for (const t of tries) { try { return require(t); } catch (e) { /* next */ } }
  console.error('acorn not found — run `npm install` in server/ first.');
  process.exit(1);
})();

const PUB = path.join(__dirname, '..', 'frontend', 'public');
const BUNDLE = path.join(PUB, 'app.ctr576.js');

// ─── Chunk membership ────────────────────────────────────────────────────────
// Keyed by chunk name; values are exact top-level function names to move out.
// Anything not listed stays in core. Order within a chunk follows the bundle.
//
// Membership rule: a function belongs in a chunk if it is only reachable from
// one area's routes. Shared helpers (GymCard, sgToast, session, nav) stay in
// core even when a chunk is their heaviest caller.
// Two kinds of member:
//   pages — called by _renderInner() for a route in this area, and expected to
//           return an HTML string. Covered by the route gate in _renderInner,
//           which declines to render until the chunk is in. No stub: a stub
//           returning undefined would paint "undefined" into the page.
//   rest  — everything else. Any of these still referenced from core or from
//           another script gets a core stub that loads the chunk then calls
//           through, so no call site can hit a ReferenceError.
//
// Deliberately left in core (see notes): _handleCreatorGoogleSignup and
// handleCreatorGoogleSignIn are on the Google sign-in callback path and are
// under 1KB; _sgCreatorReply is an onclick inside the fan-chat sheet, which
// still lives in core; _creatorWithdraw and _sgCreatorWithdraw are aliases
// asserted on by tests/one-version.test.js and read by wallet-withdraw.js.
const CHUNKS = {
  'sg-scansquad': {
    pages: [
      'CreatorsPage', 'CreatorFullPage', 'CreatorDashboardPage',
      'CreatorEarningsPage', 'CreatorSignedOutPage', 'CreatorReelsPage',
    ],
    rest: [
      '_loadCreatorEarnings', '_loadCreatorFullPage', '_loadCreatorDash',
      '_creatorGetLink', '_loadCreatorAnalytics', '_sgShowCreatorOnboarding',
      '_sgCreatorDeepLink', '_sgCreatorTierSheet', 'submitCreatorApp',
      '_sgCreatorLeaderboardSheet', '_sg1ClickCreatorSignup', '_sgCreatorPageSheet',
      '_sgCreatorFilterReels', '_sgCreatorPageSave', '_showCreatorScreen',
      '_sgCreatorShareReel', '_sgCreatorDownloadReel', '_toggleCreatorMore',
      '_closeCreatorMore',
    ],
    // Core keeps a loading stub for these, because code that stayed in core
    // still calls them directly.
    stubs: ['_loadCreatorEarnings', '_loadCreatorFullPage', '_loadCreatorAnalytics'],
  },
};

// ─── Parse ───────────────────────────────────────────────────────────────────
/**
 * Every top-level declaration that defines a named global, keyed by name.
 *
 * Two forms count, because the bundle uses both interchangeably and half the
 * weight is in the second: `function Foo(){}` and `window.Foo = function(){}`.
 * A name can appear more than once; declarations hoist and the last one wins,
 * so earlier copies are dead bytes.
 */
function topLevelGlobals(code) {
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest', sourceType: 'script', locations: true,
  });
  const out = new Map(); // name -> [{start,end,line,kind}]
  const add = (name, rec) => {
    if (!out.has(name)) out.set(name, []);
    out.get(name).push(rec);
  };
  for (const node of ast.body) {
    if (node.type === 'FunctionDeclaration' && node.id) {
      add(node.id.name, { start: node.start, end: node.end, line: node.loc.start.line, kind: 'fn' });
    } else if (node.type === 'ExpressionStatement' &&
               node.expression.type === 'AssignmentExpression') {
      const left = code.slice(node.expression.left.start, node.expression.left.end);
      // Function expressions are the real definitions; sgChunkStub(...) calls
      // are the loader placeholders this tool generates. Both declare the name.
      const right = node.expression.right;
      const isStub = right.type === 'CallExpression' &&
        right.callee.type === 'Identifier' && right.callee.name === 'sgChunkStub';
      if (/^window\.[A-Za-z_$][\w$]*$/.test(left) &&
          (/Function/.test(right.type) || isStub)) {
        add(left.slice(7), {
          start: node.start, end: node.end, line: node.loc.start.line, kind: 'asn',
        });
      }
    }
  }
  return out;
}

function main() {
  const mode = process.argv[2] || '--plan';
  const code = fs.readFileSync(BUNDLE, 'utf8');
  const globals = topLevelGlobals(code);

  console.log(`bundle: ${(Buffer.byteLength(code) / 1024).toFixed(0)}KB, ` +
    `${globals.size} named top-level globals\n`);

  // ── Dead declarations: shadowed duplicates, unreachable by definition ──
  const dead = [];
  for (const [name, list] of globals) {
    if (list.length < 2) continue;
    // Only function declarations are safely droppable: they hoist, so the last
    // one wins from the first line of the script. Repeated window.X assignments
    // win in execution order, and code between them may legitimately have used
    // the earlier value.
    const droppable = list.slice(0, -1).filter((d) => d.kind === 'fn' &&
      list[list.length - 1].kind === 'fn');
    for (const d of droppable) {
      dead.push({ name, ...d });
      console.log(`dead: ${name} L${d.line} ` +
        `(${((d.end - d.start) / 1024).toFixed(1)}KB, shadowed by L${list[list.length - 1].line})`);
    }
  }

  // ── Resolve members to their live (last) declaration ──
  const cuts = [];
  const report = [];
  for (const [chunk, spec] of Object.entries(CHUNKS)) {
    const names = [...spec.pages, ...spec.rest];
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length) throw new Error(`${chunk}: listed twice: ${dupes}`);
    let bytes = 0;
    for (const name of names) {
      const list = globals.get(name);
      if (!list) throw new Error(`${chunk}: ${name} is not a top-level global`);
      const live = list[list.length - 1];
      cuts.push({ chunk, name, ...live });
      bytes += live.end - live.start;
    }
    for (const s of spec.stubs) {
      if (!names.includes(s)) throw new Error(`${chunk}: stub ${s} is not a member`);
      if (spec.pages.includes(s)) {
        throw new Error(`${chunk}: ${s} is a page — a stub would render "undefined"`);
      }
    }
    report.push([chunk, bytes, names.length]);
  }
  for (const d of dead) cuts.push({ chunk: null, name: d.name, start: d.start, end: d.end });

  cuts.sort((a, b) => a.start - b.start);
  for (let i = 1; i < cuts.length; i++) {
    if (cuts[i].start < cuts[i - 1].end) {
      throw new Error(`overlapping cuts: ${cuts[i - 1].name} / ${cuts[i].name}`);
    }
  }

  console.log('');
  let moved = 0;
  for (const [chunk, bytes, n] of report) {
    console.log(`${chunk.padEnd(16)} ${(bytes / 1024).toFixed(0).padStart(5)}KB  ${n} symbols`);
    moved += bytes;
  }
  const deadBytes = dead.reduce((a, d) => a + (d.end - d.start), 0);
  const after = Buffer.byteLength(code) - moved - deadBytes;
  console.log(`${'(dead code)'.padEnd(16)} ${(deadBytes / 1024).toFixed(0).padStart(5)}KB`);
  console.log(`${'core after'.padEnd(16)} ${(after / 1024).toFixed(0).padStart(5)}KB ` +
    `(was ${(Buffer.byteLength(code) / 1024).toFixed(0)}KB, ` +
    `-${(100 * (moved + deadBytes) / Buffer.byteLength(code)).toFixed(0)}%)`);

  if (mode !== '--apply') { console.log('\n(plan only — pass --apply to write)'); return; }

  // ─── Apply ───────────────────────────────────────────────────────────────
  const chunkSrc = {};
  for (const chunk of Object.keys(CHUNKS)) chunkSrc[chunk] = [];

  // Cut from the end so earlier offsets stay valid.
  let core = code;
  for (const cut of cuts.slice().reverse()) {
    const text = core.slice(cut.start, cut.end);
    if (cut.chunk) chunkSrc[cut.chunk].unshift(text);
    const spec = cut.chunk ? CHUNKS[cut.chunk] : null;
    let note;
    if (!cut.chunk) {
      note = `/* ${cut.name}: duplicate declaration removed — the copy below shadowed it */`;
    } else if (spec.stubs.includes(cut.name)) {
      // Stub, not a comment: core still calls this one directly.
      note = `window.${cut.name}=sgChunkStub('${cut.chunk}','${cut.name}');` +
        ` /* real implementation in ${cut.chunk}.js */`;
    } else {
      note = `/* ${cut.name} → ${cut.chunk}.js */`;
    }
    core = core.slice(0, cut.start) + note + core.slice(cut.end);
  }

  const outputs = {};
  for (const [chunk, parts] of Object.entries(chunkSrc)) {
    const spec = CHUNKS[chunk];
    const header = `/**\n * ${chunk}.js — lazy chunk, split out of app.ctr576.js.\n` +
      ` *\n` +
      ` * Loaded by sgChunk('${chunk}') when a route in this area is rendered, and\n` +
      ` * prefetched at idle after first paint. Declares exactly the globals it\n` +
      ` * declared inside the monolith, so every existing inline onclick keeps\n` +
      ` * working unchanged.\n` +
      ` *\n` +
      ` * Generated once by tools/split-bundle.js. Edit these functions HERE — the\n` +
      ` * copies in app.ctr576.js are gone, not commented out.\n` +
      ` *\n` +
      ` * Pages (returned to _renderInner, gated on this chunk being loaded):\n` +
      spec.pages.map((p) => ` *   ${p}\n`).join('') +
      ` */\n'use strict';\n`;
    outputs[chunk] = header + parts.join('\n\n') + '\n';
  }

  // ─── Verify BEFORE writing ───────────────────────────────────────────────
  // A half-applied split is much harder to recover from than a refusal, so
  // nothing touches the working tree until every check passes.
  const coreGlobals = topLevelGlobals(core);
  for (const [chunk, spec] of Object.entries(CHUNKS)) {
    const src = outputs[chunk];
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'script' });
    const got = [...topLevelGlobals(src).keys()].sort();
    const want = [...spec.pages, ...spec.rest].sort();
    if (got.join(',') !== want.join(',')) {
      throw new Error(`${chunk}: expected [${want}]\n  got [${got}]`);
    }
    // A moved symbol must be gone from core — except the stubbed ones, which
    // core deliberately redeclares as loaders.
    for (const name of want) {
      const still = coreGlobals.has(name);
      if (spec.stubs.includes(name) && !still) throw new Error(`${name}: stub missing from core`);
      if (!spec.stubs.includes(name) && still) throw new Error(`${name}: still declared in core`);
    }
  }
  acorn.parse(core, { ecmaVersion: 'latest', sourceType: 'script' });
  console.log('verified: chunks parse standalone, core parses, no symbol declared twice');

  for (const [chunk, src] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(PUB, chunk + '.js'), src);
    console.log(`wrote ${chunk}.js (${(Buffer.byteLength(src) / 1024).toFixed(0)}KB)`);
  }
  fs.writeFileSync(BUNDLE, core);
  console.log(`wrote app.ctr576.js (${(Buffer.byteLength(core) / 1024).toFixed(0)}KB)`);
}

main();
