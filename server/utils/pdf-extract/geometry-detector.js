/**
 * Roles from geometry, for pages without a structure tree (B751).
 *
 * Keynote and other untagged producers give text runs and positions only.
 * This detector reads the same page model out of the lines of `lines.js`
 * that the struct detector reads out of the tags, with plain rules:
 *
 * - **Heading**: the largest font size, at most two consecutive lines, the
 *   first in the top half of the page, and clearly larger than the rest
 *   (≥ 1.2× their median size), or the only text on the page.
 * - **List item**: a line that starts with a bullet glyph (`•·▪●◦▸►✓`, or
 *   `-`/`–` followed by a space) or a number (`1.` / `1)`). The marker is
 *   stripped from the item text and recorded as the list's `variant`; an
 *   indented line right below joins the item.
 * - **Table**: two or more consecutive lines split into segments (cells, see
 *   `SEGMENT_GAP_EM`) whose left or right edges share at least two
 *   x-positions with the row above.
 * - **Paragraph**: the remaining lines, a new paragraph wherever the gap to
 *   the line above exceeds 1.6 em or the font size changes by more than 15%.
 *
 * Captions, quotes and cards need the structure tree; geometry does not
 * guess them.
 */

import { joinLineText, normalizeText } from './lines.js';

/** Glyphs that open a bulleted list item when they start a line. */
export const BULLET_GLYPHS = '•·▪●◦▸►✓';

const MARKER_PATTERN = new RegExp(
  `^(?:([${BULLET_GLYPHS}])\\s*|([-–])\\s+|(\\d{1,2})[.)]\\s+)(?=\\S)`,
  'u',
);

/** A whole string that is only a list marker (a `Lbl`, an orphan number). */
const BARE_MARKER_PATTERN = new RegExp(
  `^(?:[${BULLET_GLYPHS}\\-–]|\\d{1,2}[.)]?|[a-z][.)]|[ivx]{1,4}[.)])$`,
  'iu',
);

/**
 * Split a leading list marker off a line of text.
 *
 * @param {string} text
 * @returns {{ variant: 'bullets' | 'numbers', text: string } | null}
 */
export function splitListMarker(text) {
  const match = MARKER_PATTERN.exec(text);
  if (!match) return null;
  return {
    variant: match[3] ? 'numbers' : 'bullets',
    text: normalizeText(text.slice(match[0].length)),
  };
}

/**
 * The list variant a bare marker (a `Lbl` text) stands for, or null when the
 * text is not a marker. An empty label (a bullet drawn as a path) is bullets.
 *
 * @param {string} text
 * @returns {'bullets' | 'numbers' | null}
 */
export function markerVariant(text) {
  const t = normalizeText(text);
  if (!t) return 'bullets';
  if (!BARE_MARKER_PATTERN.test(t)) return null;
  return /^[\p{L}\d]/u.test(t) ? 'numbers' : 'bullets';
}

const HEADING_TOP_FRACTION = 0.5;
const HEADING_SIZE_RATIO = 1.2;
const HEADING_MAX_LINES = 2;
const PARAGRAPH_GAP_EM = 1.6;
const SIZE_CHANGE_RATIO = 0.15;

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const closeSize = (a, b) =>
  Math.abs(a - b) <= SIZE_CHANGE_RATIO * Math.max(a, b);

const followsClosely = (prev, line) =>
  line.y - prev.y <= PARAGRAPH_GAP_EM * Math.max(prev.size, line.size);

/**
 * Indices of the heading lines by size and position, or [] for none.
 *
 * @param {Array<import('./lines.js').Line>} lines - in reading order
 * @param {{ height: number }} page
 * @returns {number[]}
 */
export function findHeadingLines(lines, { height }) {
  if (!lines.length) return [];
  const maxSize = Math.max(...lines.map((l) => l.size));
  const isMax = (l) => l.size >= maxSize - 0.5;
  const first = lines.findIndex(isMax);
  const picked = [first];
  for (let i = first + 1; i < lines.length && isMax(lines[i]); i++) {
    if (!followsClosely(lines[i - 1], lines[i])) break;
    picked.push(i);
  }
  if (picked.length > HEADING_MAX_LINES) return [];
  if (lines.filter(isMax).length > picked.length) return [];
  if (lines[first].y > HEADING_TOP_FRACTION * height) return [];
  const rest = lines.filter((_, i) => !picked.includes(i));
  if (
    rest.length &&
    maxSize < HEADING_SIZE_RATIO * median(rest.map((l) => l.size))
  ) {
    return [];
  }
  return picked;
}

const ALIGN_TOLERANCE_EM = 0.5;

/** How many columns of `row` line up (left or right edge) with `prev`. */
function sharedColumns(prev, row) {
  const tolerance = ALIGN_TOLERANCE_EM * Math.max(prev.size, row.size);
  let shared = 0;
  for (const seg of row.segments) {
    const hit = prev.segments.some(
      (p) =>
        Math.abs(p.x - seg.x) <= tolerance ||
        Math.abs(p.x + p.width - (seg.x + seg.width)) <= tolerance,
    );
    if (hit) shared += 1;
  }
  return shared;
}

/** Index ranges [start, end) of lines that form an aligned table. */
function findTables(lines, skip) {
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    if (skip.has(i) || lines[i].segments.length < 2) {
      i += 1;
      continue;
    }
    let end = i + 1;
    while (
      end < lines.length &&
      !skip.has(end) &&
      lines[end].segments.length >= 2 &&
      sharedColumns(lines[end - 1], lines[end]) >= 2
    ) {
      end += 1;
    }
    if (end - i >= 2) tables.push([i, end]);
    i = end;
  }
  return tables;
}

/**
 * Detect heading and blocks on assembled lines.
 *
 * @param {Array<import('./lines.js').Line>} lines - in reading order
 * @param {{ width: number, height: number }} page
 * @param {object} [opts]
 * @param {boolean} [opts.heading=true] - look for a heading at all
 * @param {Set<number>} [opts.exclude] - line indices that are not body text
 *   (drawing labels); they get no block and keep the role they have
 * @returns {{ heading: string | null, roles: Array<string | null>, blocks: object[] }}
 */
export function detectGeometry(
  lines,
  page,
  { heading = true, exclude = new Set() } = {},
) {
  const roles = lines.map((_, i) => (exclude.has(i) ? 'label' : null));
  const bodyIdx = lines.map((_, i) => i).filter((i) => !exclude.has(i));
  const headingIdx = heading
    ? findHeadingLines(
        bodyIdx.map((i) => lines[i]),
        page,
      ).map((k) => bodyIdx[k])
    : [];
  for (const i of headingIdx) roles[i] = 'heading';
  const skip = new Set([...exclude, ...headingIdx]);

  const markers = lines.map((l, i) =>
    skip.has(i) ? null : splitListMarker(l.text),
  );
  const markerIdx = markers.flatMap((m, i) => (m ? [i] : []));
  const tableAt = new Map(findTables(lines, new Set([...skip, ...markerIdx])));

  const blocks = [];
  let list = null;
  let para = null;
  const closeAll = () => {
    list = null;
    para = null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const line = lines[i];
    if (tableAt.has(i)) {
      closeAll();
      const end = tableAt.get(i);
      const rows = lines.slice(i, end);
      for (let k = i; k < end; k++) roles[k] = 'table-cell';
      blocks.push({
        kind: 'table',
        y: line.y,
        headerRow: rows[0].bold && rows.slice(1).every((r) => !r.bold),
        rows: rows.map((r) => r.segments.map((s) => s.text)),
      });
      i = end - 1;
      continue;
    }
    const marker = markers[i];
    if (marker) {
      para = null;
      if (!list || !followsClosely(list.last, line)) {
        list = { kind: 'list', y: line.y, variant: marker.variant, items: [] };
        blocks.push(list);
      }
      list.items.push({ text: marker.text, parts: [marker.text], first: line });
      list.last = line;
      roles[i] = 'list-item';
      continue;
    }
    const item = list?.items.at(-1);
    if (
      item &&
      followsClosely(list.last, line) &&
      line.x > item.first.x + 0.3 * item.first.size &&
      closeSize(line.size, item.first.size)
    ) {
      item.text = normalizeText(`${item.text} ${line.text}`);
      item.parts = [item.text];
      list.last = line;
      roles[i] = 'list-item';
      continue;
    }
    list = null;
    if (
      para &&
      followsClosely(para.last, line) &&
      closeSize(para.last.size, line.size)
    ) {
      para.lines.push(line);
    } else {
      para = { kind: 'para', y: line.y, lines: [line], last: line };
      blocks.push(para);
    }
    para.last = line;
    roles[i] = 'para';
  }

  return {
    heading: headingIdx.length
      ? joinLineText(headingIdx.map((i) => lines[i]))
      : null,
    roles,
    blocks: blocks.map(finishBlock),
  };
}

function finishBlock(block) {
  if (block.kind === 'para') {
    return {
      kind: 'para',
      y: block.y,
      text: joinLineText(block.lines),
      bold: block.lines.every((l) => l.bold),
      size: Math.max(...block.lines.map((l) => l.size)),
    };
  }
  if (block.kind === 'list') {
    return {
      kind: 'list',
      y: block.y,
      variant: block.variant,
      items: block.items.map(({ text, parts }) => ({ text, parts })),
    };
  }
  return block;
}

/** Pages with fewer paths than this have no drawing to label. */
export const DRAWING_MIN_PATHS = 20;

/** A short line is a label when this many path boxes lie within 1 em. */
const LABEL_NEAR_PATHS = 3;
const LABEL_MAX_CHARS = 40;

/**
 * Indices of lines that read as labels of a vector drawing (chart axes,
 * diagram captions): short lines with several drawn paths right around them,
 * on a page that draws at least `DRAWING_MIN_PATHS` paths. Full-page paths
 * (backgrounds) are ignored. A deliberately simple rule: it only has to tell
 * B752 that a page's text belongs to a picture.
 *
 * @param {Array<import('./lines.js').Line>} lines
 * @param {{ paths: number, boxes: Array<{ x: number, y: number, width: number, height: number }> }} drawing
 * @returns {Set<number>}
 */
export function findDrawingLabels(lines, { paths, boxes }) {
  const labels = new Set();
  if (paths < DRAWING_MIN_PATHS) return labels;
  lines.forEach((line, i) => {
    if (line.text.length > LABEL_MAX_CHARS) return;
    const pad = line.size;
    const left = line.x - pad;
    const right = line.x + line.width + pad;
    const top = line.y - line.size - pad;
    const bottom = line.y + pad;
    const near = boxes.filter(
      (b) =>
        b.x <= right &&
        b.x + b.width >= left &&
        b.y <= bottom &&
        b.y + b.height >= top,
    ).length;
    if (near >= LABEL_NEAR_PATHS) labels.add(i);
  });
  return labels;
}
