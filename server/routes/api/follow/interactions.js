import {
  badRequest,
  json,
  jsonError,
  methodNotAllowed,
  notFound,
  serveJson,
  serverError,
} from '../../../utils/http.js';
import { getFollowStateForPresentation } from '../../../storage/present-sessions.js';
import { getString } from '../../../utils/request-validators.js';
import { getPresentationCached } from '../../../storage/presentation-cache.js';
import { normalizeLang } from '../../../utils/translation-status.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('interactions');
import {
  computeAudienceCapabilitiesFromState,
  ensureInteractionDeviceCookie,
  pickPresentationForLang,
} from './helpers.js';
import {
  ensurePollInteractionForSlide,
  getPollInteractionAggregate,
  votePollInteraction,
  ensureLikertInteractionForSlide,
  getLikertInteractionAggregate,
  voteLikertInteraction,
} from '../../../storage/interactions.js';
import {
  ensureFeedbackForSlide,
  getFeedbackAggregate,
  submitFeedback,
} from '../../../storage/feedback.js';
import {
  findSlideById,
  pollOptionsFromSlide,
  pollQuestionFromSlide,
  likertOptionsFromSlide,
  likertQuestionFromSlide,
  slider10InteractionFromSlide,
  feedbackInteractionFromSlide,
} from '../../../utils/interaction-helpers.js';

export async function handleFollowInteractionsCurrent(
  { repoRoot, req, res, url },
  presentationId
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const lang = normalizeLang(url.searchParams.get('lang'));
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    const pres0 = await getPresentationCached(repoRoot, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres0);

    const dev = ensureInteractionDeviceCookie(req);
    const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

    if (state.status !== 'live' || !state.sessionId) {
      serveJson(res, 200, { ...state, capabilities: caps, interaction: null }, extraHeaders);
      return true;
    }
    if (!pres0) return notFound(res);

    const pres = pickPresentationForLang(pres0, lang);
    const slideId = String(state.slideId || '').trim();
    const slide = findSlideById(pres, slideId);
    const slideType = String(state.slideType || '');
    if (
      !slide ||
      (slideType !== 'poll-slide' &&
        slideType !== 'likert-slide' &&
        slideType !== 'likert-slider-slide' &&
        slideType !== 'feedback-slide')
    ) {
      serveJson(
        res,
        200,
        {
          ...state,
          capabilities: caps,
          interaction: null,
        },
        extraHeaders
      );
      return true;
    }

    const type =
      slideType === 'feedback-slide'
        ? 'feedback'
        : slideType === 'likert-slide' || slideType === 'likert-slider-slide'
          ? 'likert'
          : 'poll';
    const slider =
      slideType === 'likert-slider-slide'
        ? slider10InteractionFromSlide(slide)
        : null;
    const feedback =
      slideType === 'feedback-slide' ? feedbackInteractionFromSlide(slide) : null;
    const options = slider
      ? slider.options
      : type === 'likert'
        ? likertOptionsFromSlide(slide)
        : pollOptionsFromSlide(slide);
    const question = slider
      ? slider.question
      : feedback
        ? feedback.question
        : type === 'likert'
        ? likertQuestionFromSlide(slide)
        : pollQuestionFromSlide(slide);
    const optionCount = type === 'feedback' ? 0 : options.length;

    // Ensure a session-scoped interaction exists even before the first vote.
    if (type === 'feedback') {
      await ensureFeedbackForSlide(repoRoot, state.sessionId, {
        presentationId,
        slideId,
      });
    } else if (type === 'likert') {
      await ensureLikertInteractionForSlide(repoRoot, state.sessionId, {
        presentationId,
        slideId,
        optionCount,
      });
    } else {
      await ensurePollInteractionForSlide(repoRoot, state.sessionId, {
        presentationId,
        slideId,
        optionCount,
      });
    }

    const agg =
      type === 'feedback'
        ? await getFeedbackAggregate(repoRoot, state.sessionId, {
            slideId,
            deviceId: dev.id,
          })
        : type === 'likert'
          ? await getLikertInteractionAggregate(repoRoot, state.sessionId, {
              slideId,
              deviceId: dev.id,
              optionCount,
            })
          : await getPollInteractionAggregate(repoRoot, state.sessionId, {
              slideId,
              deviceId: dev.id,
              optionCount,
            });

    serveJson(
      res,
      200,
      {
        ...state,
        capabilities: caps,
        interaction: {
          type,
          slideId,
          question,
          ...(type === 'feedback'
            ? {
                ui: 'textarea',
                placeholder: feedback?.placeholder || '',
                maxLength: feedback?.maxLength || 4000,
              }
            : { options }),
          ...(slider
            ? {
                ui: 'slider-1-10',
                minLabel: slider.minLabel,
                maxLabel: slider.maxLabel,
                scaleMin: 1,
                scaleMax: 10,
              }
            : null),
        },
        interactionState: agg,
      },
      extraHeaders
    );
    return true;
  } catch (err) {
    log.error('[follow/interactions] Failed to get current interaction:', err);
    return serverError(res, 'Failed to load interaction');
  }
}

export async function handleFollowInteractionState(
  { repoRoot, req, res },
  presentationId,
  slideId
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    const pres = await getPresentationCached(repoRoot, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres);
    const dev = ensureInteractionDeviceCookie(req);
    const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

    if (state.status !== 'live' || !state.sessionId) {
      serveJson(res, 200, { ...state, capabilities: caps, interactionState: null }, extraHeaders);
      return true;
    }
    if (!pres) return notFound(res);

    // We only allow state for the current slide (avoids leaking session-wide history on public endpoints).
    const currentSlideId = String(state.slideId || '').trim();
    const requested = String(slideId || '').trim();
    if (!requested || requested !== currentSlideId)
      return badRequest(res, 'interaction state is only available for the current slide');

    const slide = findSlideById(pres, requested);
    const slideType = String(state.slideType || '');
    if (
      !slide ||
      (slideType !== 'poll-slide' &&
        slideType !== 'likert-slide' &&
        slideType !== 'likert-slider-slide' &&
        slideType !== 'feedback-slide')
    )
      return badRequest(res, 'current slide is not interactive');

    const type =
      slideType === 'feedback-slide'
        ? 'feedback'
        : slideType === 'likert-slide' || slideType === 'likert-slider-slide'
          ? 'likert'
          : 'poll';
    const optionCount =
      type === 'feedback'
        ? 0
        : type === 'likert'
          ? slideType === 'likert-slider-slide'
            ? 10
            : likertOptionsFromSlide(slide).length
          : pollOptionsFromSlide(slide).length;
    const agg =
      type === 'feedback'
        ? await getFeedbackAggregate(repoRoot, state.sessionId, {
            slideId: requested,
            deviceId: dev.id,
          })
        : type === 'likert'
          ? await getLikertInteractionAggregate(repoRoot, state.sessionId, {
              slideId: requested,
              deviceId: dev.id,
              optionCount,
            })
          : await getPollInteractionAggregate(repoRoot, state.sessionId, {
              slideId: requested,
              deviceId: dev.id,
              optionCount,
            });

    serveJson(
      res,
      200,
      { ...state, capabilities: caps, interactionState: agg },
      extraHeaders
    );
    return true;
  } catch (err) {
    log.error('[follow/interactions] Failed to get interaction state:', err);
    return serverError(res, 'Failed to load interaction state');
  }
}

export async function handleFollowInteractionVote(
  { repoRoot, req, res },
  presentationId,
  slideId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    if (state.status !== 'live' || !state.sessionId)
      return badRequest(res, 'Presentation is not live');

    const pres = await getPresentationCached(repoRoot, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres);
    if (!pres) return notFound(res);

    const dev = ensureInteractionDeviceCookie(req);
    const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

    const currentSlideId = String(state.slideId || '').trim();
    const requested = String(slideId || '').trim();
    if (!requested || requested !== currentSlideId)
      return badRequest(res, 'you can only vote on the current slide');
    const slideType = String(state.slideType || '');
    if (
      slideType !== 'poll-slide' &&
      slideType !== 'likert-slide' &&
      slideType !== 'likert-slider-slide'
    )
      return badRequest(res, 'current slide is not interactive');

    const slide = findSlideById(pres, requested);
    if (!slide) return badRequest(res, 'slide not found');
    const type =
      slideType === 'likert-slide' || slideType === 'likert-slider-slide'
        ? 'likert'
        : 'poll';
    const optionCount =
      type === 'likert'
        ? slideType === 'likert-slider-slide'
          ? 10
          : likertOptionsFromSlide(slide).length
        : pollOptionsFromSlide(slide).length;
    if (!optionCount)
      return badRequest(
        res,
        type === 'likert' ? 'likert has no options' : 'poll has no options'
      );

    const body = await json(req);
    const optionIndex = Number(body?.optionIndex ?? NaN);
    if (!Number.isFinite(optionIndex))
      return badRequest(res, 'optionIndex must be a number');

    const result =
      type === 'likert'
        ? await voteLikertInteraction(repoRoot, state.sessionId, {
            presentationId,
            slideId: requested,
            deviceId: dev.id,
            optionIndex,
            optionCount,
          })
        : await votePollInteraction(repoRoot, state.sessionId, {
            presentationId,
            slideId: requested,
            deviceId: dev.id,
            optionIndex,
            optionCount,
          });
    if (!result.ok) {
      const status = result.reason === 'closed' ? 409 : 400;
      jsonError(res, status, result.reason, undefined, { headers: extraHeaders });
      return true;
    }

    serveJson(
      res,
      200,
      {
        ok: true,
        capabilities: caps,
        interactionState: result.aggregate,
      },
      extraHeaders
    );
    return true;
  } catch (err) {
    log.error('[follow/interactions] Failed to submit vote:', err);
    return serverError(res, 'Failed to submit vote');
  }
}

export async function handleFollowInteractionFeedback(
  { repoRoot, req, res },
  presentationId,
  slideId
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    if (state.status !== 'live' || !state.sessionId)
      return badRequest(res, 'Presentation is not live');

    const pres = await getPresentationCached(repoRoot, presentationId);
    const caps = computeAudienceCapabilitiesFromState(state, pres);
    if (!pres) return notFound(res);

    const dev = ensureInteractionDeviceCookie(req);
    const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

    const currentSlideId = String(state.slideId || '').trim();
    const requested = String(slideId || '').trim();
    if (!requested || requested !== currentSlideId)
      return badRequest(res, 'you can only submit feedback on the current slide');

    const slideType = String(state.slideType || '');
    if (slideType !== 'feedback-slide')
      return badRequest(res, 'current slide is not a feedback slide');

    const body = await json(req);
    const text = getString(body, 'text');
    const result = await submitFeedback(repoRoot, state.sessionId, {
      presentationId,
      slideId: requested,
      deviceId: dev.id,
      text,
    });
    if (!result.ok) {
      const status = result.reason === 'closed' ? 409 : 400;
      jsonError(res, status, result.reason, undefined, { headers: extraHeaders });
      return true;
    }
    serveJson(
      res,
      200,
      {
        ok: true,
        capabilities: caps,
        interactionState: result.aggregate,
      },
      extraHeaders
    );
    return true;
  } catch (err) {
    log.error('[follow/interactions] Failed to submit feedback:', err);
    return serverError(res, 'Failed to submit feedback');
  }
}
