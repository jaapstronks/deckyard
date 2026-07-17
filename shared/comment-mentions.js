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
