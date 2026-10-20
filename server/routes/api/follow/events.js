import {
  attachSessionSseClient,
  getFollowStateForPresentation,
} from '../../../storage/live-sessions/index.js';
import { sseWrite, openSseStream } from '../../../utils/sse.js';
import { followAudienceScope } from './helpers.js';
import { subscribeFollowStatus } from './status-ticker.js';
import { sendInteractionCatchUp } from '../interaction-catch-up.js';
import { getPresentationCached } from '../../../storage/presentations/index.js';
import { normalizeLang } from '../../../../shared/i18n-utils.js';
import {
  computeAudienceCapabilitiesFromState,
  followAudienceState,
  followWireState,
  loadFollowAudience,
} from './helpers.js';

export async function handleFollowEvents(
  { repoRoot, req, res, url },
  presentationId,
) {
  if (req.method !== 'GET') return false;

  // openSseStream applies the connection guard (429 before stream headers).
  const stream = openSseStream(req, res);
  if (!stream.ok) return true;

  let detach = null;
  let currentSessionId = '';
  let stopped = false;
  const lang = normalizeLang(url?.searchParams.get('lang'));

  const audienceState = async (state, pres) => {
    const deck =
      pres ||
      (await getPresentationCached(
        followAudienceScope(repoRoot),
        presentationId,
      ));
    if (!deck)
      return {
        state: { ...state, slideId: '', slideIndex: -1, slideType: '' },
        pres: null,
      };
    const projected = await loadFollowAudience(repoRoot, deck, lang);
    return { state: followAudienceState(state, deck, projected), pres: deck };
  };

  const transformEvent = async (event, data) => {
    if (stopped) return null;
    if (event === 'deckUpdated')
      return { updatedAt: data?.updatedAt || Date.now() };
    if (event !== 'state' && event !== 'interactionState') return null;
    const current = await getFollowStateForPresentation(
      followAudienceScope(repoRoot),
      presentationId,
    );
    const projected = await audienceState(
      event === 'state' ? { ...current, ...data } : current,
    );
    if (stopped) return null;
    if (event === 'state') return followWireState(projected.state);
    return projected.state.slideId && data?.slideId === projected.state.slideId
      ? data
      : null;
  };

  const detachSession = () => {
    if (typeof detach === 'function') {
      try {
        detach();
      } catch {}
    }
    detach = null;
    currentSessionId = '';
  };

  // Called once immediately, then on every shared per-presentation tick
  // (state + presentation are computed once for all followers).
  const onStatus = async (shared) => {
    if (stopped) return;
    const projected = {
      state: await shared.audienceStateForLang(lang),
      pres: shared.pres,
    };
    if (stopped) return;
    sseWrite(res, {
      event: 'status',
      data: {
        ...followWireState(projected.state),
        capabilities: computeAudienceCapabilitiesFromState(
          projected.state,
          projected.pres,
        ),
      },
    });

    const state = shared.rawState;
    if (state.status === 'live' && state.sessionId) {
      if (state.sessionId !== currentSessionId) {
        detachSession();
        currentSessionId = state.sessionId;
        // This will also emit an initial `state` event.
        const attached = await attachSessionSseClient(
          followAudienceScope(repoRoot),
          state.sessionId,
          res,
          { transformEvent },
        );
        if (stopped || currentSessionId !== state.sessionId) {
          attached?.();
          return;
        }
        detach = attached;
        if (projected.state.slideId) {
          await sendInteractionCatchUp(followAudienceScope(repoRoot), {
            sessionId: state.sessionId,
            slideId: projected.state.slideId,
            res,
            transformEvent,
          });
        }
      }
    } else {
      detachSession();
    }
  };

  const unsubscribe = subscribeFollowStatus(repoRoot, presentationId, onStatus);

  const cleanup = () => {
    stopped = true;
    try {
      unsubscribe();
    } catch {}
    detachSession();
  };

  res.on?.('close', cleanup);
  res.on?.('finish', cleanup);

  return true;
}
