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
 * is `deckyard.deck`. The historical id is not a second accepted value: the
 * read funnel (`schema-version.js`, v18 -> v19) rewrites it to the current one
 * before anything reads `format`, so a deck written under the old name imports
 * and re-exports under the new one. The v4 bundle requires the current MIME
 * type.
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
 * The format sentinel earlier versions wrote. Folded to `DECK_FORMAT_ID` by
 * the read funnel, so no reader after the funnel ever sees it (B257, D121).
 */
export const RETIRED_DECK_FORMAT_ID = 'slidecreator.deck';

/**
 * The MIME type a `.deck` bundle declares. Registered with IANA in the vendor
 * tree on 2026-08-13; changing it goes through Expert Review, so it is not a
 * value to rename lightly.
 * @see https://www.iana.org/assignments/media-types/application/vnd.deckyard.deck
 */
export const DECK_MIMETYPE = 'application/vnd.deckyard.deck';

/**
 * Is this the `format` sentinel of a deck envelope? One spelling: the funnel
 * has already folded the retired one by the time a reader asks.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDeckFormatId(value) {
  return typeof value === 'string' && value.trim() === DECK_FORMAT_ID;
}
