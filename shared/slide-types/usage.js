/**
 * The `usage` field: an organization's own rules for filling a slide type.
 *
 * This is the one part of the agent-facing type contract a competitor cannot
 * copy out of a spec. The editorial fields on a catalog entry
 * (`description`/`bestFor`/`notFor`) answer **which type to pick** and are
 * written by whoever authored the type. `usage` answers **how this organization
 * requires that type to be filled** - sources, cut-off dates, mandatory
 * explanations, escalation rules - and is written by the organization itself.
 * It travels in every `get_slide_types` response, so an agent reads it before
 * it builds the slide.
 *
 * Three authoring surfaces write the same field, so the rules live here rather
 * than three times over:
 *  - core types: `usage` on the catalog entry (server/utils/ai/slide-catalog/);
 *  - fork file-JS types: `ai.usage` (server/utils/ai/slide-catalog/custom-loader.js);
 *  - Tier-2 DB types: the `usage` column (server/storage/custom-slide-types.js),
 *    edited in the builder UI.
 *
 * The two entry points differ on purpose:
 *  - `validateUsage` **rejects** over-long text. It guards the authoring paths
 *    (the builder UI, the API), where a human is standing right there and
 *    silently truncating would hide the loss.
 *  - `clampUsage` **truncates** instead. It guards the load paths (a fork's
 *    file-JS definition), where failing hard would take a whole working slide
 *    type down over cosmetics.
 *
 * Shared rather than server-side because the builder UI needs the same limit for
 * its character counter that storage uses for its rejection. When the definition
 * validator lands (forker-slide-type-toolkit.md gap 1a) it consumes these.
 */

/**
 * Max characters of `usage` per slide type.
 *
 * Chosen from what it costs, not from what feels roomy: `usage` ships in every
 * `get_slide_types` response, multiplied by every visible type. At ~31 visible
 * types the worst case is ~31k characters (~8k tokens) - survivable, and only
 * reachable if every single type is filled to the brim, which core types never
 * are. Double the cap and a single tool response could crowd out the answer.
 * Real-world rules run 200-400 characters.
 */
export const USAGE_MAX_LENGTH = 1000;

/** Control characters that have no business in a plain-text rule. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/**
 * Normalize a raw `usage` value to the plain text an agent should receive.
 *
 * Authors write these as indented template literals, so the leading whitespace
 * of the *source file* would otherwise reach the model verbatim (the catalog
 * descriptions have exactly that problem today). Dedent to the shallowest
 * non-blank line, drop stray control characters, and collapse runs of blank
 * lines. Length is deliberately NOT enforced here - the caller decides whether
 * over-length means "reject" or "truncate".
 *
 * @param {unknown} value
 * @returns {string|null} Normalized text, or null when there is nothing to say.
 */
export function normalizeUsage(value) {
  if (typeof value !== 'string') return null;

  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(CONTROL_CHARS, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''));

  let indent = Infinity;
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = line.match(/^[ \t]*/);
    indent = Math.min(indent, match ? match[0].length : 0);
  }
  if (!Number.isFinite(indent)) return null; // nothing but blank lines

  const text = lines
    .map((line) => (line.trim() ? line.slice(indent) : ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text || null;
}

/**
 * Validate an author-supplied `usage` value.
 *
 * A missing/blank value is valid and means "no rule" - the field is optional by
 * design, and demanding one on every type would produce invented filler.
 *
 * @param {unknown} value
 * @returns {{ ok: true, usage: string|null } | { ok: false, reason: string }}
 *   `reason` is `invalid_usage` (not a string) or `usage_too_long`.
 */
export function validateUsage(value) {
  if (value === undefined || value === null || value === '') {
    return { ok: true, usage: null };
  }
  if (typeof value !== 'string') return { ok: false, reason: 'invalid_usage' };

  const usage = normalizeUsage(value);
  if (usage === null) return { ok: true, usage: null };
  if (usage.length > USAGE_MAX_LENGTH)
    return { ok: false, reason: 'usage_too_long' };

  return { ok: true, usage };
}

/**
 * Normalize and truncate a `usage` value for a tolerant load path.
 *
 * Used where rejecting would cost more than it saves: a fork's file-JS type
 * whose rule runs long should lose the tail, not the type.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function clampUsage(value) {
  const usage = normalizeUsage(value);
  if (usage === null) return null;
  if (usage.length <= USAGE_MAX_LENGTH) return usage;
  return `${usage.slice(0, USAGE_MAX_LENGTH - 1).trimEnd()}…`;
}
