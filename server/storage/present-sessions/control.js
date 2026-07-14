import { broadcast, getSessionSync, touchSessionSync, updatePresentSessionState } from './sse.js';
import { getPresentation } from '../presentations.js';
import {
  isInteractiveSlideType,
  findSlideById,
  getOptionCountForSlide,
} from '../../utils/interaction-helpers.js';
import {
  ensurePollInteractionForSlide,
  ensureLikertInteractionForSlide,
} from '../interactions.js';
import { ensureFeedbackForSlide } from '../feedback.js';

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

export function setPresentSessionControlEnabled(repoRoot, sessionId, enabled) {
  // Keep sync API surface (called on user interaction)
  const s = getSessionSync(sessionId);
  if (!s) return null;
  s.controlEnabled = !!enabled;
  touchSessionSync(s);
  broadcast(repoRoot, sessionId, 'controlEnabled', {
    controlEnabled: !!s.controlEnabled,
    updatedAt: Date.now(),
  }).catch(() => {});
  return { controlEnabled: !!s.controlEnabled };
}

export async function sendPresentSessionControlCommand(repoRoot, sessionId, cmd) {
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
  broadcast(repoRoot, sessionId, 'control', payload).catch(() => {});

  // OPTIMIZATION: Directly update session state so followers get immediate updates
  // instead of waiting for presenter window to process control event and post state.
  try {
    const presentationId = s.presentationId;
    const pres = await getPresentation(repoRoot, presentationId);
    if (pres) {
      const slides = getSlidesFromPresentation(pres);
      const slideCount = slides.length;
      if (slideCount > 0) {
        const currentIndex = Number(s.state?.slideIndex || 0) || 0;
        const newIndex = calculateNewSlideIndex(
          currentIndex,
          action,
          slideCount,
          cmd?.slideIndex
        );
        const slide = slides[newIndex];
        if (slide) {
          const slideId = String(slide.id || '');
          const slideType = String(slide.type || '');

          // Update state and broadcast to all clients (including followers)
          await updatePresentSessionState(repoRoot, sessionId, {
            slideId,
            slideIndex: newIndex,
            slideType,
            // Reset step index when changing slides via remote control
            stepIdx: 0,
            stepParagraphs: s.state?.stepParagraphs,
            updatedAt: Date.now(),
          });

          // If this is an interactive slide, eagerly ensure interaction state exists
          // (same logic as in present-sessions.js POST /state handler)
          if (isInteractiveSlideType(slideType) && slideId) {
            try {
              if (slideType === 'feedback-slide') {
                await ensureFeedbackForSlide(repoRoot, sessionId, {
                  presentationId,
                  slideId,
                });
              } else {
                const optionCount = getOptionCountForSlide(slideType, slide);
                if (optionCount > 0) {
                  if (slideType === 'likert-slide' || slideType === 'likert-slider-slide') {
                    await ensureLikertInteractionForSlide(repoRoot, sessionId, {
                      presentationId,
                      slideId,
                      optionCount,
                    });
                  } else {
                    await ensurePollInteractionForSlide(repoRoot, sessionId, {
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
