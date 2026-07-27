/**
 * The identity of the deck interchange format: the sentinel a portable deck
 * carries in its `format` field, and the MIME type a `.deck` bundle declares.
 *
 * WHY THIS MODULE EXISTS
 *
 * Both values were string literals repeated across every writer (the envelope
 * builder, the bundle builder, the export route, the markdown/Notion importers,
 * the AI generators and one AI prompt). There was no single place to change
 * them, which is how the wrong name survived a rename of the whole product.
 *
 * That name was `slidecreator`. It was invented in the very commit that added
 * JSON export (2025-12-13, "adds json export and import") at a time when this
 * project's package was called `presentation-system` and its README called it
 * "Slide Deck Builder" — so it was never a name the product used. It is a
 * placeholder that was never revisited.
 *
 * A published format is named after its publisher (compare
 * `application/vnd.oasis.opendocument.presentation`), so the current identity
 * is `deckyard.deck`. The legacy values are not deleted: a conforming reader
 * accepts them forever, which is what `isDeckFormatId` / `isDeckMimetype` are
 * for. Only the writers move.
 *
 * The **file extension is unaffected**. A downloaded bundle has always been
 * `<title>.deck` and stays that way; the namespace lives before the dot, never
 * in the filename.
 *
 * @see docs/reference/deck-format.md
 * @see docs/reference/deck-bundle-format.md
 */

/** The `format` sentinel written into every portable deck envelope. */
export const DECK_FORMAT_ID = 'deckyard.deck';

/**
 * Format sentinels written by earlier versions. Accepted on read, never
 * written. Removing an entry here breaks decks that are already in the wild.
 */
export const LEGACY_DECK_FORMAT_IDS = Object.freeze(['slidecreator.deck']);

/** The MIME type a `.deck` bundle declares (IANA vendor tree). */
export const DECK_MIMETYPE = 'application/vnd.deckyard.deck';

/** Bundle MIME types written by earlier versions. Accepted on read, never written. */
export const LEGACY_DECK_MIMETYPES = Object.freeze([
  'application/vnd.slidecreator.deck',
]);

/**
 * Is this the `format` sentinel of a deck envelope, current or historical?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDeckFormatId(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v === DECK_FORMAT_ID || LEGACY_DECK_FORMAT_IDS.includes(v);
}

/**
 * Is this the mimetype sentinel of a `.deck` bundle, current or historical?
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDeckMimetype(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v === DECK_MIMETYPE || LEGACY_DECK_MIMETYPES.includes(v);
}
