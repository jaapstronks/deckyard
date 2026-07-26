/**
 * The slide-wide background controls, split by how often you reach for them.
 *
 * Until 2026-07-26 these were one collapsible "Background" section holding both
 * the colour choice and the image machinery. That bundle forced a bad trade: the
 * colour picker is a primary design control, so the section had to default open
 * — and then the image tail (crop focus, fit, overlay, text colour, corner logo)
 * came along for the ride. Measured on a title slide it was 1187px of a ~1310px
 * rail, with the Accessibility section pushed a screen and a half down.
 *
 * So the split runs along frequency, not along "background yes/no":
 *  - the colour is a plain, always-visible field among the type's own settings
 *  - the image (and everything that only matters once an image is set) is one
 *    collapsed <details>, whose summary shows a thumbnail when a background is
 *    active — so a set background stays visible without costing the space.
 *
 * Inspector-only by construction: the bulk modal (`contentOnly`) renders content
 * fields and nothing here (the parity invariant, see editor-inspector.md).
 */
import { t } from '../../../lib/ui-i18n.js';
import { loadThemeById } from '../../../lib/theme/theme.js';
import { detectBgTextContrast } from '../../../lib/slide-authoring/bg-contrast.js';
import { isLocked } from '../../../../shared/theme-locks.js';
import { renderFocusGridField } from './focus-picker.js';

/** Field keys the colour group owns. */
const BG_COLOR_KEYS = new Set(['background', 'bgCustomColor']);

/** Field keys the image section owns. */
const BG_IMAGE_KEYS = new Set([
  'slideBgImage',
  'slideBgFit',
  'slideBgFocusX',
  'slideBgFocusY',
  'slideBgOverlay',
  'slideBgText',
  'slideLogo',
]);

/**
 * Whether a schema field key is rendered by these controls rather than by the
 * generic keeps loop.
 * @param {string} key
 * @returns {boolean}
 */
export function isBackgroundFieldKey(key) {
  return BG_COLOR_KEYS.has(key) || BG_IMAGE_KEYS.has(key);
}

// Sticky user preference for the "Background image" section. Defaults to
// CLOSED: since the split above, nothing primary lives in here, and an active
// image announces itself through the summary thumbnail instead of by forcing
// the panel open. Deliberately a new key — the old one carried the opposite
// default, so inheriting its values would reopen the panel for everyone.
const BG_IMAGE_SECTION_OPEN_KEY = 'editor.bgImageSection.open';

function readBgImageSectionOpen() {
  try {
    return localStorage.getItem(BG_IMAGE_SECTION_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function storeBgImageSectionOpen(open) {
  try {
    localStorage.setItem(BG_IMAGE_SECTION_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/**
 * Sample the current slide's background image and store which theme text colour
 * (light/dark) reads best, plus whether a scrim is still needed. Runs async and
 * persists the result on slide content (slideBgTextAuto / slideBgNeedsScrim) so
 * the server render (export/PDF/PNG) honours it without re-sampling pixels.
 * Idempotent per image via slideBgAutoFor, so the UI refresh it triggers does
 * not loop.
 * @param {object} slide
 * @param {object} pres
 * @param {{ markDirty?: Function, scheduleUiRefresh?: Function }} cbs
 */
export async function runBgContrastDetection(slide, pres, { markDirty, scheduleUiRefresh } = {}) {
  const url = String(slide?.content?.slideBgImage || '').trim();
  if (!url) return;
  if (slide.content.slideBgAutoFor === url) return; // already detected for this image
  let theme = null;
  try {
    theme = await loadThemeById(pres?.theme);
  } catch {
    theme = null;
  }
  let result;
  try {
    result = await detectBgTextContrast(url, {
      light: theme?.textColorLight || '#ffffff',
      dark: theme?.textColorDark || '#212121',
    });
  } catch {
    result = { ok: false };
  }
  // Guard against a race: the author may have swapped the image mid-detection.
  if (String(slide?.content?.slideBgImage || '').trim() !== url) return;
  slide.content.slideBgAutoFor = url;
  if (result?.ok) {
    slide.content.slideBgTextAuto = result.text;
    slide.content.slideBgNeedsScrim = !!result.needsScrim;
  } else {
    // Couldn't sample (e.g. cross-origin image) — drop any stale recommendation
    // so 'auto' falls back to the theme default rather than a wrong swap.
    delete slide.content.slideBgTextAuto;
    delete slide.content.slideBgNeedsScrim;
  }
  markDirty?.();
  scheduleUiRefresh?.();
}

/**
 * Hold back the image requests inside a collapsed section until it opens.
 *
 * `loading="lazy"` is not enough here: it defers on viewport proximity, and an
 * image inside a closed <details> is display:none rather than far away, so the
 * browser fetches it anyway (measured 2026-07-26 — all four theme presets
 * pulled their full-size originals for a panel nobody had opened). Parking the
 * URL in a data attribute is the only thing that actually defers it.
 *
 * @param {HTMLDetailsElement} details
 * @param {HTMLElement} body
 */
function deferImagesUntilOpen(details, body) {
  if (details.open) return;
  const imgs = [...body.querySelectorAll('img[src]')];
  if (!imgs.length) return;
  for (const img of imgs) {
    img.dataset.deferredSrc = img.getAttribute('src');
    img.removeAttribute('src');
  }
  const hydrate = () => {
    if (!details.open) return;
    for (const img of body.querySelectorAll('img[data-deferred-src]')) {
      img.setAttribute('src', img.dataset.deferredSrc);
      delete img.dataset.deferredSrc;
    }
    details.removeEventListener('toggle', hydrate);
  };
  details.addEventListener('toggle', hydrate);
}

/**
 * Build the two background surfaces for one slide.
 *
 * @param {Object} ctx
 * @param {Function} ctx.h - DOM helper
 * @param {Object} ctx.slide
 * @param {Object} ctx.pres
 * @param {Object|null} ctx.theme - active theme, for its override locks
 * @param {Map<string, Object>} ctx.fieldByKey
 * @param {Function} ctx.renderField
 * @param {Function} ctx.fieldGrid
 * @param {Function} [ctx.markDirty]
 * @param {Function} [ctx.scheduleUiRefresh]
 * @returns {{ colorGroup: HTMLElement|null, imageSection: HTMLElement|null }}
 *   Nodes to append, or null when the slide/theme leaves that half with nothing
 *   to show. The caller decides where they sit in the rail.
 */
export function buildBackgroundControls({
  h,
  slide,
  pres,
  theme = null,
  fieldByKey,
  renderField,
  fieldGrid,
  markDirty,
  scheduleUiRefresh,
} = {}) {
  // Theme override locks. A locked property's controls are omitted rather than
  // disabled — a disabled control invites you to wonder what it would do, and
  // the renderer ignores the value either way. One note explains the absence,
  // so the section never just looks broken.
  const bgLocked = isLocked(theme, 'background');
  const logoLocked = isLocked(theme, 'logo');
  const lockNote = () =>
    h('p', {
      class: 'help',
      text: t(
        'editor.slide.background.lockedByTheme',
        'Set by the theme and not editable per slide.'
      ),
    });

  return {
    colorGroup: buildColorGroup(),
    imageSection: buildImageSection(),
  };

  /** The always-visible colour field (plus a type's optional custom colour). */
  function buildColorGroup() {
    const colorField = bgLocked ? null : fieldByKey.get('background');
    // A locked background still says so where its control would have been —
    // silently omitting it reads as a missing feature.
    if (!colorField) {
      return bgLocked ? h('div', { class: 'stack editor-bg-color' }, [lockNote()]) : null;
    }
    const group = h('div', { class: 'stack editor-bg-color' });
    const colorEl = renderField({
      ...colorField,
      label: t('editor.slide.background.colourField', 'Background colour'),
    });
    if (colorEl) group.append(colorEl);
    // A type whose extended background enum offers a 'custom' value declares its
    // own colour input alongside it; only shown while 'custom' is selected (the
    // form rerenders on change, so this stays in sync). No core type declares
    // `bgCustomColor` today — the routing is type-agnostic and stays available
    // to fork types.
    const customField = fieldByKey.get('bgCustomColor');
    if (customField) {
      const customEl = renderField(customField);
      if (customEl) {
        if (slide.content?.background !== 'custom') customEl.style.display = 'none';
        group.append(customEl);
      }
    }
    return group.childNodes.length ? group : null;
  }

  /** The collapsed image section: picker, crop, fit/overlay, text, corner logo. */
  function buildImageSection() {
    const imageField = bgLocked ? null : fieldByKey.get('slideBgImage');
    const logoField = logoLocked ? null : fieldByKey.get('slideLogo');
    if (!imageField && !logoField) return null;

    const imageUrl = String(slide?.content?.slideBgImage || '').trim();
    const details = h('details', { class: 'editor-advanced editor-bg-section' });
    if (readBgImageSectionOpen()) details.open = true;
    details.addEventListener('toggle', () => storeBgImageSectionOpen(details.open));

    const summary = h('summary', {
      class: 'editor-advanced-summary',
      title: t(
        'editor.slide.background.imageSectionHelp',
        'A slide-wide background image, how it crops, and the theme corner logo.'
      ),
    });
    summary.append(
      h('span', { text: t('editor.slide.background.imageSection', 'Background image') })
    );
    // A set background must stay visible without costing the height of the open
    // panel — hence a thumbnail in the summary rather than the force-open this
    // section used to do.
    if (imageUrl) {
      summary.append(
        h('img', {
          class: 'editor-bg-summary-thumb',
          src: imageUrl,
          alt: '',
          loading: 'lazy',
          decoding: 'async',
        })
      );
    } else {
      summary.append(
        h('span', {
          class: 'editor-bg-status',
          text: t('editor.slide.background.statusNone', 'none'),
        })
      );
    }

    const body = h('div', { class: 'editor-advanced-body' });
    details.append(summary, body);

    if (bgLocked || logoLocked) body.append(lockNote());

    if (imageField) {
      // Inside a section already titled "Background image" the field's own
      // label would just repeat it.
      const imgEl = renderField({
        ...imageField,
        label: t('editor.slide.background.imageField', 'Image'),
      });
      if (imgEl) body.append(imgEl);
      // Crop focus, fit, overlay and text colour only mean anything once there
      // is an image — this is the tail that used to make the section huge.
      if (imageUrl) {
        body.append(
          renderFocusGridField({
            h,
            label: t('editor.slide.background.focus', 'Background focus (crop)'),
            helpText: t(
              'editor.slide.background.focusHelp',
              'Pick which part stays visible when the image is cropped to fill the slide.'
            ),
            focusX: slide.content?.slideBgFocusX ?? 50,
            focusY: slide.content?.slideBgFocusY ?? 50,
            onChange: ({ focusX, focusY }) => {
              slide.content.slideBgFocusX = focusX;
              slide.content.slideBgFocusY = focusY;
              markDirty?.();
              scheduleUiRefresh?.();
            },
          })
        );
        if (slide.content.slideBgFit == null) slide.content.slideBgFit = 'cover';
        if (slide.content.slideBgOverlay == null) slide.content.slideBgOverlay = 'auto';
        if (slide.content.slideBgText == null) slide.content.slideBgText = 'auto';
        // Auto-detect the readable text colour for the current image (async;
        // stores slideBgTextAuto / slideBgNeedsScrim, then refreshes). No-op
        // when already detected for this image URL.
        runBgContrastDetection(slide, pres, { markDirty, scheduleUiRefresh });
        const fitEl = fieldByKey.get('slideBgFit')
          ? renderField(fieldByKey.get('slideBgFit'))
          : null;
        const overlayEl = fieldByKey.get('slideBgOverlay')
          ? renderField(fieldByKey.get('slideBgOverlay'))
          : null;
        const textEl = fieldByKey.get('slideBgText')
          ? renderField(fieldByKey.get('slideBgText'))
          : null;
        const optionsRow = fieldGrid([fitEl, overlayEl].filter(Boolean), 2);
        if (optionsRow) body.append(optionsRow);
        if (textEl) body.append(textEl);
      }
    }

    // Theme logo (corner) toggle — independent of the background image, but it
    // is the same kind of rare, slide-wide decoration, so it shares the section.
    if (logoField) {
      if (slide.content.slideLogo == null) slide.content.slideLogo = 'none';
      const logoEl = renderField(logoField);
      if (logoEl) body.append(logoEl);
    }

    if (!body.childNodes.length) return null;
    deferImagesUntilOpen(details, body);
    return details;
  }
}
