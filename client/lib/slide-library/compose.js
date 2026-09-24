/**
 * Compose a new deck from slide-library items.
 *
 * The single source of truth for turning selected library items into the
 * `POST /api/presentations` `slides[]` payload. Both the slide-library sidebar
 * view and the creation view's "From the library" panel go through here so the
 * two paths can't drift again.
 *
 * Library items carry per-language content under `i18n.versions[lang].content`,
 * in any language of the deck axis. We forward every available language as
 * `contentByLang` so the server can build one i18n version per language — a
 * composed deck keeps them all instead of collapsing to whichever the picker
 * happened to show.
 *
 * The item's content is forwarded as it is stored: a content key that belongs
 * to the slide *instance* rather than to the item (a `pollId`, a follow-invite's
 * `presentationId`) is re-derived server-side, in every language version at
 * once — server/storage/presentations/crud/rekey-new-deck.js. Doing it here
 * instead would cover the two views that call this and miss every agent that
 * posts `slides[]` straight to the API.
 */

import { copySlides } from '../slide-authoring/slide-clipboard.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
  TRANSLATION_LANGS,
} from '../../../shared/i18n-utils.js';

/**
 * Build the `slides[]` payload from library items, preserving per-language
 * content where the item has it.
 * @param {Array<Object>} items - Selected library items ({ slideType, content, i18n }).
 * @returns {Array<{type: string, content: Object, contentByLang?: Object}>}
 */
export function buildSlidesFromLibraryItems(items) {
  const list = Array.isArray(items) ? items : [];
  return list.map((item) => {
    const versions = item?.i18n?.versions;
    const contentByLang = {};
    if (versions && typeof versions === 'object') {
      for (const lang of TRANSLATION_LANGS) {
        const c = versions[lang]?.content;
        if (c && typeof c === 'object') contentByLang[lang] = c;
      }
    }
    // Flat content: the item's default, else any available language version.
    const flat =
      item?.content && typeof item.content === 'object'
        ? item.content
        : TRANSLATION_LANGS.map((l) => contentByLang[l]).find(Boolean) || {};
    const slide = { type: item?.slideType, content: flat };
    if (Object.keys(contentByLang).length) slide.contentByLang = contentByLang;
    return slide;
  });
}

/**
 * Copy one library item onto the slide clipboard, for a later paste in a deck.
 *
 * There is one slide clipboard: the `ps:slide-clipboard` buffer the editor's
 * paste bar and Ctrl/Cmd+V read (slide-authoring/slide-clipboard.js). The
 * library used to write raw JSON to the OS clipboard instead, which nothing
 * reads back, so "paste it with Ctrl/Cmd+V" was a promise with no paste behind
 * it. The item goes in as a slide of the clipboard's own shape; it has no deck
 * id and no parent, so it pastes at the top level with fresh ids.
 *
 * `item.content` is the content to paste: the caller resolves the language
 * (the use-modal hands over the version the picker shows).
 * @param {Object} item - A library item ({ slideType, content }).
 * @returns {boolean} Whether the clipboard was written.
 */
export function copyLibraryItemToClipboard(item) {
  const type = String(item?.slideType || '').trim();
  if (!type) return false;
  const content =
    item?.content && typeof item.content === 'object' ? item.content : {};
  return copySlides([{ type, content }]);
}

/**
 * Create a new presentation from selected library items via the batch primitive.
 *
 * The source item ids (and, when the deck started from a saved collection, its
 * id) are forwarded so the server can record per-user library usage — this is
 * what clears the Home "new to you" badge. Sending the ids server-side (rather
 * than a separate client call) means MCP/agent composes are tracked too.
 * @param {Object} opts
 * @param {Function} opts.api - API client.
 * @param {Array<Object>} opts.items - Selected library items.
 * @param {string} opts.title - Deck title.
 * @param {string} [opts.lang] - Dominant language for the new deck.
 * @param {string} [opts.theme] - Theme id for the new deck. Omit it and the
 *   server picks the default (sandbox-aware, `DEFAULT_THEME` env seam) — the
 *   client does not own that decision.
 * @param {string} [opts.sourceCollectionId] - Collection the deck started from.
 * @returns {Promise<Object>} The created presentation.
 */
export function createDeckFromLibraryItems({
  api,
  items,
  title,
  lang = DEFAULT_DECK_LANG,
  theme = null,
  sourceCollectionId = null,
}) {
  const slides = buildSlidesFromLibraryItems(items);
  const sourceLibraryItemIds = (Array.isArray(items) ? items : [])
    .map((it) => String(it?.id || '').trim())
    .filter(Boolean);
  const payload = {
    title,
    slides,
    lang: normalizeLang(lang) || DEFAULT_DECK_LANG,
  };
  const themeId = String(theme || '').trim();
  if (themeId) payload.theme = themeId;
  if (sourceLibraryItemIds.length)
    payload.sourceLibraryItemIds = sourceLibraryItemIds;
  const collectionId = String(sourceCollectionId || '').trim();
  if (collectionId) payload.sourceCollectionId = collectionId;
  return api('/api/presentations', {
    method: 'POST',
    body: payload,
  });
}
