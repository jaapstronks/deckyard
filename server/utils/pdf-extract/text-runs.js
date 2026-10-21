/**
 * Text runs of one PDF page, in page coordinates (B751).
 *
 * pdf.js hands out text as runs: a string with a text matrix, a width and a
 * font id, interleaved with begin/end markers of the page's marked content.
 * This module flattens that into plain run records the line assembler and
 * the detectors read: position (origin top-left, y down, the baseline),
 * font size, bold, the marked-content id that ties the run to the structure
 * tree, and whether it sits inside an `Artifact` (footer, page number).
 *
 * Colour (B827) is not in the text content: it is the fill colour in force
 * at each `showText` in the operator list (`images.js` records those as
 * `textPaints`). Both are the same glyph stream in the same order, so the
 * runs are aligned with the paints character by character, within each
 * marked content so a slip stays local; a group whose characters do not add
 * up falls back to the colour most of its paints share.
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
 * @property {string | null} color - `#rrggbb` the run is drawn in, null when
 *   unknown (a pattern, or no paints to align with)
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
 * @param {Array<import('./images.js').TextPaint>} [opts.textPaints] - the
 *   page's `showText` operations in content order, for the colour
 * @returns {TextRun[]}
 */
export function readTextRuns(
  textContent,
  { viewport, fontNameOf = () => '', textPaints = [] },
) {
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
      color: null,
      mcid: stack.findLast((m) => m.id)?.id ?? null,
      artifact: stack.some((m) => m.tag === 'Artifact'),
    });
  }
  assignColors(runs, textPaints);
  return runs;
}

/** The characters that count for alignment: no whitespace, ligatures expanded. */
const alignKey = (text) => String(text).normalize('NFKC').replace(/\s+/g, '');

const mcidNumber = (id) => {
  const match = /_mc(\d+)$/.exec(String(id ?? ''));
  return match ? Number(match[1]) : null;
};

const dominant = (colors) => {
  const counts = new Map();
  let best = null;
  let bestCount = 0;
  for (const color of colors) {
    if (color === null) continue;
    const count = (counts.get(color) || 0) + 1;
    counts.set(color, count);
    if (count > bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
};

/**
 * Give each run the colour of the paint its characters came from. Runs and
 * paints are grouped by marked-content id (untagged pages form one group);
 * within a group the characters are consumed in order.
 */
function assignColors(runs, textPaints) {
  if (!textPaints.length) return;
  const groups = new Map();
  const group = (key) => {
    if (!groups.has(key)) groups.set(key, { runs: [], paints: [] });
    return groups.get(key);
  };
  for (const run of runs) group(mcidNumber(run.mcid)).runs.push(run);
  for (const paint of textPaints) group(paint.mcid ?? null).paints.push(paint);
  for (const { runs: groupRuns, paints } of groups.values()) {
    if (!groupRuns.length) continue;
    const perChar = paints.flatMap((p) =>
      Array.from(alignKey(p.text), () => p.color),
    );
    const wanted = groupRuns.reduce((n, r) => n + alignKey(r.str).length, 0);
    if (perChar.length !== wanted) {
      const fallback = dominant(paints.map((p) => p.color));
      for (const run of groupRuns) run.color = fallback;
      continue;
    }
    let at = 0;
    for (const run of groupRuns) {
      const length = alignKey(run.str).length;
      run.color = length
        ? dominant(perChar.slice(at, at + length))
        : (perChar[at] ?? perChar.at(-1) ?? null);
      at += length;
    }
  }
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
