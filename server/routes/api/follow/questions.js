import { badRequest, getErrorStatus, methodNotAllowed, serveJson, requireJsonBody, jsonError } from '../../../utils/http.js';
import { getString } from '../../../utils/request-validators.js';
import { getFollowStateForPresentation } from '../../../storage/live-sessions/index.js';
import { getPresentation } from '../../../storage/presentations/index.js';
import {
  cancelQuestion,
  createQuestion,
  listQuestions,
  upvoteQuestion,
} from '../../../storage/questions.js';
import { normalizeLang } from '../../../utils/translation-status.js';
import { computeAudienceCapabilitiesFromState, ensureQaDeviceCookie, followAudienceScope } from './helpers.js';
import { crossOrganizationScope } from '../../../storage/scope.js';

export async function handleFollowQuestions({ repoRoot, req, res }, presentationId) {
  // The audience has no session: the live follow code is what authorizes this,
  // so the deck lookup must not be organization-filtered.
  const followScope = crossOrganizationScope(
    repoRoot,
    'follow-along audience: the live follow code is the authorization'
  );
  if (req.method === 'GET') {
    const state = await getFollowStateForPresentation(followAudienceScope(repoRoot), presentationId);
    const pres = await getPresentation(followScope, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres);
    if (state.status !== 'live' || !state.sessionId) {
      const dev = ensureQaDeviceCookie(req);
      serveJson(
        res,
        200,
        { ...state, capabilities: caps, questions: [] },
        dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
      );
      return true;
    }
    // If Q&A is disabled at the presentation level, don't leak questions.
    if (caps.canUseQa === false) {
      const dev = ensureQaDeviceCookie(req);
      serveJson(
        res,
        200,
        { ...state, capabilities: caps, questions: [] },
        dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
      );
      return true;
    }
    const questions = (await listQuestions(followAudienceScope(repoRoot), state.sessionId)) || [];
    const dev = ensureQaDeviceCookie(req);
    serveJson(
      res,
      200,
      { ...state, capabilities: caps, questions },
      dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
    );
    return true;
  }

  if (req.method === 'POST') {
    const state = await getFollowStateForPresentation(followAudienceScope(repoRoot), presentationId);
    if (state.status !== 'live' || !state.sessionId)
      return badRequest(res, 'Presentation is not live');
    const pres = await getPresentation(followScope, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres);
    if (caps.canUseQa === false)
      return badRequest(res, 'Q&A is disabled for this presentation');
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const dev = ensureQaDeviceCookie(req);
    const authorId = dev.id;
    const authorName = getString(body, 'authorName');
    const originalLang = normalizeLang(body?.lang) || null;
    const text = getString(body, 'text');
    const result = await createQuestion(followAudienceScope(repoRoot), state.sessionId, {
      authorId,
      authorName,
      originalLang,
      text,
    });
    if (!result.ok) {
      return jsonError(res, getErrorStatus(result.reason), result.reason, undefined, {
        headers: dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {},
      });
    }
    serveJson(
      res,
      201,
      { ok: true, question: result.question },
      dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
    );
    return true;
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}

export async function handleFollowUpvote({ repoRoot, req, res }, presentationId, questionId) {
  const followScope = crossOrganizationScope(
    repoRoot,
    'follow-along audience: the live follow code is the authorization'
  );
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(followAudienceScope(repoRoot), presentationId);
  if (state.status !== 'live' || !state.sessionId)
    return badRequest(res, 'Presentation is not live');
  const pres = await getPresentation(followScope, presentationId);
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  if (caps.canUseQa === false)
    return badRequest(res, 'Q&A is disabled for this presentation');
  const dev = ensureQaDeviceCookie(req);
  const voterId = dev.id;
  const result = await upvoteQuestion(followAudienceScope(repoRoot), state.sessionId, {
    questionId,
    voterId,
  });
  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason, undefined, {
      headers: dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {},
    });
  }
  serveJson(
    res,
    200,
    { ok: true, upvotes: result.upvotes },
    dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
  );
  return true;
}

export async function handleFollowCancel({ repoRoot, req, res }, presentationId, questionId) {
  const followScope = crossOrganizationScope(
    repoRoot,
    'follow-along audience: the live follow code is the authorization'
  );
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(followAudienceScope(repoRoot), presentationId);
  if (state.status !== 'live' || !state.sessionId)
    return badRequest(res, 'Presentation is not live');
  const pres = await getPresentation(followScope, presentationId);
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  if (caps.canUseQa === false)
    return badRequest(res, 'Q&A is disabled for this presentation');
  const dev = ensureQaDeviceCookie(req);
  const authorId = dev.id;
  const result = await cancelQuestion(followAudienceScope(repoRoot), state.sessionId, {
    questionId,
    authorId,
  });
  if (!result.ok) {
    return jsonError(res, getErrorStatus(result.reason), result.reason, undefined, {
      headers: dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {},
    });
  }
  serveJson(
    res,
    200,
    { ok: true },
    dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
  );
  return true;
}
