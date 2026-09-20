/**
 * Discord registered exactly one command, `/scangym`, with its real journeys
 * hidden as subcommands. Checked live on 2026-09-20:
 * GET /applications/{id}/commands returned ['scangym'], so a customer who wanted
 * a gym had to type `/scangym search location:Bolton` — four decisions before
 * any gym appeared, on the channel where the bot is already connected.
 *
 * The same journeys are now top-level commands, and `/gyms` deliberately takes
 * no required argument: an empty `/gyms` returns the welcome card whose buttons
 * (Find Gyms / Pricing / Earn Money) already existed and work.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'server/chatbot/discord.js'), 'utf8');

test('the one-tap commands are registered, not only the /scangym group', () => {
  const block = src.slice(src.indexOf('const oneTapCommands'), src.indexOf('const commands = [{'));
  for (const name of ['gyms', 'book', 'pricing', 'creator', 'help']) {
    assert.match(block, new RegExp(`name: '${name}'`), `/${name} must be registered`);
  }
  assert.match(src, /JSON\.stringify\(\[\.\.\.commands, \.\.\.oneTapCommands\]\)/,
    'both sets go in the same PUT, so nothing is silently dropped');
});

test('/gyms asks for nothing, so the empty command is still useful', () => {
  const block = src.slice(src.indexOf("name: 'gyms'"), src.indexOf("name: 'book'"));
  assert.match(block, /required: false/, 'a required location is a typing step, which is the thing being removed');
});

test('/book still requires the gym, because booking nothing is worse than asking', () => {
  const block = src.slice(src.indexOf("const oneTapCommands"), src.indexOf("{ name: 'pricing'"));
  const bookBlock = block.slice(block.indexOf("name: 'book'"));
  assert.match(bookBlock, /required: true/);
});

test('each new command is handled, so none of them can answer with a silent help', () => {
  const handler = src.slice(src.indexOf('async function handleInteraction'), src.indexOf('async function handleButtonClick'));
  assert.match(handler, /case 'gyms':/);
  assert.match(handler, /case 'book':\s*\n\s*text = `book \$\{options\[0\]\?\.value \|\| ''\}`/);
  assert.match(handler, /case 'pricing':/);
  assert.match(handler, /case 'creator':/);
  assert.match(handler, /case 'help':/);
  // The /scangym group must survive: old messages and old muscle memory still use it.
  assert.match(handler, /case 'scangym':/);
});
