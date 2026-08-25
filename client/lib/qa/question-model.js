/**
 * The audience question model — one shape, one text accessor, one ranking.
 *
 * The views that render the live question list (the follow page, the
 * presenter's notes panel — plus a moderator route since retired, B156) each
 * used to read the wire object itself, and they disagreed on which field
 * carried the text (B153).
 *
 * `publicQuestion()` in server/storage/questions.js labels `text` as
 * "Back-compat: `text` is the original text" and sets `original.text` from the
 * same column, so the readings agree *today* — the divergence is latent, not
 * live. It stops being latent the moment `text` starts carrying anything but
 * the original (the `texts` map next to it exists for exactly that), and then
 * a moderator would be deleting a question whose text they never saw. One
 * accessor removes the question.
 *
 * Normalizing here also means a view never re-derives `upvotes`, `isPromoted`
 * or a trimmed author name — three copies of each of those is how the readings
 * drifted apart in the first place.
 */

/**
 * The text of a question as asked.
 *
 * `original.text` is canonical; `text` is the documented back-compat alias and
 * the fallback for any payload that predates it.
 *
 * @param {Object} [item] - A question from /api/follow/:id/questions
 * @returns {string} The trimmed question text, or '' when there is none
 */
export function questionText(item) {
  const original = item?.original?.text;
  const raw = typeof original === 'string' && original ? original : item?.text;
  return String(raw ?? '').trim();
}

/**
 * @typedef {Object} Question
 * @property {string} id - Question id ('' when the payload carries none)
 * @property {string} text - The question as asked, trimmed
 * @property {string} authorName - Trimmed display name, '' when anonymous
 * @property {number} upvotes - Never negative
 * @property {string} status - Raw status ('active' / 'promoted' / …)
 * @property {boolean} isPromoted - Whether it already became a slide
 * @property {number} createdAt - Epoch millis, 0 when unknown
 */

/**
 * Normalize one wire question into the shape the views render.
 * @param {Object} [item] - A question from the API or an SSE `questions` event
 * @returns {Question}
 */
export function normalizeQuestion(item) {
  const status = String(item?.status || '');
  return {
    id: String(item?.id || '').trim(),
    text: questionText(item),
    authorName: String(item?.authorName || '').trim(),
    upvotes: Math.max(0, Number(item?.upvotes || 0) || 0),
    status,
    isPromoted: status === 'promoted',
    createdAt: Number(item?.createdAt || 0) || 0,
  };
}

/**
 * Normalize a wire list, dropping anything that is not an object.
 * @param {Array} [list] - Questions from the API or an SSE event
 * @returns {Question[]}
 */
export function normalizeQuestions(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((item) => item && typeof item === 'object')
    .map(normalizeQuestion);
}

/**
 * Rank questions the way the server does: promoted first, then by upvotes,
 * then oldest first (`listQuestions` in server/storage/questions.js).
 *
 * Applying it client-side is a no-op for a server list — it exists so an
 * optimistic insert lands in the right place instead of at the end.
 *
 * @param {Question[]} [list] - Normalized questions
 * @returns {Question[]} A ranked copy; the input is not mutated
 */
export function rankQuestions(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => {
    if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
    if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
    return a.createdAt - b.createdAt;
  });
}
