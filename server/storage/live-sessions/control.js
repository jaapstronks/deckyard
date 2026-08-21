import {
  broadcast,
  getSessionSync,
  touchSessionSync,
  updateLiveSessionState,
} from './sse.js';
import { getPresentation } from '../presentations/index.js';
import { getOptionCountForSlide } from '../../utils/interaction-helpers.js';
import { liveInteractionKind } from '../../../shared/slide-types/runtime.js';
import {
  ensurePollInteractionForSlide,
  ensureLikertInteractionForSlide,
} from '../interactions.js';
import { ensureFeedbackForSlide } from '../feedback.js';
import { fireAndForget } from '../../utils/fire-and-forget.js';
import {
  crossOrganizationScope,
  repoRootOf,
  toStorageContext,
} from '../scope.js';

/**
 * Get slides array from presentation, respecting i18n active language
 */
function getSlidesFromPresentation(pres) {
  if (!pres) return [];
  const active = pres?.i18n?.active || pres?.i18n?.dominant;
  if (
    active &&
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions[active]
  ) {
    const v = pres.i18n.versions[active];
    return Array.isArray(v?.slides) ? v.slides : [];
  }
  return Array.isArray(pres?.slides) ? pres.slides : [];
}

/**
 * Calculate the new slide index based on current state and control command
 */
function calculateNewSlideIndex(currentIndex, action, slideCount, gotoIndex) {
  if (action === 'goto') {
    const idx = Number(gotoIndex);
    if (Number.isFinite(idx) && idx >= 0 && idx < slideCount) {
      return idx;
    }
    return currentIndex;
  }
  if (action === 'next') {
    return Math.min(currentIndex + 1, slideCount - 1);
  }
  if (action === 'prev') {
    return Math.max(currentIndex - 1, 0);
  }
  return currentIndex;
}

/**
 * Turn remote control on or off for a session.
 *
 * @param {import('../scope.js').StorageScope} scope
 * @param {string} sessionId
 * @param {boolean} enabled
 * @returns {{ok: true, controlEnabled: boolean}|{ok: false, reason: string}}
 */
export function setLiveSessionControlEnabled(scope, sessionId, enabled) {
  // Presenter action: the scope states its organization.
  toStorageContext(scope, 'setLiveSessionControlEnabled');
  // Keep sync API surface (called on user interaction)
  const s = getSessionSync(sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  s.controlEnabled = !!enabled;
  touchSessionSync(s);
  fireAndForget(
    broadcast(scope, sessionId, 'controlEnabled', {
      controlEnabled: !!s.controlEnabled,
      updatedAt: Date.now(),
    }),
    'live-session controlEnabled broadcast',
  );
  return { ok: true, controlEnabled: !!s.controlEnabled };
}

export async function sendLiveSessionControlCommand(scope, sessionId, cmd) {
  // Presenter action: the scope states its organization.
  toStorageContext(scope, 'sendLiveSessionControlCommand');
  const s = getSessionSync(sessionId);
  if (!s) return { ok: false, reason: 'not_found' };
  touchSessionSync(s);
  if (!s.controlEnabled) return { ok: false, reason: 'disabled' };

  const action = typeof cmd?.action === 'string' ? cmd.action : '';
  if (action !== 'next' && action !== 'prev' && action !== 'goto')
    return { ok: false, reason: 'bad_action' };

  const payload = {
    action,
    slideIndex: action === 'goto' ? Number(cmd?.slideIndex ?? NaN) : undefined,
    updatedAt: Date.now(),
  };
  if (action === 'goto' && !Number.isFinite(payload.slideIndex))
    return { ok: false, reason: 'bad_slideIndex' };

  // Send control event to presenter so their UI updates
  fireAndForget(
    broadcast(scope, sessionId, 'control', payload),
    'live-session control broadcast',
  );

  // OPTIMIZATION: Directly update session state so followers get immediate updates
  // instead of waiting for presenter window to process control event and post state.
  try {
    const presentationId = s.presentationId;
    const pres = await getPresentation(
      crossOrganizationScope(
        repoRootOf(scope),
        'live session control: the session id is the authorization',
      ),
      presentationId,
    );
    if (pres) {
      const slides = getSlidesFromPresentation(pres);
      const slideCount = slides.length;
      if (slideCount > 0) {
        const currentIndex = Number(s.state?.slideIndex || 0) || 0;
        const newIndex = calculateNewSlideIndex(
          currentIndex,
          action,
          slideCount,
          cmd?.slideIndex,
        );
        const slide = slides[newIndex];
        if (slide) {
          const slideId = String(slide.id || '');
          const slideType = String(slide.type || '');

          // Update state and broadcast to all clients (including followers)
          await updateLiveSessionState(scope, sessionId, {
            slideId,
            slideIndex: newIndex,
            slideType,
            // Reset step index when changing slides via remote control
            stepIdx: 0,
            stepParagraphs: s.state?.stepParagraphs,
            updatedAt: Date.now(),
          });

          // If this is a live slide, eagerly ensure interaction state exists
          // (same logic as in live-sessions.js POST /state handler). Pre-warming
          // is opportunistic, so the `{ ok, reason }` answer is discarded along
          // with any throw: the first voter creates the interaction anyway.
          const kind = liveInteractionKind(slideType);
          if (kind && slideId) {
            try {
              if (kind === 'feedback') {
                await ensureFeedbackForSlide(scope, sessionId, {
                  presentationId,
                  slideId,
                });
              } else {
                const optionCount = getOptionCountForSlide(slideType, slide);
                if (optionCount > 0) {
                  if (kind === 'likert') {
                    await ensureLikertInteractionForSlide(scope, sessionId, {
                      presentationId,
                      slideId,
                      optionCount,
                    });
                  } else {
                    await ensurePollInteractionForSlide(scope, sessionId, {
                      presentationId,
                      slideId,
                      optionCount,
                    });
                  }
                }
              }
            } catch {
              // ignore interaction initialization errors
            }
          }
        }
      }
    }
  } catch {
    // If direct state update fails, fall back to control-only behavior
    // (presenter will still receive control event and update state)
  }

  return { ok: true };
}
