import {
  badRequest,
  methodNotAllowed,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
} from '../../../utils/http.js';
import { getFollowStateForPresentation } from '../../../storage/live-sessions/index.js';
import { getString } from '../../../utils/request-validators.js';
import { getPresentationCached } from '../../../storage/presentations/cache.js';
import { normalizeLang } from '../../../../shared/i18n-utils.js';
import {
  computeAudienceCapabilitiesFromState,
  ensureInteractionDeviceCookie,
  followAudienceScope,
  pickPresentationForLang,
} from './helpers.js';
import {
  ensurePollInteractionForSlide,
  getInteractionAggregate,
  votePollInteraction,
  ensureLikertInteractionForSlide,
  voteLikertInteraction,
} from '../../../storage/interactions.js';
import {
  ensureFeedbackForSlide,
  getFeedbackAggregate,
  submitFeedback,
} from '../../../storage/feedback.js';
import {
  findSlideById,
  getOptionCountForSlide,
  optionsFromSlide,
  questionFromSlide,
  scaleInteractionFromSlide,
  feedbackInteractionFromSlide,
} from '../../../utils/interaction-helpers.js';
import {
  liveInteractionKind,
  liveScale,
} from '../../../../shared/slide-types/runtime.js';

export async function handleFollowInteractionsCurrent(
  { repoRoot, req, res, url },
  presentationId,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const lang = normalizeLang(url.searchParams.get('lang'));
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const pres0 = await getPresentationCached(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const caps = computeAudienceCapabilitiesFromState(state, pres0);

  const dev = ensureInteractionDeviceCookie(req);
  const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

  if (state.status !== 'live' || !state.sessionId) {
    serveJson(
      res,
      200,
      { ...state, capabilities: caps, interaction: null },
      extraHeaders,
    );
    return true;
  }
  if (!pres0) return notFound(res);

  const pres = pickPresentationForLang(pres0, lang);
  const slideId = String(state.slideId || '').trim();
  const slide = findSlideById(pres, slideId);
  const slideType = String(state.slideType || '');
  // The type says whether it collects answers and which kind; this route no
  // longer keeps its own list of the four (shared/slide-types/runtime.js).
  const type = liveInteractionKind(slideType);
  if (!slide || !type) {
    serveJson(
      res,
      200,
      {
        ...state,
        capabilities: caps,
        interaction: null,
      },
      extraHeaders,
    );
    return true;
  }

  // The slider is the one thing the kind does not settle: same protocol kind
  // as a likert slide, but its stops come from the type's declared `scale`
  // instead of authored options.
  const scale = liveScale(slideType);
  const slider = scale ? scaleInteractionFromSlide(slide, scale) : null;
  const feedback =
    type === 'feedback' ? feedbackInteractionFromSlide(slide) : null;
  // Poll and likert now carry the same `options[]` array (the live content
  // contract in shared/slide-types/runtime.js), so the kind no longer picks a
  // reader — only the slider's fixed stops and feedback's absence of options
  // are still special.
  const options = slider
    ? slider.options
    : type === 'likert' || type === 'poll'
      ? optionsFromSlide(slide)
      : [];
  const question = slider
    ? slider.question
    : feedback
      ? feedback.question
      : questionFromSlide(slide);
  const optionCount = type === 'feedback' ? 0 : options.length;

  // Ensure a session-scoped interaction exists even before the first vote.
  // The `{ ok, reason }` answer is deliberately discarded: the aggregate read
  // below is the authoritative one, and it answers `null` for exactly the
  // sessions an ensure failure would have named.
  if (type === 'feedback') {
    await ensureFeedbackForSlide(
      followAudienceScope(repoRoot),
      state.sessionId,
      {
        slideId,
      },
    );
  } else if (type === 'likert') {
    await ensureLikertInteractionForSlide(
      followAudienceScope(repoRoot),
      state.sessionId,
      {
        slideId,
        optionCount,
      },
    );
  } else {
    await ensurePollInteractionForSlide(
      followAudienceScope(repoRoot),
      state.sessionId,
      {
        slideId,
        optionCount,
      },
    );
  }

  const agg =
    type === 'feedback'
      ? await getFeedbackAggregate(
          followAudienceScope(repoRoot),
          state.sessionId,
          {
            slideId,
            deviceId: dev.id,
          },
        )
      : // Poll and likert are one read: the kind is in the interaction row.
        await getInteractionAggregate(
          followAudienceScope(repoRoot),
          state.sessionId,
          {
            slideId,
            deviceId: dev.id,
            optionCount,
          },
        );

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
              // The range comes from the declaration too (`liveScale()`), so
              // the wire cannot name a range the vote endpoint does not keep.
              ui: 'slider',
              minLabel: slider.minLabel,
              maxLabel: slider.maxLabel,
              scaleMin: scale.min,
              scaleMax: scale.max,
            }
          : null),
      },
      interactionState: agg,
    },
    extraHeaders,
  );
  return true;
}

export async function handleFollowInteractionState(
  { repoRoot, req, res },
  presentationId,
  slideId,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const pres = await getPresentationCached(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  const dev = ensureInteractionDeviceCookie(req);
  const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

  if (state.status !== 'live' || !state.sessionId) {
    serveJson(
      res,
      200,
      { ...state, capabilities: caps, interactionState: null },
      extraHeaders,
    );
    return true;
  }
  if (!pres) return notFound(res);

  // We only allow state for the current slide (avoids leaking session-wide history on public endpoints).
  const currentSlideId = String(state.slideId || '').trim();
  const requested = String(slideId || '').trim();
  if (!requested || requested !== currentSlideId)
    return badRequest(
      res,
      'interaction state is only available for the current slide',
    );

  const slide = findSlideById(pres, requested);
  const slideType = String(state.slideType || '');
  const type = liveInteractionKind(slideType);
  if (!slide || !type)
    return badRequest(res, 'current slide is not interactive');

  const optionCount = getOptionCountForSlide(slideType, slide);
  const agg =
    type === 'feedback'
      ? await getFeedbackAggregate(
          followAudienceScope(repoRoot),
          state.sessionId,
          {
            slideId: requested,
            deviceId: dev.id,
          },
        )
      : // Poll and likert are one read: the kind is in the interaction row.
        await getInteractionAggregate(
          followAudienceScope(repoRoot),
          state.sessionId,
          {
            slideId: requested,
            deviceId: dev.id,
            optionCount,
          },
        );

  serveJson(
    res,
    200,
    { ...state, capabilities: caps, interactionState: agg },
    extraHeaders,
  );
  return true;
}

export async function handleFollowInteractionVote(
  { repoRoot, req, res },
  presentationId,
  slideId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  if (state.status !== 'live' || !state.sessionId)
    return badRequest(res, 'Presentation is not live');

  const pres = await getPresentationCached(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  if (!pres) return notFound(res);

  const dev = ensureInteractionDeviceCookie(req);
  const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

  const currentSlideId = String(state.slideId || '').trim();
  const requested = String(slideId || '').trim();
  if (!requested || requested !== currentSlideId)
    return badRequest(res, 'you can only vote on the current slide');
  const slideType = String(state.slideType || '');
  // This is the vote endpoint, so free-text feedback is out even though it is
  // just as live — it has its own handler below.
  const type = liveInteractionKind(slideType);
  if (type !== 'poll' && type !== 'likert')
    return badRequest(res, 'current slide is not interactive');

  const slide = findSlideById(pres, requested);
  if (!slide) return badRequest(res, 'slide not found');
  const optionCount = getOptionCountForSlide(slideType, slide);
  if (!optionCount)
    return badRequest(
      res,
      type === 'likert' ? 'likert has no options' : 'poll has no options',
    );

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  // One shape on the wire: a JSON integer. The range is the storage layer's
  // to judge (it holds the interaction's option count), and it refuses rather
  // than clamps.
  const optionIndex = body?.optionIndex;
  if (!Number.isInteger(optionIndex))
    return badRequest(res, 'optionIndex must be an integer');

  const result =
    type === 'likert'
      ? await voteLikertInteraction(
          followAudienceScope(repoRoot),
          state.sessionId,
          {
            slideId: requested,
            deviceId: dev.id,
            optionIndex,
            optionCount,
          },
        )
      : await votePollInteraction(
          followAudienceScope(repoRoot),
          state.sessionId,
          {
            slideId: requested,
            deviceId: dev.id,
            optionIndex,
            optionCount,
          },
        );
  if (!result.ok) {
    const message =
      result.field === 'option_index'
        ? `optionIndex must be between 0 and ${optionCount - 1}`
        : undefined;
    storageError(res, result, message, { headers: extraHeaders });
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
    extraHeaders,
  );
  return true;
}

export async function handleFollowInteractionFeedback(
  { repoRoot, req, res },
  presentationId,
  slideId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  if (state.status !== 'live' || !state.sessionId)
    return badRequest(res, 'Presentation is not live');

  const pres = await getPresentationCached(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const caps = computeAudienceCapabilitiesFromState(state, pres);
  if (!pres) return notFound(res);

  const dev = ensureInteractionDeviceCookie(req);
  const extraHeaders = dev.setCookie ? { 'Set-Cookie': dev.setCookie } : {};

  const currentSlideId = String(state.slideId || '').trim();
  const requested = String(slideId || '').trim();
  if (!requested || requested !== currentSlideId)
    return badRequest(res, 'you can only submit feedback on the current slide');

  const slideType = String(state.slideType || '');
  if (liveInteractionKind(slideType) !== 'feedback')
    return badRequest(res, 'current slide is not a feedback slide');

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const text = getString(body, 'text');
  const result = await submitFeedback(
    followAudienceScope(repoRoot),
    state.sessionId,
    {
      slideId: requested,
      deviceId: dev.id,
      text,
    },
  );
  if (!result.ok) {
    storageError(res, result, undefined, { headers: extraHeaders });
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
    extraHeaders,
  );
  return true;
}
