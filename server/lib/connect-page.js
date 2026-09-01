/**
 * "Use ScanGym in <assistant>" — the guided MCP connector pages.
 *
 * Claude, Grok and Gemini all connect to ScanGym the same way: they take a
 * custom MCP connector URL, and ours (https://scangym.com/mcp) has been live
 * and answering tools/list since August. What differs between them is four
 * lines of copy and where the settings page lives.
 *
 * So there is one page, not three. Copying claude/index.html twice would mean
 * three files drifting apart the first time the wording changes — the same
 * accretion problem the frontend patch chain is being dug out of.
 *
 * A platform is only listed here when the connector genuinely works today.
 * Where a paid or region-limited account is required, the page says so on the
 * page rather than letting someone find out after three taps: the app's rule
 * is that no control claims an action it cannot perform.
 */

const fs = require('fs');
const path = require('path');

/** Simple, non-infringing marks. We do not ship other companies' logos. */
const MARKS = {
  claude:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#d97757"/><path d="M12 5.5l1.8 4.2 4.2 1.8-4.2 1.8L12 17.5l-1.8-4.2L6 11.5l4.2-1.8z" fill="#fff"/></svg>',
  grok:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#111827"/><path d="M8 7l8 10M16 7L8 17" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  gemini:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1a73e8"/><path d="M12 5c.6 3.2 1.8 4.4 5 5-3.2.6-4.4 1.8-5 5-.6-3.2-1.8-4.4-5-5 3.2-.6 4.4-1.8 5-5z" fill="#fff"/></svg>',
};

const PLATFORMS = {
  claude: {
    slug: 'claude',
    name: 'Claude',
    // Verified in a browser 2026-09-01: /settings/connectors now renders only
    // "Connectors have moved to Customize". This is where they actually live.
    settingsUrl: 'https://claude.ai/new#settings/customize-connectors',
    settingsBtn: 'Open Claude connectors',
    step2Title: 'Open Claude’s connectors',
    step3Body:
      'Tap <span class="k">Add</span> → <span class="k">Custom connector</span>, paste the link, then confirm.',
    faqFindQ: 'I can’t find where to add a connector.',
    faqFindA:
      'Claude moved connectors: they now sit under Customize → Connectors, not the old settings page. The orange button above goes straight there. Use the Add button at the top right.',
    // Checked on a free Claude account on 2026-09-01: a custom connector added,
    // listed and used. So no paid-plan claim here — it would not be true.
    accountNote: 'A free Claude account is enough — we tested it on one.',
  },
  grok: {
    slug: 'grok',
    name: 'Grok',
    settingsUrl: 'https://grok.com/connectors',
    settingsBtn: 'Open Grok connectors',
    step2Title: 'Open Grok’s connector settings',
    step3Body:
      'Tap <span class="k">New Connector</span>, choose <span class="k">Custom</span>, paste the link and confirm.',
    faqFindQ: 'I can’t find “New Connector”.',
    faqFindA:
      'Use the orange button above to land on the Connectors page, then look for the button at the top right. If it is not there, your plan does not include custom connectors yet.',
    accountNote:
      'If Grok doesn’t offer “New Connector”, your Grok plan doesn’t include custom connectors yet.',
  },
  gemini: {
    slug: 'gemini',
    name: 'Gemini',
    settingsUrl: 'https://gemini.google.com/apps',
    settingsBtn: 'Open Gemini connected apps',
    step2Title: 'Open Gemini’s connected apps',
    step3Body:
      'Tap <span class="k">Add a custom app</span>, paste the link, then confirm.',
    faqFindQ: 'I can’t find “Add a custom app”.',
    faqFindA:
      'Custom apps are a Gemini Spark feature. On a Gemini account without Spark the Connected apps page only lists Google’s own apps and a fixed set of partners — no box to paste a link into. That is why the option is missing, and Claude works today in the meantime.',
    accountNote: 'Custom apps need Gemini Spark — without it, Connected apps is a fixed list.',
  },
};

const TEMPLATE_PATH = (frontendDir) => path.join(frontendDir, 'connect', 'index.html');

let cache = null; // { mtimeMs, raw }

function template(frontendDir) {
  const file = TEMPLATE_PATH(frontendDir);
  const stat = fs.statSync(file);
  if (!cache || cache.mtimeMs !== stat.mtimeMs) {
    cache = { mtimeMs: stat.mtimeMs, raw: fs.readFileSync(file, 'utf8') };
  }
  return cache.raw;
}

const TOKENS = {
  NAME: 'name',
  SLUG: 'slug',
  SETTINGS_URL: 'settingsUrl',
  SETTINGS_BTN: 'settingsBtn',
  STEP2_TITLE: 'step2Title',
  STEP3_BODY: 'step3Body',
  FAQ_FIND_Q: 'faqFindQ',
  FAQ_FIND_A: 'faqFindA',
  ACCOUNT_NOTE: 'accountNote',
};

/** Render the page for one platform. Throws for an unknown slug. */
function render(frontendDir, slug) {
  const p = PLATFORMS[slug];
  if (!p) throw new Error(`unknown connector platform: ${slug}`);
  let html = template(frontendDir);
  for (const [token, field] of Object.entries(TOKENS)) {
    html = html.split(`{{${token}}}`).join(p[field]);
  }
  html = html.split('{{MARK}}').join(MARKS[slug]);
  // A token left behind would render as literal braces on a customer's screen.
  const leftover = html.match(/\{\{[A-Z_]+\}\}/g);
  if (leftover) throw new Error(`connect page: unfilled tokens ${leftover.join(', ')}`);
  return html;
}

module.exports = { render, PLATFORMS, MARKS, slugs: () => Object.keys(PLATFORMS) };
