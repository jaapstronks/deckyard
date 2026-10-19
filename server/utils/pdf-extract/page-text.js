/**
 * The plain text of a page model (B752, moved here in B772).
 *
 * Two readers need the same text: the slide import, for the notes of a page
 * that falls back, and the AI route, for the source it generates from. Both
 * take what the page model kept, so footnotes, reference marks and artifacts
 * stay out of both.
 */

/**
 * The plain text of one block, one line per item, row or card part.
 * @param {import('./index.js').PageBlock} block
 * @param {object} [opts]
 * @param {boolean} [opts.listMarkers=false] - start each list item with
 *   `- ` (or `1. ` in a numbered list), so a reader still sees the list
 * @returns {string[]}
 */
export function blockLines(block, { listMarkers = false } = {}) {
  switch (block.kind) {
    case 'list':
      return block.items.map((item, i) =>
        listMarkers
          ? `${block.variant === 'numbers' ? `${i + 1}.` : '-'} ${item.text}`
          : item.text,
      );
    case 'table':
      return block.rows.map((r) => r.join('\t'));
    case 'cards':
      return block.cards.flatMap((c) => [c.title, c.body]);
    default:
      return [block.text];
  }
}

/**
 * One block as one line.
 * @param {import('./index.js').PageBlock} block
 * @returns {string}
 */
export function blockText(block) {
  return blockLines(block).join(' ');
}

/**
 * The text of the page as plain lines: the heading, every block, then the
 * labels of a drawing.
 * @param {import('./index.js').PageModel} page
 * @param {object} [opts]
 * @param {boolean} [opts.listMarkers=false] - see {@link blockLines}
 * @returns {string}
 */
export function pageText(page, { listMarkers = false } = {}) {
  return [
    ...(page.heading ? [page.heading] : []),
    ...page.blocks.flatMap((block) => blockLines(block, { listMarkers })),
    ...(page.drawing?.labels || []).map((l) => l.text),
  ]
    .filter((t) => String(t).trim())
    .join('\n');
}
