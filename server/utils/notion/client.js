/**
 * Notion API Client
 * Low-level API client for Notion integration.
 */

// Simple token bucket rate limiter for Notion API
// Notion allows 3 requests/second average, we'll be conservative
const NOTION_RATE_LIMIT = {
  capacity: 10,
  refillPerMs: 3 / 1000, // 3 tokens per second
  tokens: 10,
  lastRefill: Date.now(),
};

function consumeNotionRateLimit() {
  const now = Date.now();
  const elapsed = now - NOTION_RATE_LIMIT.lastRefill;
  NOTION_RATE_LIMIT.tokens = Math.min(
    NOTION_RATE_LIMIT.capacity,
    NOTION_RATE_LIMIT.tokens + elapsed * NOTION_RATE_LIMIT.refillPerMs
  );
  NOTION_RATE_LIMIT.lastRefill = now;

  if (NOTION_RATE_LIMIT.tokens < 1) {
    const waitMs = Math.ceil((1 - NOTION_RATE_LIMIT.tokens) / NOTION_RATE_LIMIT.refillPerMs);
    const err = new Error(`Notion rate limit exceeded. Retry in ${waitMs}ms.`);
    err.statusCode = 429;
    err.retryAfterMs = waitMs;
    throw err;
  }

  NOTION_RATE_LIMIT.tokens -= 1;
}

function getNotionSecret() {
  return String(process.env.NOTION_SECRET || '').trim();
}

export function notionEnabled() {
  return !!getNotionSecret();
}

function notionHeaders() {
  return {
    Authorization: `Bearer ${getNotionSecret()}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

export async function notionFetchJson(path, { method = 'GET', body = null } = {}) {
  if (!notionEnabled()) {
    const err = new Error('Notion is not configured');
    err.statusCode = 501;
    throw err;
  }

  // Apply rate limiting before making request
  consumeNotionRateLimit();

  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: notionHeaders(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json')
    ? await res.json()
    : await res.text();
  if (!res.ok) {
    const msg =
      payload && typeof payload === 'object'
        ? payload?.message || payload?.error || `Notion request failed (${res.status})`
        : String(payload || '').trim() || `Notion request failed (${res.status})`;
    const err = new Error(msg);
    err.statusCode = res.status;
    err.details = payload && typeof payload === 'object' ? payload : null;
    throw err;
  }
  return payload;
}

export async function fetchAllBlockChildren(blockId, { limit = 400 } = {}) {
  const out = [];
  let cursor = null;
  while (out.length < limit) {
    const qs = new URLSearchParams();
    qs.set('page_size', String(Math.min(100, limit - out.length)));
    if (cursor) qs.set('start_cursor', cursor);
    const resp = await notionFetchJson(
      `/blocks/${encodeURIComponent(blockId)}/children?${qs.toString()}`,
      { method: 'GET' }
    );
    const results = Array.isArray(resp?.results) ? resp.results : [];
    out.push(...results);
    if (!resp?.has_more || !resp?.next_cursor) break;
    cursor = String(resp.next_cursor || '') || null;
    if (!cursor) break;
  }
  return out;
}