'use strict';
/* /chat hub (owner request 2026-09-28): one "Chat with ScanGym" link for
   Snapchat, Pinterest, YouTube and LinkedIn bios/pins/posts. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '../frontend/public/chat/index.html'), 'utf8');

test('chat hub links every live chatbot', () => {
  for (const re of [/t\.me\/ScanGymBot/, /m\.me\/1380733691780608/, /ig\.me\/m\//, /href="\/chatgpt"/, /href="\/claude"/, /sms:\+447366265044/, /mailto:bookings@book\.scangym\.com/]) {
    assert.match(html, re);
  }
  assert.ok(!/Scangym1Bot/.test(html), 'Scangym1Bot is the internal TEST bot');
});
