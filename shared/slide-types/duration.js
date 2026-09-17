/**
 * A length of time declared on a `number` field: `duration: { secondsKey }`.
 *
 * Two numbers, minutes and seconds, are one length. The canvas counts it down
 * and the reader states it; both read it here, so they cannot disagree about
 * what a slide with `durationMinutes: 90` or two zeros means (D131).
 *
 * The rules are the declaration's, not a type's:
 *  - each part is clamped to its own field's `min`/`max`, and a blank or
 *    non-numeric part is its declared default;
 *  - a length of zero is no length, so the declared defaults stand in.
 *
 * @module shared/slide-types/duration
 */

/**
 * @param {unknown} value
 * @param {{min?: number, max?: number}|undefined} field
 * @param {unknown} fallback
 * @returns {number}
 */
function part(value, field, fallback) {
  const read = (v) => {
    if (v == null || v === '') return NaN;
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : NaN;
  };
  let n = read(value);
  if (Number.isNaN(n)) n = read(fallback);
  if (Number.isNaN(n)) n = 0;
  const min = Number.isFinite(Number(field?.min)) ? Number(field.min) : 0;
  const max = Number.isFinite(Number(field?.max)) ? Number(field.max) : n;
  return Math.min(Math.max(n, min), Math.max(min, max));
}

/**
 * The length, in seconds, that a `duration` field and its seconds sibling
 * describe for this content.
 *
 * @param {{key: string, min?: number, max?: number, duration?: {secondsKey?: string}}} field
 *   the minutes field that declares `duration`
 * @param {Array<object>} fields - every field beside it
 * @param {object} content
 * @param {object} [defaults] - the declared defaults for `content`
 * @returns {number}
 */
export function durationSeconds(field, fields, content, defaults) {
  const secondsKey = field?.duration?.secondsKey;
  const secondsField = (Array.isArray(fields) ? fields : []).find(
    (f) => f?.key === secondsKey && f.type === 'number',
  );
  const total = (c, d) =>
    part(c?.[field.key], field, d?.[field.key]) * 60 +
    (secondsField ? part(c?.[secondsKey], secondsField, d?.[secondsKey]) : 0);
  const own = total(content, defaults);
  return own > 0 ? own : total(defaults, {});
}

/**
 * A length as an ISO 8601 duration (`PT5M`, `PT1M30S`, `PT45S`), the value of
 * `<time datetime>`.
 * @param {number} seconds
 * @returns {string}
 */
export function isoDuration(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  if (!m && !s) return 'PT0S';
  return `PT${m ? `${m}M` : ''}${s ? `${s}S` : ''}`;
}

/**
 * A length as the reader writes it: `m:ss` (`5:00`, `1:30`).
 * @param {number} seconds
 * @returns {string}
 */
export function clockDuration(seconds) {
  const t = Math.max(0, Math.floor(seconds));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
