/**
 * Mention markup in comment bodies (phase 3 of the comments & notifications
 * plan). Shared between server (parse at create/update — single source of
 * truth for the stored `mentions` list) and client (render the markup as a
 * styled chip, autocomplete inserts it).
 *
 * Markup: `@[Display Name](user:email@example.com)`
 * The body stays plain text otherwise; escaping is the renderer's job.
 */

const MENTION_RE = /@\[([^\]\n]+)\]\(user:([^()\s]+@[^()\s]+)\)/g;

/**
 * Link markup: `[label](url)`. Deliberately the same shape as a mention minus
 * the leading `@`, so `MENTION_RE` wins on any overlap (it is applied first).
 */
const LINK_RE = /\[([^\]\n]+)\]\(([^()\s]+)\)/g;

/** Schemes a comment link may use. Everything else is not a link. */
const SAFE_LINK_SCHEMES = ['http://', 'https://', 'mailto:'];

/**
 * Validate a comment link target.
 *
 * Comment bodies are written by anyone who can comment, including guests on a
 * share link, so this is an allowlist and not a blocklist: `javascript:`,
 * `data:`, `vbscript:` and anything else simply is not a link, and the markup
 * stays visible as plain text rather than becoming a clickable anchor.
 *
 * @param {string} url
 * @returns {string|null} the URL if usable, otherwise null
 */
export function safeLinkUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  // Embedded control characters or whitespace are how `java\nscript:` style
  // bypasses get smuggled past a prefix check.
  if (/[\u0000-\u0020]/.test(raw)) return null;
  const lower = raw.toLowerCase();
  return SAFE_LINK_SCHEMES.some((s) => lower.startsWith(s)) ? raw : null;
}

/**
 * Build the markup for one link (what the composer's link button inserts).
 * @param {{label: string, url: string}} link
 * @returns {string}
 */
export function linkMarkup({ label, url }) {
  const safeLabel = String(label || '').replace(/[[\]\n]/g, ' ').trim();
  return `[${safeLabel}](${String(url || '').trim()})`;
}

/**
 * Parse all mentions out of a comment body.
 * @param {string} body - Comment body with mention markup
 * @returns {Array<{name: string, email: string}>} deduplicated by email
 * (lowercased), in order of first appearance
 */
export function parseMentions(body) {
  const text = String(body || '');
  const seen = new Set();
  const mentions = [];
  for (const match of text.matchAll(MENTION_RE)) {
    const email = match[2].toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    mentions.push({ name: match[1], email });
  }
  return mentions;
}

/**
 * Split a body into text and mention segments for safe rendering.
 *
 * Mentions only — see `splitCommentSegments` for the full body grammar. Kept
 * because `parseMentions`-adjacent callers care about mentions alone.
 *
 * @param {string} body
 * @returns {Array<{type: 'text', text: string} | {type: 'mention', name: string, email: string}>}
 */
export function splitMentionSegments(body) {
  const text = String(body || '');
  const segments = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'mention', name: match[1], email: match[2].toLowerCase() });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) });
  }
  return segments;
}

/**
 * Split a body into every segment type a comment can contain: text, mentions
 * and links. This is the grammar both render surfaces use — the reader
 * (`comment-body.js`) and the composer (`comment-rich-input.js`) — so a body
 * looks the same while you type it and after you post it.
 *
 * Mentions are matched first: `@[Name](user:x@y)` also matches the link shape
 * once the `@` is consumed, so running links over the mention output would
 * turn every mention into a link.
 *
 * A link whose URL fails `safeLinkUrl` is **not** emitted as a link. Its raw
 * markup stays as literal text, which is the visible, harmless outcome.
 *
 * @param {string} body
 * @returns {Array<{type: 'text', text: string}
 *   | {type: 'mention', name: string, email: string}
 *   | {type: 'link', label: string, url: string}>}
 */
export function splitCommentSegments(body) {
  const out = [];
  for (const seg of splitMentionSegments(body)) {
    if (seg.type !== 'text') {
      out.push(seg);
      continue;
    }
    const text = seg.text;
    let lastIndex = 0;
    for (const match of text.matchAll(LINK_RE)) {
      const url = safeLinkUrl(match[2]);
      if (!url) continue; // leave unsafe markup as literal text
      if (match.index > lastIndex) {
        out.push({ type: 'text', text: text.slice(lastIndex, match.index) });
      }
      out.push({ type: 'link', label: match[1], url });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      out.push({ type: 'text', text: text.slice(lastIndex) });
    }
  }
  return out;
}

/**
 * Replace mention markup with plain `@Name` (for excerpts, emails,
 * webhooks — anywhere the raw markup would leak to the reader).
 * @param {string} body
 * @returns {string}
 */
export function stripMentionMarkup(body) {
  return String(body || '').replace(MENTION_RE, (m, name) => `@${name}`);
}

/**
 * Build the markup for one mention (what the autocomplete inserts).
 * @param {{name: string, email: string}} user
 * @returns {string}
 */
export function mentionMarkup({ name, email }) {
  const safeName = String(name || email || '').replace(/[[\]\n]/g, ' ').trim();
  return `@[${safeName}](user:${String(email || '').trim()})`;
}
