/**
 * One theme card (D353): the title slide a new deck in a theme starts with,
 * rendered for real, with the theme's name under it.
 *
 * Home's "Start something new" row and the creation view's theme grid render
 * this same card, so a theme cannot look one way on Home and another in the
 * picker. The card loads its theme and renders its slide lazily, the first
 * time it scrolls near the viewport, like the slide-type picker's tiles.
 */

import { t } from '../../lib/ui-i18n.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import {
  NO_DECK_LANG,
  RENDER_VIA_THEME,
  renderSlideElement,
} from '../../lib/slide-runtime/slide-render.js';
import { attachThumbScale } from '../../lib/slide-runtime/thumb-scale.js';
import { h } from '../../lib/dom/index.js';
import { disposeAll } from '../../lib/dom/disposal.js';
import { newSlide } from '../../../shared/slide-types/presentation.js';

/**
 * The sample slide a theme card shows: the title slide a new deck in this
 * theme starts with, composed by `newSlide()` like that first slide is, with
 * the theme's label as its title. So the card carries the theme's
 * `defaultBackground` and its first background preset where it declares them
 * (the same preset the deck is seeded with, `pickBackgroundPreset`), and the
 * type's own default ground where it does not; there is no ground of the
 * card's own (it used to hard-code `lime`, which a fork theme like Dreamkit
 * neither uses nor colours, B431).
 *
 * @param {Object} theme - full theme object
 * @param {Record<string, Object>} slideTypes - the live type map
 *   (`/api/slide-types`), so a fork's own title type composes too
 * @returns {Object} a slide
 * @throws when the theme's title type is not in `slideTypes`
 */
export function themePreviewSlide(theme, slideTypes) {
  return newSlide({
    type: theme?.defaultTitleSlide || 'title-slide',
    theme,
    slideTypes,
    content: { title: theme?.label || 'Theme Preview' },
  });
}

/**
 * The value choosing a card writes into a deck's `theme`. The workspace
 * default's card writes `default`, not its id, so the deck follows the
 * workspace when the default changes (D232); every other card writes its id.
 *
 * @param {{id?: string, isDefault?: boolean}} record - a `GET /api/themes` entry
 * @returns {string}
 */
export function themeCardValue(record) {
  return record?.isDefault ? 'default' : String(record?.id || '');
}

/**
 * Create a theme card.
 *
 * @param {Object} options
 * @param {{id: string, label?: string, isDefault?: boolean}} options.record -
 *   the theme's `GET /api/themes` entry
 * @param {Record<string, Object>} options.slideTypes - the live type map
 * @param {(value: string, record: Object) => void} [options.onSelect] - called
 *   with {@link themeCardValue} when the card is clicked
 * @param {{observe: Function}} [options.inView] - a `createInViewLoader()`
 *   to defer the render; without one the card renders at once
 * @returns {{el: HTMLButtonElement, value: string, setSelected: (selected: boolean) => void, detach: () => void}}
 */
export function createThemeCard({ record, slideTypes, onSelect, inView }) {
  const value = themeCardValue(record);
  const name = String(
    record?.label || record?.id || t('list.theme.unnamed', 'Unnamed theme'),
  );

  const thumb = h('div', { class: 'thumb theme-picker-thumb' });
  const caption = h('span', { class: 'theme-picker-caption' }, [
    h('span', { class: 'theme-picker-name', text: name }),
  ]);
  if (record?.isDefault) {
    caption.append(
      h('span', {
        class: 'theme-picker-badge',
        text: t('common.themeDefault', 'Workspace default'),
      }),
    );
  }
  const el = h(
    'button',
    {
      type: 'button',
      class: 'theme-picker-item',
      title: name,
      onclick: () => onSelect?.(value, record),
    },
    [h('div', { class: 'theme-picker-preview' }, [thumb]), caption],
  );

  let detachScale = null;
  let detached = false;

  async function render() {
    try {
      const theme = await loadThemeById(record.id);
      if (detached) return;
      const slideEl = renderSlideElement(themePreviewSlide(theme, slideTypes), {
        mode: 'thumb',
        theme,
        renderVia: RENDER_VIA_THEME,
        lang: NO_DECK_LANG,
      });
      thumb.replaceChildren(slideEl);
      detachScale = attachThumbScale(thumb, { virtualWidth: 1600 });
    } catch (err) {
      if (detached) return;
      thumb.replaceChildren(
        h('div', { class: 'theme-picker-fallback', text: name }),
      );
      // eslint-disable-next-line no-console
      console.warn(`[theme-card] Failed to render ${record?.id}:`, err);
    }
  }

  if (inView) inView.observe(el, render);
  else render();

  return {
    el,
    value,
    setSelected(selected) {
      el.classList.toggle('is-selected', !!selected);
      el.setAttribute('aria-pressed', selected ? 'true' : 'false');
    },
    detach() {
      detached = true;
      disposeAll([detachScale]);
      detachScale = null;
    },
  };
}
