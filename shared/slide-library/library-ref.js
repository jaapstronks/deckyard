/**
 * A deck slide's library provenance (B904, D223): the library item it was
 * inserted from and the item revision its content is a copy of.
 *
 * Inserting from the library still copies; the copy remembers where it came
 * from so a newer revision of the item can be *reported* to the deck owner,
 * never pushed into the deck. One key on the slide, one shape:
 *
 *   slide.libraryRef = { itemId, revision, ignoredRevision? }
 *
 * - `itemId` - the `slide_library.id` (a UUID). It only means something on the
 *   instance that holds the item, which is why the portable deck format never
 *   carries it (shared/slide-types/deck.js projects an allowlist).
 * - `revision` - the item revision the slide's content was copied from.
 * - `ignoredRevision` - the newest revision the owner chose to ignore; a later
 *   revision reports again, this one does not.
 *
 * The ref belongs to the slide, not to one language version: every version of
 * a deck carries the same ref for the same slide id
 * ({@link alignLibraryRefs}).
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isRevision = (v) => Number.isInteger(v) && v >= 0;

/**
 * The canonical form of a slide's `libraryRef`, or null when the value is not
 * one. A malformed ref is dropped, not refused: it only drives a notice, and a
 * slide without one is an ordinary slide.
 * @param {unknown} raw
 * @returns {{itemId: string, revision: number, ignoredRevision?: number}|null}
 */
export function normalizeLibraryRef(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const itemId = typeof raw.itemId === 'string' ? raw.itemId.trim() : '';
  if (!UUID_RE.test(itemId) || !isRevision(raw.revision)) return null;
  const ref = { itemId: itemId.toLowerCase(), revision: raw.revision };
  if (isRevision(raw.ignoredRevision) && raw.ignoredRevision > raw.revision)
    ref.ignoredRevision = raw.ignoredRevision;
  return ref;
}

/**
 * The ref a slide inserted from `item` starts with, or null when the item has
 * no id or revision to point at.
 * @param {{id?: string, revision?: number}} item - a library item
 * @returns {{itemId: string, revision: number}|null}
 */
export function libraryRefForItem(item) {
  return normalizeLibraryRef({ itemId: item?.id, revision: item?.revision });
}

/**
 * Whether `itemRevision` is news for a slide with this ref: newer than the
 * copy and newer than what the owner ignored.
 * @param {object|null} ref - a normalized ref
 * @param {number} itemRevision - the item's current revision
 * @returns {boolean}
 */
export function isNewerLibraryRevision(ref, itemRevision) {
  if (!ref || !isRevision(itemRevision)) return false;
  return itemRevision > Math.max(ref.revision, ref.ignoredRevision ?? -1);
}

/**
 * Set or clear `libraryRef` on one slide, in place, to its canonical form.
 * @param {object} slide
 * @param {unknown} raw
 */
function applyRef(slide, raw) {
  const ref = normalizeLibraryRef(raw);
  if (ref) slide.libraryRef = ref;
  else delete slide.libraryRef;
}

/**
 * Give every language version of a deck the same `libraryRef` per slide id,
 * in place. The authority is the version that was just written (`fromLang`,
 * the language the editor sends as top-level slides): a ref it carries, or
 * dropped, holds for that slide in every other version. A slide id the
 * authority does not have keeps what its own version says.
 *
 * @param {Record<string, {slides?: object[]}>} versions - `i18n.versions`
 * @param {string} fromLang - the authoritative version
 */
export function alignLibraryRefs(versions, fromLang) {
  const source = versions?.[fromLang]?.slides;
  if (!Array.isArray(source)) return;
  const byId = new Map();
  for (const s of source) {
    if (!s || typeof s !== 'object') continue;
    applyRef(s, s.libraryRef);
    if (typeof s.id === 'string' && s.id) byId.set(s.id, s.libraryRef);
  }
  for (const [lang, version] of Object.entries(versions)) {
    if (lang === fromLang || !Array.isArray(version?.slides)) continue;
    for (const s of version.slides) {
      if (!s || typeof s !== 'object') continue;
      applyRef(s, byId.has(s.id) ? byId.get(s.id) : s.libraryRef);
    }
  }
}

/**
 * Every linked slide of a deck, once per slide id: the rows the
 * `slide_library_links` table holds for it. Reads every version, so a slide
 * that exists only in a non-dominant version is linked too.
 * @param {object} pres - a stored presentation
 * @returns {Array<{slideId: string, itemId: string, revision: number, ignoredRevision: number|null}>}
 */
export function libraryLinksOf(pres) {
  const lists = [
    pres?.slides,
    ...Object.values(pres?.i18n?.versions || {}).map((v) => v?.slides),
  ];
  const out = new Map();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      const id = typeof s?.id === 'string' ? s.id : '';
      const ref = normalizeLibraryRef(s?.libraryRef);
      if (!id || !ref || out.has(id)) continue;
      out.set(id, {
        slideId: id,
        itemId: ref.itemId,
        revision: ref.revision,
        ignoredRevision: ref.ignoredRevision ?? null,
      });
    }
  }
  return [...out.values()];
}
