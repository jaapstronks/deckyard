import {
  activateVideoEmbeds,
  mountSlideInto,
} from '../../lib/slide-runtime/slide-render.js';
import { slideByIdOrIndex } from './slides.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';
import { h } from '../../lib/dom.js';
import { applyStepVisibilityForMode } from '../presenter/step.js';

export function renderFollowSlide({
  pres,
  theme,
  slideWrap,
  interactionWrap,
  capabilities,
  statusEl,
  lastSlideId,
  lastSlideIndex,
  lastStepIdx,
  lastStepParagraphs,
  followInviteMessage,
} = {}) {
  if (!pres) return;
  const { slide, idx } = slideByIdOrIndex(pres, {
    slideId: lastSlideId,
    slideIndex: lastSlideIndex,
  });

  // Always show a stable "slide counter" in the top-right, even when the slide
  // itself is replaced by an interaction UI.
  if (statusEl)
    statusEl.textContent = `${idx + 1} / ${(pres.slides || []).length}`;

  // When a dominant interaction is active, hide the slide and show the interaction UI.
  if (capabilities?.interaction) {
    if (slideWrap) slideWrap.style.display = 'none';
    if (interactionWrap) interactionWrap.style.display = '';
    return;
  }
  if (slideWrap) slideWrap.style.display = '';
  if (interactionWrap) interactionWrap.style.display = 'none';

  if (!slide) return;

  // When the presenter is on the follow-invite slide, show a success message instead
  // of the slide itself (which would just show the QR code they already scanned).
  if (slide.type === 'follow-invite-slide' && followInviteMessage) {
    if (slideWrap) {
      slideWrap.innerHTML = '';
      const msgSlide = h('div', { class: 'slide follow-message-slide' });
      const inner = h('div', { class: 'slide-inner' });
      const box = h('div', {
        class: 'follow-message-box',
        text: followInviteMessage,
      });
      inner.appendChild(box);
      msgSlide.appendChild(inner);
      slideWrap.appendChild(msgSlide);
    }
    return;
  }

  // The audience can switch language mid-session, and the switcher refetches
  // the deck rather than reloading the page. The payload states the language of
  // the slides it carries (`server/routes/api/follow/presentation.js`), so this
  // reads the deck like every other surface and follows the switch for free.
  const el = mountSlideInto(slideWrap, slide, {
    mode: 'follow',
    theme,
    presentationId: pres?.id,
    lang: resolveDeckLang(pres),
  });

  // Apply presenter step state (if enabled) so follow-along matches "Tekst stap voor stap".
  try {
    applyStepVisibilityForMode(el, lastStepParagraphs, lastStepIdx);
  } catch {
    // ignore
  }

  // The follow-along view renders only the current slide, so it's safe to
  // enable autoplay when the slide becomes visible.
  activateVideoEmbeds(slideWrap);
}
