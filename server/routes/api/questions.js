import {
  badRequest,
  methodNotAllowed,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  unauthorized,
  withErrorHandler,
  forbidden,
} from '../../utils/http.js';
import { getFollowStateForPresentation } from '../../storage/live-sessions/index.js';
import crypto from 'node:crypto';
import {
  getQuestion,
  promoteQuestion,
  removeQuestion,
} from '../../storage/questions.js';
import {
  getPresentation,
  updatePresentation,
} from '../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../storage/collaborators.js';
import { notifyLiveSessionDeckUpdated } from '../../storage/live-sessions/index.js';
import { canWritePresentation } from '../../utils/presentation-authz/index.js';
import { isOrganizationAdmin } from '../../../shared/organization-role.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
  TRANSLATION_LANGS,
} from '../../../shared/i18n-utils.js';

/**
 * Whether this user may remove a question from the feed.
 *
 * "Moderator path" is intended for coworkers; require admin to avoid
 * accidental abuse. Admin *of the workspace this deck lives in* — an instance
 * admin who is a plain member of the active organization is not a moderator
 * here (shared/organization-role.js). Deliberately blind to the deck: the
 * deck's own owner does not get this hatch, which
 * tests/question-moderation-routes.test.js pins.
 *
 * @param {Object|null} [authedUser]
 * @returns {boolean}
 */
function canRemoveQuestions(authedUser) {
  return !!authedUser && isOrganizationAdmin(authedUser);
}

/**
 * Whether this user may promote a question into this deck.
 *
 * Promotion inserts a slide, so it follows the *deck*, not the instance —
 * `canWritePresentation` consults `isUnrestricted`, never `isAdmin`. The two
 * gates of this module each refuse exactly whom the other admits, on purpose.
 *
 * @param {Object} storageScope
 * @param {Object|null} authedUser
 * @param {Object|null} pres - The deck, already read under `storageScope`
 * @returns {Promise<boolean>}
 */
async function canPromoteQuestions(storageScope, authedUser, pres) {
  if (!authedUser || !pres) return false;
  const collaboratorPermission =
    authedUser.email && pres.id
      ? await getCollaboratorPermission(pres.id, authedUser.email)
      : null;
  return canWritePresentation({
    user: authedUser,
    pres,
    collaboratorPermission,
  });
}

/**
 * GET /api/moderate/:presentationId/questions/capabilities
 *
 * What this caller may do on this deck's question feed — the same two
 * predicates the POST handlers gate on, reported rather than re-derived.
 *
 * The notes companion used to answer this for itself with
 * `isOrganizationAdmin(user)`, which is the remove rule, not the promote one:
 * an editor-collaborator could promote through the API and never saw the
 * button (B365). A client that owns a second reading of a server rule shows a
 * control whose request is refused, or hides one whose request would have been
 * allowed — the failure shared/organization-role.js was written to end. There
 * the fix was a shared predicate; here it cannot be, because
 * `canWritePresentation` needs the collaborator row and the storage scope. So
 * the rule stays on the server and the surface asks (D182).
 *
 * Anonymous is a 401, the same answer the login gate in `handleApi` gives
 * before this handler runs and the one both POST actions below give. It used
 * to be 200 `{false, false}`, a second answer to the same caller that no
 * request in the running app could reach (B409). The client reads the 401 as
 * "no moderator controls" (`fetchModerationCapabilities`).
 */
async function handleQuestionCapabilities(
  { storageScope, res, authedUser },
  presentationId,
) {
  if (!authedUser) return unauthorized(res);
  const pres = await getPresentation(storageScope, presentationId);
  serveJson(res, 200, {
    canPromote: await canPromoteQuestions(storageScope, authedUser, pres),
    canRemove: canRemoveQuestions(authedUser),
  });
  return true;
}

// POST /api/moderate/:presentationId/questions/:questionId/remove — moderator removes a question
async function handleQuestionRemove(
  { repoRoot, storageScope, res, authedUser },
  presentationId,
  questionId,
) {
  if (!authedUser) return unauthorized(res);
  if (!canRemoveQuestions(authedUser)) return forbidden(res, 'Admin required');

  const state = await getFollowStateForPresentation(
    storageScope,
    presentationId,
  );
  // Allow moderation even if the session is no longer considered "live" (talk breaks, tab sleep, etc),
  // as long as we can resolve a sessionId for the presentation.
  if (!state.sessionId)
    return badRequest(res, 'No session found for presentation');

  const result = await removeQuestion(storageScope, state.sessionId, {
    questionId,
    removedBy: authedUser.email || 'moderator',
  });
  if (!result.ok) {
    return storageError(res, result);
  }
  serveJson(res, 200, { ok: true });
  return true;
}

// POST /api/moderate/:presentationId/questions/:questionId/promote — promote a question to a slide
async function handleQuestionPromote(
  { repoRoot, storageScope, req, res, authedUser },
  presentationId,
  questionId,
) {
  if (!authedUser) return unauthorized(res);

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  if (!(await canPromoteQuestions(storageScope, authedUser, pres)))
    return forbidden(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const position = body?.position === 'next' ? 'next' : 'end';
  const afterSlideIndex = Number(body?.afterSlideIndex ?? NaN);

  const state = await getFollowStateForPresentation(
    storageScope,
    presentationId,
  );
  // Allow promotion even if session isn't "live" anymore, as long as we have a sessionId.
  if (!state.sessionId)
    return badRequest(res, 'No session found for presentation');

  const q = await getQuestion(storageScope, state.sessionId, questionId);
  if (!q) return notFound(res);

  const dominant = normalizeLang(pres?.i18n?.dominant) || DEFAULT_DECK_LANG;
  const texts = q.texts && typeof q.texts === 'object' ? q.texts : {};
  const originalText = String(q.text || '').trim();

  const pickText = (lang) => {
    const t = typeof texts?.[lang] === 'string' ? texts[lang] : '';
    return String(t || originalText || '').trim();
  };

  const titleFor = (lang) => {
    const raw = pickText(lang);
    const clipped = raw.length > 140 ? `${raw.slice(0, 137).trim()}…` : raw;
    return clipped || (lang === 'nl' ? 'Vraag' : 'Question');
  };

  const slideId =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');

  const baseNotes = [
    'Q&A question',
    '',
    originalText ? `Original: ${originalText}` : '',
    q.authorName ? `Asked by: ${String(q.authorName).trim()}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const makeSlide = (lang) => ({
    id: slideId,
    type: 'chapter-title-slide',
    content: { title: titleFor(lang) },
    notes: baseNotes,
  });

  const insertAt = (arr, idx, slide) => {
    const a = Array.isArray(arr) ? arr : [];
    const i = Math.max(0, Math.min(a.length, Number(idx || 0) || 0));
    a.splice(i, 0, slide);
    return a;
  };

  // Insert into top-level slides (dominant view) and into any i18n versions that exist.
  const nextPres = { ...pres };
  nextPres.slides = Array.isArray(nextPres.slides) ? [...nextPres.slides] : [];
  nextPres.i18n =
    nextPres.i18n && typeof nextPres.i18n === 'object' ? nextPres.i18n : {};
  nextPres.i18n.versions =
    nextPres.i18n.versions && typeof nextPres.i18n.versions === 'object'
      ? { ...nextPres.i18n.versions }
      : {};

  const insertIndex =
    position === 'end'
      ? nextPres.slides.length
      : Number.isFinite(afterSlideIndex)
        ? Math.max(0, afterSlideIndex + 1)
        : Math.max(0, Number(state.slideIndex || 0) + 1);

  insertAt(nextPres.slides, insertIndex, makeSlide(dominant));

  for (const lang of TRANSLATION_LANGS) {
    const v = nextPres.i18n.versions?.[lang];
    if (!v || typeof v !== 'object') continue;
    const slides = Array.isArray(v.slides) ? [...v.slides] : [];
    const idx =
      position === 'end'
        ? slides.length
        : Math.max(0, Math.min(slides.length, insertIndex));
    insertAt(slides, idx, makeSlide(lang));
    nextPres.i18n.versions[lang] = {
      title: typeof v.title === 'string' ? v.title : nextPres.title,
      slides,
    };
  }

  const updated = await updatePresentation(
    storageScope,
    presentationId,
    nextPres,
    {
      actorEmail: authedUser?.email || null,
    },
  );
  // Lock / mark promoted so audience sees it will be addressed (and voting/removal stops).
  await promoteQuestion(storageScope, state.sessionId, {
    questionId,
    slideId,
    promotedBy: authedUser.email || 'moderator',
  });
  notifyLiveSessionDeckUpdated(storageScope, state.sessionId, {
    presentationId,
    slideId,
    reason: 'question_promoted',
  });
  serveJson(res, 200, { ok: true, slideId, presentation: updated });
  return true;
}

/**
 * Declarative route table for the moderator question actions (A7.19 C8). Order
 * matches the previous if-chain. Each action path is POST-only with an explicit
 * 405 before the auth check, kept as a trailing catch-all row; `capabilities`
 * is the read half and follows the same shape one method over. It sits first
 * because it is the only two-segment path here — `:questionId` never matches
 * it, but reading the table top-down should not require checking that.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: /^\/api\/moderate\/([^/]+)\/questions\/capabilities$/,
    captures: ['uuid'],
    handler: handleQuestionCapabilities,
  },
  {
    pattern: /^\/api\/moderate\/([^/]+)\/questions\/capabilities$/,
    captures: ['uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
  {
    method: 'POST',
    pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/remove$/,
    captures: ['uuid', 'uuid'],
    handler: handleQuestionRemove,
  },
  {
    pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/remove$/,
    captures: ['uuid', 'uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
  },
  {
    method: 'POST',
    pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/promote$/,
    captures: ['uuid', 'uuid'],
    handler: handleQuestionPromote,
  },
  {
    pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/promote$/,
    captures: ['uuid', 'uuid'],
    handler: ({ res }) => methodNotAllowed(res, ['POST']),
  },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleQuestions = withErrorHandler('questions', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
