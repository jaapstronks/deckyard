/**
 * Paragraphs of a PowerPoint text body, with style and place (B828).
 *
 * Unlike a PDF, a PowerPoint paragraph is whole: one `a:p`, its runs in
 * order, no words split over runs that need joining by position. What it
 * does not carry on its own is its look: size, weight, colour, bullet and
 * indent come from the first of the run, the paragraph, the shape's list
 * style, the placeholders it inherits from and the master's text style that
 * says anything. This module reads that chain per paragraph and estimates
 * where the paragraph stands in its shape.
 *
 * The text is literal (1a-beslissing 3): runs joined as written, a line
 * break as a space, whitespace collapsed by `normalizeText` like the PDF
 * lines are. A slide-number or date field is not content: its text goes to
 * `dropped` as an artifact, as the PDF route keeps footer and page number
 * off the slide.
 *
 * Where it stands is an estimate: PowerPoint does not store where it
 * wrapped. A paragraph's width is its character count at
 * {@link AVERAGE_CHAR_EM} of its size, capped at the room in the shape, and
 * its height the number of lines that gives. Good enough for what the model
 * uses boxes for (columns, the heading's place, overlap with a drawing);
 * no detector reads a PowerPoint line's exact width.
 */

import { normalizeText } from '../pdf-extract/index.js';
import { EMU_PER_PT } from './package.js';
import { fillColor, schemeColor } from './colors.js';
import { boolAttr, child, childrenNamed, numAttr, path } from './xml.js';

/** The average width of a character, in em, for the width estimate. */
export const AVERAGE_CHAR_EM = 0.5;

/** Single line spacing is this many em, as PowerPoint sets text. */
export const LINE_HEIGHT_EM = 1.2;

/** PowerPoint's default text size (`sz` 1800), in pt. */
export const DEFAULT_SIZE_PT = 18;

/** The default insets of a text body (`lIns`, `tIns`, `rIns`, `bIns`), in EMU. */
const DEFAULT_INSETS = { l: 91440, t: 45720, r: 91440, b: 45720 };

/** Fields whose text is furniture, not content. */
const FURNITURE_FIELD = /^(slidenum|datetime\d*)$/;

/**
 * @typedef {object} Paragraph
 * @property {string} text - literal, whitespace collapsed
 * @property {number} level - 0-based (`lvl`)
 * @property {'bullets' | 'numbers' | null} bullet
 * @property {number} size - the largest run size, in pt
 * @property {boolean} bold - every run is bold
 * @property {string | null} color - `#rrggbb` of the largest run
 * @property {string[]} fields - the text of furniture fields in it
 * @property {import('./xml.js').XmlElement[]} props - the paragraph
 *   properties in force, nearest first (`placeParagraphs` reads them)
 */

/**
 * The style context of one text body.
 *
 * @typedef {object} TextStyle
 * @property {import('./xml.js').XmlElement[]} lists - `a:lstStyle` or master
 *   text-style elements, nearest first
 * @property {import('./colors.js').ColorContext} colors
 * @property {string | null} [fontColor] - the shape style's font colour
 *   (`p:style/a:fontRef`), used when no list style names a colour
 * @property {number} [fontScale] - `normAutofit` shrink, 1 for none
 */

/**
 * Read the paragraphs of a text body.
 *
 * @param {import('./xml.js').XmlElement | null} txBody - `p:txBody` or
 *   `a:txBody`
 * @param {TextStyle} style
 * @returns {Paragraph[]} every paragraph, empty ones included (they still
 *   take up a line)
 */
export function readParagraphs(txBody, style) {
  return childrenNamed(txBody, 'a:p').map((p) => readParagraph(p, style));
}

function readParagraph(p, style) {
  const pPr = child(p, 'a:pPr');
  const level = Math.min(8, Math.max(0, numAttr(pPr, 'lvl', 0)));
  const levelProps = [
    pPr,
    ...style.lists.map((list) => child(list, `a:lvl${level + 1}pPr`)),
  ].filter(Boolean);
  const defaults = levelProps
    .map((el) => (el === pPr ? null : child(el, 'a:defRPr')))
    .filter(Boolean);

  let text = '';
  const fields = [];
  const runs = [];
  for (const node of p.children) {
    if (node.name === 'a:br') text += ' ';
    else if (node.name === 'a:r' || node.name === 'a:fld') {
      const value = child(node, 'a:t')?.text || '';
      if (node.name === 'a:fld' && FURNITURE_FIELD.test(node.attrs.type)) {
        if (value.trim()) fields.push(normalizeText(value));
        continue;
      }
      text += value;
      if (value.trim())
        runs.push(runStyle(child(node, 'a:rPr'), defaults, style));
    }
  }
  const largest = runs.reduce((a, b) => (b.size > a.size ? b : a), {
    size: 0,
    color: null,
  });
  const fallback = runStyle(null, defaults, style);
  return {
    text: normalizeText(text),
    level,
    bullet: bulletOf(levelProps),
    size: runs.length ? largest.size : fallback.size,
    bold: runs.length > 0 && runs.every((r) => r.bold),
    color: runs.length ? largest.color : fallback.color,
    fields,
    props: levelProps,
  };
}

function runStyle(rPr, defaults, style) {
  const chain = [rPr, ...defaults].filter(Boolean);
  const first = (pick) => {
    for (const el of chain) {
      const value = pick(el);
      if (value !== undefined && value !== null) return value;
    }
    return undefined;
  };
  const sz = first((el) => numAttr(el, 'sz'));
  const fill = first((el) => {
    const color = fillColor(el, style.colors);
    return color && color !== 'none' ? color : undefined;
  });
  return {
    size: ((sz ?? DEFAULT_SIZE_PT * 100) / 100) * (style.fontScale ?? 1),
    bold: first((el) => boolAttr(el, 'b')) ?? false,
    color: fill || style.fontColor || schemeColor('tx1', style.colors),
  };
}

/** The bullet in force: the nearest level that says anything about it. */
function bulletOf(levelProps) {
  for (const el of levelProps) {
    if (child(el, 'a:buNone')) return null;
    if (child(el, 'a:buAutoNum')) return 'numbers';
    if (child(el, 'a:buChar') || child(el, 'a:buBlip')) return 'bullets';
  }
  return null;
}

/**
 * A paragraph placed on the page: its first baseline, left edge, estimated
 * width and its estimated box.
 *
 * @typedef {Omit<Paragraph, 'props'> & { x: number, y: number, width: number, box: import('../pdf-extract/index.js').Box }} PlacedParagraph
 */

/**
 * Place the paragraphs of one text body in its box: stacked from the top
 * inset, shifted down for a centred or bottom-anchored body, each indented
 * by its margin and aligned within the room left.
 *
 * @param {Paragraph[]} paragraphs
 * @param {import('../pdf-extract/index.js').Box} box - the shape's box, pt
 * @param {import('./xml.js').XmlElement[]} bodyProps - `a:bodyPr` chain,
 *   nearest first
 * @returns {PlacedParagraph[]}
 */
export function placeParagraphs(paragraphs, box, bodyProps) {
  const inset = (key, attr) =>
    (bodyProps.map((b) => numAttr(b, attr)).find((v) => v !== undefined) ??
      DEFAULT_INSETS[key]) / EMU_PER_PT;
  const left = box.x + inset('l', 'lIns');
  const top = box.y + inset('t', 'tIns');
  const room = Math.max(1, box.width - inset('l', 'lIns') - inset('r', 'rIns'));
  const inner = box.height - inset('t', 'tIns') - inset('b', 'bIns');
  const anchor = bodyProps.map((b) => b.attrs.anchor).find(Boolean) || 't';

  let cursor = 0;
  const placed = paragraphs.map((para) => {
    const prop = (pick) =>
      para.props.map(pick).find((v) => v !== undefined && v !== null);
    const marL = (prop((el) => numAttr(el, 'marL')) ?? 0) / EMU_PER_PT;
    const avail = Math.max(1, room - marL);
    const natural = para.text.length * AVERAGE_CHAR_EM * para.size;
    const width = Math.min(natural, avail);
    const lines = Math.max(1, Math.ceil(natural / avail));
    const spacing = lineSpacing(prop((el) => child(el, 'a:lnSpc')));
    const before = points(
      prop((el) => child(el, 'a:spcBef')),
      para.size,
    );
    const height = lines * para.size * LINE_HEIGHT_EM * spacing;
    const align = prop((el) => el.attrs.algn) || 'l';
    const shift =
      align === 'ctr' ? (avail - width) / 2 : align === 'r' ? avail - width : 0;
    const paraTop = cursor + (cursor > 0 ? before : 0);
    cursor = paraTop + height;
    return { ...para, x: left + marL + shift, width, top: paraTop, height };
  });
  const offset =
    anchor === 'ctr'
      ? Math.max(0, (inner - cursor) / 2)
      : anchor === 'b'
        ? Math.max(0, inner - cursor)
        : 0;
  return placed.map(({ top: paraTop, height, props, ...para }) => {
    const y = top + offset + paraTop;
    return {
      ...para,
      y: y + para.size,
      box: { x: para.x, y, width: para.width, height },
    };
  });
}

/** `a:lnSpc` as a factor of single spacing (`spcPct`) or of the size. */
function lineSpacing(lnSpc) {
  const pct = numAttr(path(lnSpc, 'a:spcPct'), 'val');
  return pct !== undefined ? pct / 100000 : 1;
}

/** `a:spcBef`/`a:spcAft` in pt: `spcPts` in hundredths, `spcPct` of the size. */
function points(spacing, size) {
  const pts = numAttr(path(spacing, 'a:spcPts'), 'val');
  if (pts !== undefined) return pts / 100;
  const pct = numAttr(path(spacing, 'a:spcPct'), 'val');
  return pct !== undefined ? (pct / 100000) * size : 0;
}
