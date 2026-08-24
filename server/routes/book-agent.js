/**
 * Book Agent — the Book tab as a conversation.
 *
 * POST /api/book/agent        Server-Sent Events: token deltas, tool activity, done
 * GET  /api/book/agent/tools  The tool catalogue
 *
 * Mirrors routes/partner-agent.js deliberately: same SSE event names, same
 * confirm-before-write contract, same failover behaviour. The Partner and Squad tabs
 * already work this way, and one shared shape means one client engine
 * (frontend/public/chat-agent.js) drives all three.
 *
 * The difference that matters: this agent talks to customers, and its one write tool
 * takes their money. book_gym is never executed on the model's say-so — the customer
 * sees the gym, the time and the price, and taps yes.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { optionalAuth } = require('../middleware/auth');
const llm = require('../lib/llm');
const bookTools = require('../lib/book-tools');

const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT = `You are the ScanGym booking assistant. You are talking to someone who wants to train — usually on their phone, often standing outside a gym, often in a hurry.

How you behave:
- Do the thing. "Book me a gym near London Bridge tonight" means search, pick the best match, and offer it — do not explain how to use the app.
- One short answer. Two sentences beats ten. No headings or bullet lists unless you are listing gyms or bookings.
- Booking takes their money: say the gym, the date, the time and the exact price, then wait for their yes. Searching and checking bookings just run.
- Once they say yes, finish it: book_and_pay books and charges their saved card in one step, then read back the price and the booking code. Only use book_gym if they ask to pay at the gym.
- If they have no card saved, book_and_pay says so — tell them they add a card once and every booking after that is just their voice.
- If they are not logged in, ask for their mobile number or email, call send_login_code, and have them read the six digits back to confirm_login_code. If they want Google, Apple or company SSO, call login_with_provider: that needs one tap, and you carry on straight after.
- Never ask anyone to say a password or a card number out loud, whatever they offer. If they start to, stop them and send a code instead.
- Never invent a gym, a price, an address or an availability. If a tool has not told you, you do not know it — say so.
- Never guess today's date. Call today_and_tomorrow whenever they say today, tonight or tomorrow.
- If a tool returns ok:false, say so plainly. Never say something is booked unless the tool confirmed it.
- Prices are day passes. Free cancellation up to 2 hours before the session.
- Plain British English, warm, no exclamation marks, no emoji unless they use them first.`;

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function audit(userId, tool, args, result, confirmed) {
  try {
    await pool.query(
      `INSERT INTO partner_agent_actions (user_id, tool, args, result, confirmed)
       VALUES ($1,$2,$3,$4,$5)`,
      [String(userId || 'guest'), 'book:' + tool, JSON.stringify(args || {}), JSON.stringify(result || {}), !!confirmed]
    );
  } catch (err) {
    console.error('[BookAgent] audit write failed:', err.message);
  }
}

/**
 * GET /agent/health        - is a provider configured (cheap)
 * GET /agent/health?deep=1 - can it actually answer right now, and on which model
 *
 * The shallow answer was 200 for the whole of the outage where every question came back
 * "my assistant service is down", because a configured key says nothing about a live model.
 */
router.get('/agent/health', async (req, res) => {
  const base = { success: true, configured: llm.configured() };
  if (!req.query || !req.query.deep) return res.json(base);
  const providers = await llm.health();
  const ok = providers.some((p) => p.ok);
  res.status(ok ? 200 : 503).json({ ...base, success: ok, answers: ok, providers });
});

router.get('/agent/tools', (_req, res) => {
  res.json({
    success: true,
    tools: Object.entries(bookTools.tools).map(([name, t]) => ({
      name,
      write: t.write,
      description: t.schema.description,
      parameters: t.schema.parameters,
    })),
  });
});

router.post('/agent', optionalAuth, express.json(), async (req, res) => {
  // Logged out is a normal state here: the agent's job is to log them in by voice
  // (a texted or emailed six-digit code) and carry straight on with the booking.
  let userId = req.user?.id || null;
  const { message, history = [], confirm = null } = req.body || {};

  if (!llm.configured()) {
    return res.status(503).json({ error: 'Assistant not configured' });
  }
  if (!message && !confirm) {
    return res.status(400).json({ error: 'message or confirm required' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  try {
    // ── Path A: the customer tapped "Yes" on a pending booking. Execute directly,
    //    so a confirmed price can never drift from the one they agreed to.
    if (confirm && confirm.tool) {
      if (bookTools.needsLogin(confirm.tool) && !userId) {
        sse(res, 'delta', { text: 'I need to log you in first — what is your mobile number or email?' });
        sse(res, 'done', { needsLogin: true });
        return res.end();
      }
      sse(res, 'tool', { tool: confirm.tool, state: 'running' });
      const result = await bookTools.execute(confirm.tool, confirm.args, userId, req);
      await audit(userId, confirm.tool, confirm.args, result, true);
      sse(res, 'tool', { tool: confirm.tool, state: 'done', ok: result.ok !== false });
      sse(res, 'delta', { text: result.message || (result.ok ? 'Done.' : 'That did not work.') });
      sse(res, 'done', { result });
      return res.end();
    }

    // ── Path B: normal turn.
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
        .filter((m) => m && m.role && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.content) })),
      { role: 'user', content: String(message) },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const { stream } = await llm.streamChat('BookAgent', {
        messages,
        tools: bookTools.openAiTools(),
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 400,
        stream: true,
      });

      let text = '';
      const calls = [];

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          text += delta.content;
          sse(res, 'delta', { text: delta.content });
        }

        for (const tc of delta.tool_calls || []) {
          const i = tc.index || 0;
          calls[i] = calls[i] || { id: '', name: '', args: '' };
          if (tc.id) calls[i].id = tc.id;
          if (tc.function?.name) calls[i].name += tc.function.name;
          if (tc.function?.arguments) calls[i].args += tc.function.arguments;
        }
      }

      if (!calls.length) {
        sse(res, 'done', { text });
        return res.end();
      }

      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.args || '{}' },
        })),
      });

      for (const call of calls) {
        let args = {};
        try {
          args = JSON.parse(call.args || '{}');
        } catch (_) {
          args = {};
        }

        // A booking the customer has not approved yet: hand it back for confirmation.
        if (bookTools.isWrite(call.name) && userId) {
          await audit(userId, call.name, args, { pending: true }, false);
          sse(res, 'confirm', {
            tool: call.name,
            args,
            summary: bookTools.tools[call.name].schema.description,
          });
          sse(res, 'done', { awaitingConfirmation: true });
          return res.end();
        }

        if (bookTools.needsLogin(call.name) && !userId) {
          const result = {
            ok: false,
            needsLogin: true,
            message: 'I need to log you in first. What is your mobile number or email address?',
          };
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
          continue;
        }

        sse(res, 'tool', { tool: call.name, state: 'running' });
        const result = await bookTools.execute(call.name, args, userId, req);

        // A voice login creates the session mid-conversation: pick it up so the
        // booking they were already asking for can go ahead in the same breath.
        if (!userId && req.session?.userId) {
          userId = req.session.userId;
          sse(res, 'login', { userId });
        }

        await audit(userId, call.name, args, result, false);
        sse(res, 'tool', { tool: call.name, state: 'done', ok: result.ok !== false });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
    }

    sse(res, 'delta', {
      text: "I got stuck working that one out — could you say it a slightly different way?",
    });
    sse(res, 'done', { exhausted: true });
    res.end();
  } catch (err) {
    console.error('[BookAgent] error:', err.message);
    var text =
      err.message === 'no_provider'
        ? "My assistant service is down at the moment, so I can't answer right now — nothing was booked. You can still book from the Book tab as normal."
        : 'Something went wrong on my side — nothing was booked.';
    sse(res, 'delta', { text });
    sse(res, 'done', { error: true });
    res.end();
  }
});

module.exports = router;
