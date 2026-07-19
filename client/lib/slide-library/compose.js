/**
 * Compose a new deck from slide-library items.
 *
 * The single source of truth for turning selected library items into the
 * `POST /api/presentations` `slides[]` payload. Both the slide-library sidebar
 * view and the creation view's "From the library" panel go through here so the
 * two paths can't drift again.
 *
 * Library items carry per-language content under `i18n.versions[lang].content`
 * (nl + en-GB). We forward every available language as `contentByLang` so the
 * server can build one i18n version per language — a composed deck keeps both
 * languages instead of collapsing to whichever the picker happened to show.
 */

const SUPPORTED_LANGS = ['nl', 'en-GB'];

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
      for (const lang of SUPPORTED_LANGS) {
        const c = versions[lang]?.content;
        if (c && typeof c === 'object') contentByLang[lang] = c;
      }
    }
    // Flat content: the item's default, else any available language version.
    const flat =
      item?.content && typeof item.content === 'object'
        ? item.content
        : contentByLang.nl || contentByLang['en-GB'] || {};
    const slide = { type: item?.slideType, content: flat };
    if (Object.keys(contentByLang).length) slide.contentByLang = contentByLang;
    return slide;
  });
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
 * @param {string} [opts.theme] - Theme id for the new deck.
 * @param {string} [opts.sourceCollectionId] - Collection the deck started from.
 * @returns {Promise<Object>} The created presentation.
 */
export function createDeckFromLibraryItems({
  api,
  items,
  title,
  lang = 'nl',
  theme = 'deckyard',
  sourceCollectionId = null,
}) {
  const slides = buildSlidesFromLibraryItems(items);
  const sourceLibraryItemIds = (Array.isArray(items) ? items : [])
    .map((it) => String(it?.id || '').trim())
    .filter(Boolean);
  const payload = {
    title,
    slides,
    theme,
    lang: lang === 'en-GB' ? 'en-GB' : 'nl',
  };
  if (sourceLibraryItemIds.length) payload.sourceLibraryItemIds = sourceLibraryItemIds;
  const collectionId = String(sourceCollectionId || '').trim();
  if (collectionId) payload.sourceCollectionId = collectionId;
  return api('/api/presentations', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
