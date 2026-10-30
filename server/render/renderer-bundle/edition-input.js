/**
 * The edition input: everything a sealed renderer is allowed to know.
 *
 * One schema id, declared apart from both the entry that consumes it and the
 * seam that re-exports it, so naming the contract does not drag the renderer's
 * whole import closure into a caller that only wanted the name.
 *
 * Producing one of these is T1.2's job (the public projection, the closed asset
 * set, the canonical manifest). T1.1 only pins the shape the renderer accepts,
 * and the rule behind the shape: if a value can differ between two
 * installations or two days, it is in here, not read at render time.
 *
 * @typedef {Object} EditionInput
 * @property {string} schema - {@link EDITION_INPUT_SCHEMA}
 * @property {object} presentation - The public projection of the deck. Already
 *   visibility-filtered, with every asset reference an inline data URL: the
 *   renderer cannot fetch and must not need to.
 * @property {object|null} [theme] - The effective theme record, with the
 *   dynamic `default` already resolved.
 *
 *   There is deliberately **no slide-type registry field**. The renderer's
 *   registry is the one frozen in its own bundle, so a core type whose render
 *   code changed cannot change a published edition. A deck using a
 *   database-backed slide type therefore cannot be published as a frozen
 *   edition in v1: that type's template sanitises its interpolated output on
 *   every render, through `jsdom`/`dompurify`, which no bundle can carry. The
 *   render entry refuses such an edition by name rather than rendering it
 *   differently. `docs/reference/renderer-bundle.md` § The open question states
 *   the three ways out and which one is recommended.
 * @property {{fontCss?: string, wmCss?: string, wmHtml?: string}} [css] - CSS
 *   layers that are bytes rather than logic: the embedded font faces and the
 *   sandbox watermark.
 * @property {string} [metaDescription] - `<meta name="description">`.
 * @property {string} [canonicalUrl] - The canvas address of this edition. Not
 *   part of the stored input (the number exists only once the edition is
 *   committed): the public read path sets it from the edition record, and the
 *   render entry derives the document's links and card from it.
 * @property {string} [lang] - The language version to render. A request value
 *   of the read path, never stored.
 */

/** The only edition-input schema this build accepts. */
export const EDITION_INPUT_SCHEMA = 'deckyard.edition-input/1';
