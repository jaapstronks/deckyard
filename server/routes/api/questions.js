import {
  badRequest,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  requireJsonBody,
  withErrorHandler,
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
import { normalizeLang } from '../../utils/translation-status.js';
import { notifyLiveSessionDeckUpdated } from '../../storage/live-sessions/index.js';
import { canWritePresentation } from '../../utils/presentation-authz.js';
import { dispatchRoutes } from '../../utils/router.js';

// POST /api/moderate/:presentationId/questions/:questionId/remove — moderator removes a question
async function handleQuestionRemove({ repoRoot, storageScope, res, authedUser }, presentationId, questionId) {
  if (!authedUser) return unauthorized(res);
  // "Moderator path" is intended for coworkers; require admin to avoid accidental abuse.
  if (!authedUser.isAdmin) return unauthorized(res, 'Admin required');

  const state = await getFollowStateForPresentation(storageScope, presentationId);
  // Allow moderation even if the session is no longer considered "live" (talk breaks, tab sleep, etc),
  // as long as we can resolve a sessionId for the presentation.
  if (!state.sessionId) return badRequest(res, 'No session found for presentation');

  const result = await removeQuestion(storageScope, state.sessionId, {
    questionId,
    removedBy: authedUser.email || 'moderator',
  });
  if (!result.ok) {
    if (result.reason === 'not_found') return notFound(res);
    return badRequest(res, result.reason);
  }
  serveJson(res, 200, { ok: true });
  return true;
}

// POST /api/moderate/:presentationId/questions/:questionId/promote — promote a question to a slide
async function handleQuestionPromote({ repoRoot, storageScope, req, res, authedUser }, presentationId, questionId) {
  if (!authedUser) return unauthorized(res);

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission }))
    return unauthorized(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const position = body?.position === 'next' ? 'next' : 'end';
  const afterSlideIndex = Number(body?.afterSlideIndex ?? NaN);

  const state = await getFollowStateForPresentation(storageScope, presentationId);
  // Allow promotion even if session isn't "live" anymore, as long as we have a sessionId.
  if (!state.sessionId) return badRequest(res, 'No session found for presentation');

  const q = await getQuestion(storageScope, state.sessionId, questionId);
  if (!q) return notFound(res);

  const dominant =
    normalizeLang(pres?.i18n?.dominant) || 'nl';
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
  nextPres.i18n = nextPres.i18n && typeof nextPres.i18n === 'object' ? nextPres.i18n : {};
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

  for (const lang of ['nl', 'en-GB']) {
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

  const updated = await updatePresentation(storageScope, presentationId, nextPres, {
    actorEmail: authedUser?.email || null,
  });
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
 * matches the previous if-chain. Each path was POST-only with an explicit 405
 * before the auth check, preserved here as a trailing catch-all row.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/remove$/, handler: handleQuestionRemove },
  { pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/remove$/, handler: ({ res }) => methodNotAllowed(res, ['POST']) },
  { method: 'POST', pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/promote$/, handler: handleQuestionPromote },
  { pattern: /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/promote$/, handler: ({ res }) => methodNotAllowed(res, ['POST']) },
];

/**
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleQuestions = withErrorHandler('questions', (ctx) => {
  return dispatchRoutes(ROUTES, ctx);
});
