import { badRequest, json, methodNotAllowed, serveJson } from '../../../utils/http.js';
import { getString } from '../../../utils/request-validators.js';
import { getFollowStateForPresentation } from '../../../storage/present-sessions.js';
import { getPresentation } from '../../../storage/presentations.js';
import {
  cancelQuestion,
  createQuestion,
  ensureQuestionsSession,
  listQuestions,
  upvoteQuestion,
} from '../../../storage/questions.js';
import { normalizeLang } from '../../../utils/translation-status.js';
import { computeAudienceCapabilitiesFromState, ensureQaDeviceCookie } from './helpers.js';

export async function handleFollowQuestions({ repoRoot, req, res }, presentationId) {
  if (req.method === 'GET') {
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    const pres = await getPresentation(repoRoot, presentationId);
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
    // If Q&A is disabled at the presentation level, don't leak questions and avoid
    // creating background sessions.
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
    await ensureQuestionsSession(repoRoot, state.sessionId, { presentationId });
    const questions = (await listQuestions(repoRoot, state.sessionId)) || [];
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
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    if (state.status !== 'live' || !state.sessionId)
      return badRequest(res, 'Presentation is not live');
    const pres = await getPresentation(repoRoot, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres);
    if (caps.canUseQa === false)
      return badRequest(res, 'Q&A is disabled for this presentation');
    await ensureQuestionsSession(repoRoot, state.sessionId, { presentationId });
    const body = await json(req);
    const dev = ensureQaDeviceCookie(req);
    const authorId = dev.id;
    const authorName = getString(body, 'authorName');
    const originalLang = normalizeLang(body?.lang) || null;
    const text = getString(body, 'text');
    const result = await createQuestion(repoRoot, state.sessionId, {
      authorId,
      authorName,
      originalLang,
      text,
    });
    if (!result.ok) {
      serveJson(
        res,
        400,
        { error: result.reason },
        dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
      );
      return true;
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
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(repoRoot, presentationId);
  if (state.status !== 'live' || !state.sessionId)
    return badRequest(res, 'Presentation is not live');
  const pres = await getPresentation(repoRoot, presentationId);
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  if (caps.canUseQa === false)
    return badRequest(res, 'Q&A is disabled for this presentation');
  await ensureQuestionsSession(repoRoot, state.sessionId, { presentationId });
  const dev = ensureQaDeviceCookie(req);
  const voterId = dev.id;
  const result = await upvoteQuestion(repoRoot, state.sessionId, {
    questionId,
    voterId,
  });
  if (!result.ok) {
    const status = result.reason === 'already_voted' ? 409 : 400;
    serveJson(
      res,
      status,
      { error: result.reason },
      dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
    );
    return true;
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
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(repoRoot, presentationId);
  if (state.status !== 'live' || !state.sessionId)
    return badRequest(res, 'Presentation is not live');
  const pres = await getPresentation(repoRoot, presentationId);
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  if (caps.canUseQa === false)
    return badRequest(res, 'Q&A is disabled for this presentation');
  await ensureQuestionsSession(repoRoot, state.sessionId, { presentationId });
  const dev = ensureQaDeviceCookie(req);
  const authorId = dev.id;
  const result = await cancelQuestion(repoRoot, state.sessionId, {
    questionId,
    authorId,
  });
  if (!result.ok) {
    const status = result.reason === 'forbidden' ? 403 : 400;
    serveJson(
      res,
      status,
      { error: result.reason },
      dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
    );
    return true;
  }
  serveJson(
    res,
    200,
    { ok: true },
    dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {}
  );
  return true;
}
