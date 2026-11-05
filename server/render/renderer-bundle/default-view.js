/**
 * Which view of an edition its bare address answers.
 *
 * The bundle says so itself, in the document it renders: a reader that carries
 * this marker is the bundle's default view, and without it the canvas is, which
 * is what every bundle built before the marker meant. That keeps the answer
 * frozen per bundle, so an old edition keeps the address its frozen chrome
 * links to. It travels in the document because the runner's wire contract
 * returns the two documents and discards every other guest value
 * (`docs/reference/renderer-bundle.md` § Wire contract and memory). A guest
 * can only choose between its own two documents with it.
 *
 * Pure: no reads, no clock, no environment. The render entry imports it too.
 */

/** The `<head>` line of a reader that is its bundle's default view. */
export const READER_IS_DEFAULT_META =
  '<meta name="deckyard:default-view" content="reader" />';

/**
 * The view an edition's bare address answers, from its rendered reader.
 *
 * @param {string} readerHtml
 * @returns {'canvas'|'reader'}
 */
export function declaredDefaultView(readerHtml) {
  const headEnd = readerHtml.indexOf('</head>');
  const head = headEnd < 0 ? '' : readerHtml.slice(0, headEnd);
  return head.includes(READER_IS_DEFAULT_META) ? 'reader' : 'canvas';
}
