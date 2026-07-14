import { createLlmProvider } from '../provider-base.js';

/**
 * Extract text content from Claude's response format
 */
function coerceClaudeText(body) {
  const parts = Array.isArray(body?.content) ? body.content : [];
  const texts = parts
    .map((p) => (p && p.type === 'text' ? p.text : ''))
    .filter((t) => typeof t === 'string' && t.length);
  return texts.join('');
}

/**
 * Transform OpenAI-style messages to Claude format
 * Claude separates system messages and has a different structure
 */
function openAiMessagesToClaude({ messages = [] } = {}) {
  const sys = [];
  const out = [];

  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== 'object') continue;
    const role = typeof m.role === 'string' ? m.role : '';
    const content = typeof m.content === 'string' ? m.content : '';
    if (!content) continue;
    if (role === 'system') {
      sys.push(content);
      continue;
    }
    if (role === 'user' || role === 'assistant') {
      out.push({ role, content });
    }
  }

  return {
    system: sys.join('\n\n').trim() || null,
    messages: out,
  };
}

/**
 * Request messages content from Claude API
 */
export const requestClaudeMessagesContent = createLlmProvider({
  name: 'claude',
  endpoint: 'https://api.anthropic.com/v1/messages',
  createHeaders: (apiKey) => ({
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  }),
  transformRequest: ({ model, temperature = 0.2, maxTokens = 4096, messages = [] }) => {
    const mapped = openAiMessagesToClaude({ messages });
    // Sampling params were removed on claude-sonnet-5 / opus-4.7+ / fable-5:
    // sending temperature to those models returns a 400. Older models
    // (sonnet-4.x and earlier, still reachable via CLAUDE_MODEL) keep it.
    // Any major version >= 5 is treated as sampling-free too, so future
    // models degrade to default sampling instead of hard-failing the call.
    const samplingRemoved =
      /^claude-(opus-4-[789]|(sonnet|opus|haiku|fable|mythos)-([5-9]\b|[1-9]\d))/.test(
        String(model || '')
      );
    return {
      model,
      max_tokens: Math.max(1, Number(maxTokens || 0) || 4096),
      ...(samplingRemoved ? {} : { temperature }),
      ...(mapped.system ? { system: mapped.system } : {}),
      messages: mapped.messages,
    };
  },
  parseResponse: (bodyText) => {
    let parsed = null;
    try {
      parsed = JSON.parse(bodyText);
    } catch (e) {
      console.warn('[Claude] Failed to parse response JSON:', e.message);
      parsed = null;
    }
    return coerceClaudeText(parsed) || '';
  },
});
