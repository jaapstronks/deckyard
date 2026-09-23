/**
 * Notion API Client
 * Low-level API client for Notion integration.
 */

import { AppError, RateLimitError } from '../errors.js';
import { logError } from '../logger.js';
import { envStr } from '../../config/utils.js';

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
    NOTION_RATE_LIMIT.tokens + elapsed * NOTION_RATE_LIMIT.refillPerMs,
  );
  NOTION_RATE_LIMIT.lastRefill = now;

  if (NOTION_RATE_LIMIT.tokens < 1) {
    const waitMs = Math.ceil(
      (1 - NOTION_RATE_LIMIT.tokens) / NOTION_RATE_LIMIT.refillPerMs,
    );
    const err = new RateLimitError(
      `Notion rate limit exceeded. Retry in ${waitMs}ms.`,
    );
    err.retryAfterMs = waitMs;
    throw err;
  }

  NOTION_RATE_LIMIT.tokens -= 1;
}

function getNotionSecret() {
  return envStr('NOTION_SECRET');
}

export function notionEnabled() {
  return !!getNotionSecret();
}

/**
 * The one sentence a Notion surface says when the integration is switched off.
 *
 * It lives next to the switch because both surfaces that report it need it:
 * the 501 routes answer it as the envelope's `message`
 * (`refuseNotionUnconfigured()` in `server/routes/api/notion/utils.js`) and the
 * converter pushes it onto its report. Two spellings of one refusal is drift.
 * @type {string}
 */
export const NOTION_NOT_CONFIGURED_MESSAGE =
  'Notion is not configured. Set NOTION_SECRET on the server to enable this feature.';

function notionHeaders() {
  return {
    Authorization: `Bearer ${getNotionSecret()}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };
}

/**
 * What a Notion request that did not succeed means, decided by Notion's status
 * alone (B416) - never by Notion's wording, which is not ours to put on the
 * wire. A 404 or 403 is a page the integration cannot see, and a 401 is a
 * token Notion does not accept; both get the one fix a user can make. Every
 * other failure - a 400, a 429, a 5xx, an HTML error page, no answer at all -
 * is `502 bad_gateway` with {@link NOTION_REFUSAL}: the upstream status stays
 * in the log, so a 401 on our own token never reads as "you are signed out".
 */
const NOTION_REFUSAL = 'Notion could not complete this request';

/** @type {Record<number, string>} */
const NOTION_NOT_SHARED = {
  404: 'Notion page not found. Make sure the page is shared with your Notion integration.',
  401: 'Access denied. Make sure the page is shared with your Notion integration.',
  403: 'Access denied. Make sure the page is shared with your Notion integration.',
};

/**
 * The one seam to the Notion API: every Notion call goes through here.
 *
 * @param {string} path - Path under `https://api.notion.com/v1`.
 * @param {{ method?: string, body?: object | null }} [opts]
 * @returns {Promise<any>} - The parsed body of a successful answer.
 * @throws {AppError} - `501` when unconfigured, `400` with a
 *   {@link NOTION_NOT_SHARED} sentence for 401/403/404, `502 bad_gateway` with
 *   {@link NOTION_REFUSAL} for any other failure.
 * @throws {RateLimitError} - When our own token bucket is empty.
 */
export async function notionFetchJson(
  path,
  { method = 'GET', body = null } = {},
) {
  if (!notionEnabled()) {
    throw new AppError(NOTION_NOT_CONFIGURED_MESSAGE, 501);
  }

  // Apply rate limiting before making request
  consumeNotionRateLimit();

  const where = `${method} ${path.split('?')[0]}`;
  let res;
  try {
    res = await fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: notionHeaders(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    logError('notion', `${where} did not reach Notion:`, err);
    throw new AppError(NOTION_REFUSAL, 502);
  }
  const ct = res.headers.get('content-type') || '';
  const payload = ct.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');
  if (!res.ok) {
    logError('notion', `${where} answered ${res.status}:`, payload);
    const notShared = NOTION_NOT_SHARED[res.status];
    if (notShared) throw new AppError(notShared, 400);
    throw new AppError(NOTION_REFUSAL, 502);
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
      { method: 'GET' },
    );
    const results = Array.isArray(resp?.results) ? resp.results : [];
    out.push(...results);
    if (!resp?.has_more || !resp?.next_cursor) break;
    cursor = String(resp.next_cursor || '') || null;
    if (!cursor) break;
  }
  return out;
}
