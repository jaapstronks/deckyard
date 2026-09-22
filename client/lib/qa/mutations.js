/**
 * Every write on the audience-question surface, in one place.
 *
 * The five calls were spelled out inline in three views, each with its own
 * `encodeURIComponent` interpolation and its own `JSON.stringify({})` body
 * (B153). A path built at the call site is a path that can drift from the
 * route it targets; these are the only spellings.
 *
 * `api` is injected rather than imported so the views keep passing the same
 * instance they already thread through (and so a test can hand in a double).
 */

/** @typedef {(path: string, init?: Object) => Promise<any>} ApiFn */

/**
 * The audience-facing question route for a presentation.
 * @param {string} presentationId
 * @param {string} [suffix] - Path appended after the questions segment
 * @returns {string}
 */
function followPath(presentationId, suffix = '') {
  return `/api/follow/${encodeURIComponent(String(presentationId || ''))}/questions${suffix}`;
}

/**
 * The moderator route for one question.
 * @param {string} presentationId
 * @param {string} questionId
 * @param {string} action - 'promote' or 'remove'
 * @returns {string}
 */
function moderatePath(presentationId, questionId, action) {
  return (
    `/api/moderate/${encodeURIComponent(String(presentationId || ''))}` +
    `/questions/${encodeURIComponent(String(questionId || ''))}/${action}`
  );
}

/**
 * Fetch the current question list for a presentation.
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @returns {Promise<Object>} The raw envelope: { status, questions, capabilities }
 */
export function fetchQuestions(api, presentationId) {
  return api(followPath(presentationId));
}

/**
 * What this caller may do on the moderator surface: `{ canPromote, canRemove }`.
 *
 * The answer comes from the server because the two gates are not the same rule
 * and one of them (promote) needs the deck's collaborator row, which no client
 * holds. A view that decides for itself gets it wrong in one direction or the
 * other — see the route's own note (B365/D182).
 *
 * Any failure is `false, false`: the moderator route sits behind the login
 * gate, so an anonymous companion — which is the ordinary case for a join
 * link — is answered 401 rather than an envelope. That is not an error worth
 * surfacing; it is the answer.
 *
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @returns {Promise<{canPromote: boolean, canRemove: boolean}>}
 */
export async function fetchModerationCapabilities(api, presentationId) {
  const none = { canPromote: false, canRemove: false };
  if (!presentationId) return none;
  try {
    const out = await api(
      `/api/moderate/${encodeURIComponent(String(presentationId))}/questions/capabilities`,
    );
    return {
      canPromote: !!out?.canPromote,
      canRemove: !!out?.canRemove,
    };
  } catch {
    return none;
  }
}

/**
 * Ask a question as an audience member.
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @param {Object} payload
 * @param {string} [payload.authorName] - Display name, blank for anonymous
 * @param {string} [payload.lang] - The asker's language
 * @param {string} payload.text - The question
 * @returns {Promise<Object>} The raw envelope, carrying `question`
 */
export function askQuestion(api, presentationId, { authorName, lang, text }) {
  return api(followPath(presentationId), {
    method: 'POST',
    body: { authorName, lang, text },
  });
}

/**
 * Upvote a question.
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @param {string} questionId
 * @returns {Promise<Object>}
 */
export function upvoteQuestion(api, presentationId, questionId) {
  return api(
    followPath(
      presentationId,
      `/${encodeURIComponent(String(questionId || ''))}/upvote`,
    ),
    { method: 'POST', body: {} },
  );
}

/**
 * Withdraw a question you asked yourself.
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @param {string} questionId
 * @returns {Promise<Object>}
 */
export function cancelQuestion(api, presentationId, questionId) {
  return api(
    followPath(
      presentationId,
      `/${encodeURIComponent(String(questionId || ''))}/cancel`,
    ),
    { method: 'POST', body: {} },
  );
}

/**
 * Promote a question into a slide (moderator).
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @param {string} questionId
 * @param {Object} [options]
 * @param {string} [options.position] - 'next' or 'end'
 * @param {number} [options.afterSlideIndex] - Insertion point for 'next'
 * @returns {Promise<Object>}
 */
export function promoteQuestion(
  api,
  presentationId,
  questionId,
  { position = 'end', afterSlideIndex } = {},
) {
  const body =
    position === 'next' ? { position, afterSlideIndex } : { position };
  return api(moderatePath(presentationId, questionId, 'promote'), {
    method: 'POST',
    body,
  });
}

/**
 * Remove a question (moderator).
 * @param {ApiFn} api - The client's api() function
 * @param {string} presentationId
 * @param {string} questionId
 * @returns {Promise<Object>}
 */
export function removeQuestion(api, presentationId, questionId) {
  return api(moderatePath(presentationId, questionId, 'remove'), {
    method: 'POST',
    body: {},
  });
}
