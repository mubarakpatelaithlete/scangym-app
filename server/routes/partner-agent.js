/**
 * Partner Agent — the Partner tab as a conversation.
 *
 * POST /api/partner/agent        Server-Sent Events: token deltas, tool activity, done
 * GET  /api/partner/agent/tools  The tool catalogue (also feeds the Custom GPT / MCP)
 *
 * Design notes
 * ------------
 * 1. Real streaming. The web chat used to fake it by revealing a finished string on a
 *    timer, which makes tool use impossible to show. Here we stream OpenAI deltas and
 *    emit a `tool` event the moment the model decides to act, so the owner sees
 *    "Updating your price…" instead of dead air.
 * 2. Writes confirm, reads don't. A write tool is only executed when the client sends
 *    `confirmed: true` alongside the pending action; otherwise we return the action for
 *    the UI to show a Yes/No. Reading earnings needs no ceremony; moving money does.
 * 3. Everything the agent does is written to partner_agent_actions — an audit trail, so
 *    "the AI changed my price" is always answerable.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');
const llm = require('../lib/llm');
const { collectToolCalls, normaliseToolCalls, assistantToolMessage } = require('../lib/tool-calls');
const partnerTools = require('../lib/partner-tools');

const MAX_TOOL_ROUNDS = 4;


// Audit trail. Created lazily so a fresh database needs no migration step.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partner_agent_actions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        tool VARCHAR(64) NOT NULL,
        args JSONB,
        result JSONB,
        confirmed BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_partner_agent_actions_user
         ON partner_agent_actions(user_id, created_at DESC)`
    );
  } catch (err) {
    console.error('[PartnerAgent] audit table init failed:', err.message);
  }
})();

const SYSTEM_PROMPT = `You are the ScanGym Partner assistant. You work for the gym owner you are talking to — an independent gym owner, usually not technical, often on their phone behind the front desk.

How you behave:
- Do the thing. If they say "make my day pass £6", call set_day_price — do not explain how to find the settings screen.
- One short answer. Two sentences beats ten. No headings, no bullet lists unless you are listing bookings.
- Money and state changes: say exactly what you are about to do with the number in it, and wait for their yes. Reads (earnings, bookings, customers) just run.
- Never invent numbers. If you have not called a tool, you do not know their earnings.
- Never report state you have not read. Anything about the smart lock or QR entry working requires get_smart_lock_status first — say "not connected" plainly when it is not, and never say a door is verified unless the tool says so.
- If they have not claimed a gym yet, search for it by name and offer to claim it.
- ScanGym takes 15%, the owner keeps 85%. Day passes must be between £3 and £25.
- Plain British English, warm, no exclamation marks, no emoji unless they use them first.`;

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function audit(userId, tool, args, result, confirmed) {
  try {
    await pool.query(
      `INSERT INTO partner_agent_actions (user_id, tool, args, result, confirmed)
       VALUES ($1,$2,$3,$4,$5)`,
      [String(userId), tool, JSON.stringify(args || {}), JSON.stringify(result || {}), !!confirmed]
    );
  } catch (err) {
    console.error('[PartnerAgent] audit write failed:', err.message);
  }
}

/** Tool catalogue — used by the client for chips and by the Custom GPT / MCP surfaces. */
router.get('/agent/tools', (_req, res) => {
  res.json({
    success: true,
    tools: Object.entries(partnerTools.tools).map(([name, t]) => ({
      name,
      write: t.write,
      description: t.schema.description,
      parameters: t.schema.parameters,
    })),
  });
});

router.post('/agent', authenticateUser, express.json(), async (req, res) => {
  const userId = req.user.id;
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
    // ── Path A: the owner tapped "Yes" on a pending write. Execute it directly;
    //    no model round-trip needed, so confirmations are instant and cannot drift.
    if (confirm && confirm.tool) {
      sse(res, 'tool', { tool: confirm.tool, state: 'running' });
      const result = await partnerTools.execute(confirm.tool, confirm.args, userId, req);
      await audit(userId, confirm.tool, confirm.args, result, true);
      sse(res, 'tool', { tool: confirm.tool, state: 'done', ok: result.ok !== false });
      sse(res, 'delta', { text: result.message || (result.ok ? 'Done.' : 'That did not work.') });
      sse(res, 'done', { result });
      return res.end();
    }

    // ── Path B: normal turn. Let the model read state and decide.
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history
        .filter((m) => m && m.role && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: String(m.content) })),
      { role: 'user', content: String(message) },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      // Model choice and provider failover live in lib/llm.js.
      const { stream } = await llm.streamChat('PartnerAgent', {
        messages,
        tools: partnerTools.openAiTools(),
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

        collectToolCalls(delta.tool_calls, calls);
      }

      // No tool wanted → the model has answered in prose. Turn over.
      if (!calls.length) {
        sse(res, 'done', { text });
        return res.end();
      }

      // Normalise before we trust any of it. A mangled or unknown tool name is dropped
      // rather than replayed to the provider, which used to abort the whole answer.
      const { valid, dropped } = normaliseToolCalls(calls, partnerTools.tools, 'PartnerAgent');

      if (!valid.length) {
        const asked = dropped[0]?.name;
        sse(res, 'delta', {
          text: asked
            ? `I can't do "${asked}" from here yet — ask me another way and I'll tell you what I can do.`
            : "I didn't quite follow that — could you say it a slightly different way?",
        });
        sse(res, 'done', { droppedToolCalls: dropped });
        return res.end();
      }

      messages.push(assistantToolMessage(text, valid));

      for (const call of valid) {
        const args = call.args || {};

        // A write the owner has not approved yet: hand it back for confirmation.
        if (partnerTools.isWrite(call.name)) {
          await audit(userId, call.name, args, { pending: true }, false);
          sse(res, 'confirm', {
            tool: call.name,
            args,
            summary: partnerTools.tools[call.name]?.schema?.description || call.name,
          });
          sse(res, 'done', { awaitingConfirmation: true });
          return res.end();
        }

        sse(res, 'tool', { tool: call.name, state: 'running' });
        const result = await partnerTools.execute(call.name, args, userId, req);
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
    console.error('[PartnerAgent] error:', err.message);
    // The owner does not care which vendor is down; they care that nothing broke and
    // whether it is worth trying again. Say which of those two it is.
    var text =
      err.message === 'no_provider'
        ? "My assistant service is down at the moment, so I can't answer right now — nothing was changed. Everything else in the app works as normal."
        : 'Something went wrong on my side — nothing was changed.';
    sse(res, 'delta', { text });
    sse(res, 'done', { error: true });
    res.end();
  }
});

/** Recent AI-executed actions, so an owner can always see what the assistant did. */
router.get('/agent/history', authenticateUser, async (req, res) => {
  const { rows } = await pool
    .query(
      `SELECT tool, args, result, confirmed, created_at
         FROM partner_agent_actions
        WHERE user_id = $1 AND confirmed = true
        ORDER BY created_at DESC LIMIT 50`,
      [String(req.user.id)]
    )
    .catch(() => ({ rows: [] }));
  res.json({ success: true, actions: rows });
});

module.exports = router;
