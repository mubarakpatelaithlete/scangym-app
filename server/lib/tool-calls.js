/**
 * Tool-call normalisation, shared by the Partner and ScanSquad agents.
 *
 * Why this exists: on 31 Jul 2026 the production OPENAI_API_KEY returned 401, so every
 * conversation fell through to the Groq/Llama backup. Llama streams malformed tool calls
 * — it puts the JSON arguments *inside* the function name:
 *
 *   function.name = 'set_my_handle{"handle": "exercise_reel"}'
 *
 * We replayed that verbatim in the next request, the provider rejected it
 * ("attempted to call tool ... which was not in request.tools"), the route threw, and the
 * creator saw "Something went wrong on my side". Two separate faults, one symptom.
 *
 * So every streamed tool call is normalised and then *validated against the real tool
 * catalogue* before we act on it or echo it back to the model. A call we cannot resolve
 * to a known tool is dropped — the agent asks again rather than guessing, because a
 * wrong answer in these two tabs is worse than no answer.
 */

/**
 * Accumulate streamed tool_call deltas into a dense array of { id, name, args }.
 * Handles sparse indexes (a provider emitting index 1 before index 0 used to produce
 * an array hole, and `for...of` yields `undefined` for holes → TypeError).
 */
function collectToolCalls(deltaToolCalls, calls) {
  for (const tc of deltaToolCalls || []) {
    const i = Number.isInteger(tc.index) ? tc.index : 0;
    if (!calls[i]) calls[i] = { id: '', name: '', args: '' };
    if (tc.id) calls[i].id = tc.id;
    if (tc.function?.name) calls[i].name += tc.function.name;
    if (tc.function?.arguments) calls[i].args += tc.function.arguments;
  }
  return calls;
}

/**
 * Split a possibly-mangled name into a clean name plus any arguments smuggled into it.
 * 'set_my_handle{"handle":"x"}' → { name: 'set_my_handle', inlineArgs: '{"handle":"x"}' }
 */
function splitName(raw) {
  const s = String(raw || '').trim();
  const brace = s.indexOf('{');
  if (brace === -1) return { name: s.replace(/[^A-Za-z0-9_.-]/g, ''), inlineArgs: '' };
  return {
    name: s.slice(0, brace).trim().replace(/[^A-Za-z0-9_.-]/g, ''),
    inlineArgs: s.slice(brace),
  };
}

function parseArgs(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * Normalise + validate. Returns { valid, dropped } where `valid` entries are
 * { id, name, args } with `name` guaranteed to exist in `catalogue`.
 *
 * @param {Array} calls      raw accumulated calls (may be sparse)
 * @param {object} catalogue tools object, keyed by tool name
 * @param {string} tag       log prefix
 */
function normaliseToolCalls(calls, catalogue, tag) {
  const valid = [];
  const dropped = [];

  (calls || []).forEach((call, index) => {
    if (!call || !call.name) return; // array hole, or a call with no name at all
    const { name, inlineArgs } = splitName(call.name);
    const args = parseArgs(call.args || inlineArgs);

    if (!Object.prototype.hasOwnProperty.call(catalogue, name)) {
      dropped.push({ name: name || String(call.name).slice(0, 64), raw: String(call.name).slice(0, 200) });
      console.error(`[${tag}] dropped unknown tool call: ${String(call.name).slice(0, 200)}`);
      return;
    }

    valid.push({
      // A missing id breaks the tool/assistant message pairing on the next round.
      id: call.id || `call_${index}_${Date.now().toString(36)}`,
      name,
      args,
    });
  });

  return { valid, dropped };
}

/** The assistant message that must accompany tool results on the next round. */
function assistantToolMessage(text, valid) {
  return {
    role: 'assistant',
    content: text || null,
    tool_calls: valid.map((c) => ({
      id: c.id,
      type: 'function',
      function: { name: c.name, arguments: JSON.stringify(c.args || {}) },
    })),
  };
}

module.exports = { collectToolCalls, normaliseToolCalls, assistantToolMessage, splitName, parseArgs };
