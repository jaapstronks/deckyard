/**
 * Theme editor live preview.
 *
 * Renders real slides through the same renderer the editor and exports use,
 * against a theme built by the same `buildThemeConfig` production uses. The
 * previous version hand-rolled a fake title slide out of inline styles, so it
 * could only ever show colours and fonts — never a background variant, a corner
 * radius, a shadow, or how the theme treats a quote. It also approximated the
 * derivation, so it could quietly disagree with what a deck really looks like.
 *
 * A draft is unsaved, so there is no theme id to load: the server builds one
 * from the draft on `POST /api/themes/custom/preview-config`.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { renderSlideElement } from '../../../lib/slide-runtime/slide-render.js';
import { attachThumbScaleContain } from '../../../lib/slide-runtime/thumb-scale.js';
import { injectThemeFontFaces } from '../../../lib/theme/theme.js';

// Enough to show typography, the accent and the dark surface without turning
// the panel into a deck.
const sampleSlides = () => [
  {
    id: 'preview-title',
    type: 'title-slide',
    content: {
      title: t('settings.themes.preview.title', 'Your presentation title'),
      subheading: t(
        'settings.themes.preview.subtitle',
        'A subtitle, in the body font'
      ),
      background: 'lime',
    },
  },
  {
    id: 'preview-content',
    type: 'content-slide',
    content: {
      title: t('settings.themes.preview.contentTitle', 'A content slide'),
      body: t(
        'settings.themes.preview.body',
        '- Body text in the body font\n- A second point\n- A third point'
      ),
      background: 'mist',
    },
  },
  {
    id: 'preview-quote',
    type: 'quote-slide',
    content: {
      quote: t(
        'settings.themes.preview.quote',
        'A quote, on the theme’s dark surface.'
      ),
      authorName: t('settings.themes.preview.quoteAuthor', 'Someone'),
      authorTitle: t('settings.themes.preview.quoteRole', 'Their role'),
    },
  },
];

// The draft would round-trip on every keystroke otherwise. Long enough to
// coalesce typing in a colour field, short enough to still feel live.
const DEBOUNCE_MS = 200;

/**
 * Create the live preview panel.
 * @returns {{ el: HTMLElement, update: Function, detach: Function }}
 */
export function createThemePreview() {
  const container = h('div', { class: 'theme-preview-container stack' });
  const slidesWrap = h('div', { class: 'theme-preview-slides stack' });
  const status = h('p', { class: 'help', text: '' });
  container.append(slidesWrap, status);

  let detachers = [];
  let timer = null;
  // Monotonic: a slow response for an older draft must not overwrite a newer one.
  let requestSeq = 0;
  let disposed = false;

  function clearSlides() {
    for (const off of detachers) {
      try {
        off?.();
      } catch {
        /* a failed disposer must not block the rest */
      }
    }
    detachers = [];
    slidesWrap.innerHTML = '';
  }

  function renderSlides(theme) {
    clearSlides();
    // Uploaded and managed fonts only render once their @font-face rules exist.
    injectThemeFontFaces(theme);

    for (const slide of sampleSlides()) {
      let slideEl;
      try {
        slideEl = renderSlideElement(slide, { mode: 'thumb', theme });
      } catch {
        continue;
      }
      const frame = h('div', { class: 'theme-preview-frame' });
      const thumb = h('div', { class: 'thumb theme-preview-thumb' });
      thumb.append(slideEl);
      frame.append(thumb);
      slidesWrap.append(frame);
      detachers.push(
        attachThumbScaleContain(thumb, {
          virtualWidth: 1600,
          virtualHeight: 900,
          containerEl: frame,
        })
      );
    }
  }

  async function refresh(state) {
    const seq = ++requestSeq;
    try {
      const res = await api('/api/themes/custom/preview-config', {
        method: 'POST',
        body: JSON.stringify({
          label: state?.label || '',
          logoUrl: state?.logoUrl || '',
          logoSmallUrl: state?.logoSmallUrl || '',
          colors: state?.colors || {},
          fonts: state?.fonts || {},
          config: state?.config || {},
        }),
      });
      if (disposed || seq !== requestSeq) return;
      if (!res?.theme) throw new Error('no theme in response');
      status.textContent = '';
      renderSlides(res.theme);
    } catch {
      if (disposed || seq !== requestSeq) return;
      // Keep the last good render on screen rather than blanking the panel.
      status.textContent = t(
        'settings.themes.preview.error',
        'Preview unavailable right now.'
      );
    }
  }

  /** @param {Object} state - the editor's draft state */
  function update(state) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => refresh(state), DEBOUNCE_MS);
  }

  function detach() {
    disposed = true;
    if (timer) clearTimeout(timer);
    clearSlides();
  }

  return { el: container, update, detach };
}
