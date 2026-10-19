/**
 * Text runs of one PDF page, in page coordinates (B751).
 *
 * pdf.js hands out text as runs: a string with a text matrix, a width and a
 * font id, interleaved with begin/end markers of the page's marked content.
 * This module flattens that into plain run records the line assembler and
 * the detectors read: position (origin top-left, y down, the baseline),
 * font size, bold, the marked-content id that ties the run to the structure
 * tree, and whether it sits inside an `Artifact` (footer, page number).
 */

/**
 * Font names that count as bold. `medium` does not: in families such as
 * GT America it is the regular text weight of a deck, and reading it as bold
 * would mark whole paragraphs bold.
 */
export const BOLD_FONT_PATTERN =
  /bold|black|heavy|semibold|demibold|extrabold|ultrabold/i;

/**
 * Whether a font name names a bold weight.
 *
 * @param {string | null | undefined} fontName
 * @returns {boolean}
 */
export function isBoldFont(fontName) {
  return BOLD_FONT_PATTERN.test(String(fontName || ''));
}

/**
 * @typedef {object} TextRun
 * @property {string} str - the run text as pdf.js gives it (not normalised)
 * @property {number} x - left edge of the run, page units from the left
 * @property {number} y - baseline, page units from the top
 * @property {number} width - horizontal extent in page units: the advance
 *   projected on the x axis, so a run turned 90° (a vertical column header)
 *   is 0 wide and never seems to overlap the run beside it (B773)
 * @property {number} size - font size in page units
 * @property {boolean} bold
 * @property {string} font - the embedded font name, '' when unknown
 * @property {string | null} mcid - innermost marked-content id, if any
 * @property {boolean} artifact - inside `Artifact` marked content
 */

/**
 * Flatten `getTextContent({ includeMarkedContent: true })` into runs.
 *
 * Font names are only readable after `page.getOperatorList()` has loaded the
 * fonts; `fontNameOf` resolves a pdf.js font id to its name.
 *
 * @param {{ items: Array<object> }} textContent
 * @param {object} opts
 * @param {{ convertToViewportPoint: (x: number, y: number) => number[] }} opts.viewport
 * @param {(fontId: string) => string} [opts.fontNameOf]
 * @returns {TextRun[]}
 */
export function readTextRuns(textContent, { viewport, fontNameOf = () => '' }) {
  const stack = [];
  const runs = [];
  for (const item of textContent.items) {
    if (
      item.type === 'beginMarkedContent' ||
      item.type === 'beginMarkedContentProps'
    ) {
      stack.push({ tag: item.tag || null, id: item.id || null });
      continue;
    }
    if (item.type === 'endMarkedContent') {
      stack.pop();
      continue;
    }
    if (typeof item.str !== 'string' || item.str === '') continue;
    const [a, b, , , e, f] = item.transform;
    const [x, y] = viewport.convertToViewportPoint(e, f);
    const font = fontNameOf(item.fontName) || '';
    const size = Math.hypot(a, b);
    runs.push({
      str: item.str,
      x,
      y,
      width: size ? ((item.width || 0) * Math.abs(a)) / size : 0,
      size,
      bold: isBoldFont(font),
      font,
      mcid: stack.findLast((m) => m.id)?.id ?? null,
      artifact: stack.some((m) => m.tag === 'Artifact'),
    });
  }
  return runs;
}

/**
 * Whether a run starts inside the page box (1 unit of tolerance).
 *
 * @param {TextRun} run
 * @param {{ width: number, height: number }} page
 * @returns {boolean}
 */
export function isOnPage(run, { width, height }) {
  return (
    run.x >= -1 && run.x <= width + 1 && run.y >= -1 && run.y <= height + 1
  );
}
