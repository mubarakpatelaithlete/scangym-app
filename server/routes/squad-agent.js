/**
 * Squad Agent — the ScanSquad tab as a conversation.
 *
 * POST /api/squad/agent        Server-Sent Events: token deltas, tool activity, done
 * GET  /api/squad/agent/tools  The tool catalogue (also feeds the Custom GPT / MCP)
 *
 * Design notes
 * ------------
 * 1. Real streaming. We stream OpenAI deltas and emit a `tool` event the moment the
 *    model decides to act, so the creator sees "Checking your earnings…" instead of
 *    dead air.
 * 2. Writes confirm, reads don't. A write tool only runs when the client sends it back
 *    as a confirmed action; otherwise we hand it to the UI as a Yes/No. Reading stats
 *    needs no ceremony; spending their balance or messaging their followers does.
 * 3. The creator is taken from the session, never from the request body — unlike the
 *    existing /api/creator-growth endpoints, which trust a public handle.
 * 4. Everything the agent does is written to squad_agent_actions — an audit trail, so
 *    "the AI spent my balance" is always answerable.
 */
const express = require('express');
const router = express.Router();
const pool = require('../middleware/db');
const { authenticateUser } = require('../middleware/auth');
const OpenAI = require('openai');
const squadTools = require('../lib/squad-tools');

const MODEL = process.env.SQUAD_AGENT_MODEL || 'gpt-4o-mini';
const MAX_TOOL_ROUNDS = 4;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// Audit trail. Created lazily so a fresh database needs no migration step.
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS squad_agent_actions (
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
      `CREATE INDEX IF NOT EXISTS idx_squad_agent_actions_user
         ON squad_agent_actions(user_id, created_at DESC)`
    );
  } catch (err) {
    console.error('[SquadAgent] audit table init failed:', err.message);
  }
})();

const SYSTEM_PROMPT = `You are the ScanSquad assistant. You work for the creator you are talking to — a fitness content creator on Instagram or TikTok who earns 25% commission when someone books a gym through their link. They are usually on their phone, between posts.

How you behave:
- Do the thing. If they say "pay me out" or "boost my latest reel", call the tool — do not explain where the button is.
- One short answer. Two sentences beats ten. No headings, no bullet lists unless you are listing reels or gyms.
- Money and anything published: say exactly what you are about to do with the number in it, and wait for their yes. Reads (earnings, stats, leaderboard) just run.
- Never invent numbers. If you have not called a tool, you do not know their earnings, clicks or rank.
- If they are not a ScanSquad member yet, explain it in one line (free, 25% per booking) and offer to sign them up.
- If they have no handle, get one — without it their link tracks nothing.
- Be useful about growth: when they ask "how do I earn more", look at get_my_link_performance first and answer with their actual best-converting gym and traffic source, not generic advice.
- Plain British English, warm, no exclamation marks, no emoji unless they use them first.`;

function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function audit(userId, tool, args, result, confirmed) {
  try {
    await pool.query(
      `INSERT INTO squad_agent_actions (user_id, tool, args, result, confirmed)
       VALUES ($1,$2,$3,$4,$5)`,
      [String(userId), tool, JSON.stringify(args || {}), JSON.stringify(result || {}), !!confirmed]
    );
  } catch (err) {
    console.error('[SquadAgent] audit write failed:', err.message);
  }
}

/** Tool catalogue — used by the client for chips and by the Custom GPT / MCP surfaces. */
router.get('/agent/tools', (_req, res) => {
  res.json({
    success: true,
    tools: Object.entries(squadTools.tools).map(([name, t]) => ({
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

  if (!openai) {
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
    // ── Path A: the creator tapped "Yes" on a pending write. Execute it directly;
    //    no model round-trip needed, so confirmations are instant and cannot drift.
    if (confirm && confirm.tool) {
      sse(res, 'tool', { tool: confirm.tool, state: 'running' });
      const result = await squadTools.execute(confirm.tool, confirm.args, userId, req);
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
      const stream = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools: squadTools.openAiTools(),
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

      // No tool wanted → the model has answered in prose. Turn over.
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

        // A write the creator has not approved yet: hand it back for confirmation.
        if (squadTools.isWrite(call.name)) {
          await audit(userId, call.name, args, { pending: true }, false);
          sse(res, 'confirm', {
            tool: call.name,
            args,
            summary: squadTools.tools[call.name].schema.description,
          });
          sse(res, 'done', { awaitingConfirmation: true });
          return res.end();
        }

        sse(res, 'tool', { tool: call.name, state: 'running' });
        const result = await squadTools.execute(call.name, args, userId, req);
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
    console.error('[SquadAgent] error:', err.message);
    sse(res, 'delta', { text: 'Something went wrong on my side — nothing was changed.' });
    sse(res, 'done', { error: true });
    res.end();
  }
});

/** Recent AI-executed actions, so a creator can always see what the assistant did. */
router.get('/agent/history', authenticateUser, async (req, res) => {
  const { rows } = await pool
    .query(
      `SELECT tool, args, result, confirmed, created_at
         FROM squad_agent_actions
        WHERE user_id = $1 AND confirmed = true
        ORDER BY created_at DESC LIMIT 50`,
      [String(req.user.id)]
    )
    .catch(() => ({ rows: [] }));
  res.json({ success: true, actions: rows });
});

module.exports = router;
