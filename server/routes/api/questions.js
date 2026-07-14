import {
  badRequest,
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import { getFollowStateForPresentation } from '../../storage/present-sessions.js';
import crypto from 'node:crypto';
import {
  ensureQuestionsSession,
  getQuestionsSession,
  promoteQuestion,
  removeQuestion,
} from '../../storage/questions.js';
import {
  getPresentation,
  updatePresentation,
} from '../../storage/presentations.js';
import { getCollaboratorPermission } from '../../storage/collaborators.js';
import { createRouteContext } from '../../utils/context.js';
import { normalizeLang, otherLang } from '../../utils/translation-status.js';
import { notifyPresentSessionDeckUpdated } from '../../storage/present-sessions.js';
import { canWritePresentation } from '../../utils/presentation-authz.js';

export async function handleQuestions({ repoRoot, req, res, url, authedUser }) {
  // Moderator actions (auth required by api/index.js).
  const removeMatch = url.pathname.match(
    /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/remove$/
  );
  if (removeMatch) {
    const presentationId = removeMatch[1];
    const questionId = removeMatch[2];
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (!authedUser) return unauthorized(res);
    // "Moderator path" is intended for coworkers; require admin to avoid accidental abuse.
    if (!authedUser.isAdmin) return unauthorized(res, 'Admin required');

    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    // Allow moderation even if the session is no longer considered "live" (talk breaks, tab sleep, etc),
    // as long as we can resolve a sessionId for the presentation.
    if (!state.sessionId) return badRequest(res, 'No session found for presentation');

    await ensureQuestionsSession(repoRoot, state.sessionId, { presentationId });
    const result = await removeQuestion(repoRoot, state.sessionId, {
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

  const promoteMatch = url.pathname.match(
    /^\/api\/moderate\/([^/]+)\/questions\/([^/]+)\/promote$/
  );
  if (promoteMatch) {
    const presentationId = promoteMatch[1];
    const questionId = promoteMatch[2];
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    if (!authedUser) return unauthorized(res);

    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) return notFound(res);

    // Fetch collaborator permission for ACL check
    const ctx = createRouteContext(authedUser);
    let collaboratorPermission = null;
    if (authedUser?.email && pres?.id) {
      collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
    }

    if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission }))
      return unauthorized(res);

    const body = await json(req);
    const position = body?.position === 'next' ? 'next' : 'end';
    const afterSlideIndex = Number(body?.afterSlideIndex ?? NaN);

    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    // Allow promotion even if session isn't "live" anymore, as long as we have a sessionId.
    if (!state.sessionId) return badRequest(res, 'No session found for presentation');

    await ensureQuestionsSession(repoRoot, state.sessionId, { presentationId });
    const qs = await getQuestionsSession(repoRoot, state.sessionId);
    const q = (Array.isArray(qs?.questions) ? qs.questions : []).find(
      (x) => String(x?.id || '') === String(questionId || '')
    );
    if (!q) return notFound(res);

    const dominant =
      normalizeLang(pres?.i18n?.dominant) || 'nl';
    const other = otherLang(dominant);
    const texts = q?.texts && typeof q.texts === 'object' ? q.texts : {};
    const originalText =
      typeof q?.originalText === 'string' && q.originalText.trim()
        ? q.originalText
        : typeof q?.text === 'string'
        ? q.text
        : '';

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
      q?.authorName ? `Asked by: ${String(q.authorName).trim()}` : '',
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

    const updated = await updatePresentation(repoRoot, presentationId, nextPres, {
      actorEmail: authedUser?.email || null,
    });
    // Lock / mark promoted so audience sees it will be addressed (and voting/removal stops).
    await promoteQuestion(repoRoot, state.sessionId, {
      questionId,
      slideId,
      promotedBy: authedUser.email || 'moderator',
    });
    notifyPresentSessionDeckUpdated(repoRoot, state.sessionId, {
      presentationId,
      slideId,
      reason: 'question_promoted',
    });
    serveJson(res, 200, { ok: true, slideId, presentation: updated });
    return true;
  }

  return false;
}
