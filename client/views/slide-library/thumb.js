/**
 * Slide library thumb - the one preview a library item has, wherever it is
 * shown: the library page's cards, the picker, and Home's building blocks
 * (B616). Scaling is the library's own: `.ps-lib-thumb` inside a
 * `.ps-lib-thumb-wrap` (the size container), so no observer to clean up.
 */

import {
  RENDER_VIA_THEME,
  renderSlideElement,
} from '../../lib/slide-runtime/slide-render.js';
import { loadThemeById } from '../../lib/theme/theme.js';
import { h } from '../../lib/dom/index.js';
import { cleanStr } from '../../../shared/string-utils.js';
import { DEFAULT_THEME_REF } from '../../../shared/constants/themes.js';
import { getContentForLang } from './search.js';

/**
 * The slide a library item renders as, in the given language (falling back to
 * the item's base content when it has no version in that language).
 * @param {object} item - library item ({ slideType, content, i18n })
 * @param {string|null} lang
 * @returns {{ id: string, type: string, content: object, notes: string }}
 */
export function libraryItemSlide(item, lang) {
  return {
    id: 'lib-preview',
    type: cleanStr(item?.slideType),
    content: getContentForLang(item, lang),
    notes: '',
  };
}

/**
 * A cached theme lookup for library items: a fixed theme object wins, else
 * the item's own theme, else `themeId`, else the default theme.
 * @param {object} [opts]
 * @param {object|null} [opts.theme] - theme object every item renders in
 * @param {string} [opts.themeId] - fallback theme id for items without one
 * @returns {(item: object) => Promise<object>}
 */
export function createLibraryThemeResolver({
  theme = null,
  themeId = '',
} = {}) {
  const fallbackId = cleanStr(themeId);
  const cache = new Map();
  return async (item) => {
    if (theme && typeof theme === 'object') return theme;
    const key =
      cleanStr(item?.themeId || '') || fallbackId || DEFAULT_THEME_REF;
    if (cache.has(key)) return cache.get(key);
    const loaded = await loadThemeById(key);
    cache.set(key, loaded);
    return loaded;
  };
}

/**
 * Render a library item's preview thumb. Mount it in a `.ps-lib-thumb-wrap`,
 * which sizes it. Returns null for an item without a slide type.
 * @param {object} item - library item
 * @param {object} opts
 * @param {(item: object) => Promise<object>} opts.resolveTheme
 * @param {string|null} opts.lang - the language to preview the item in
 * @returns {Promise<HTMLElement|null>}
 */
export async function renderLibraryThumb(item, { resolveTheme, lang }) {
  if (!cleanStr(item?.slideType)) return null;
  const theme = await resolveTheme(item);
  return h('div', { class: 'thumb ps-lib-thumb' }, [
    renderSlideElement(libraryItemSlide(item, lang), {
      mode: 'thumb',
      theme,
      renderVia: RENDER_VIA_THEME,
      lang,
    }),
  ]);
}
