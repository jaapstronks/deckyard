/**
 * Text columns on an untagged page (B777).
 *
 * `assembleLines()` reads a page top to bottom. On a page set in two
 * columns that interleaves them: the left column's line at y 117 comes
 * between the right column's lines at 114 and 125, and where two lines of
 * the columns share a baseline they become one line ("operations and
 * business of Philips … Use of non-IFRS information", whose 11pt half made
 * the whole line a heading). This module finds the columns and puts the
 * lines in column order: a column read top to bottom, then the next.
 *
 * A column boundary is a **gutter**: a vertical strip at least
 * {@link GUTTER_MIN_EM} wide where the text thins out, whose emptiest part
 * (at least a word gap wide) no line crosses over a stretch of consecutive
 * lines (a **band**; a heading set across both columns ends it). A band is set in columns when both sides hold at least
 * {@link MIN_COLUMN_LINES} lines and either
 *
 * - each side mostly keeps its own baselines (a line on one side has no
 *   partner on the other), the way two independently set columns do, or
 * - where both sides share a baseline, mostly running text stands on each
 *   side (lines of {@link PROSE_MIN_WORDS} words or more): columns whose
 *   baselines happen to coincide.
 *
 * A table fails both: its rows put a cell on each side of every gap at one
 * baseline, and a value or a term beside a cell is no running text. A definition table
 * whose description wraps fails too, because its term side has no line of
 * its own. Columns can nest (three columns are a split inside a split).
 *
 * The text is untouched: a line that held both columns is rebuilt from its
 * own runs per side. A page without columns comes back as the same lines.
 */

import { assembleLines, SEGMENT_GAP_EM } from './lines.js';

/** A gutter is at least this many em of the body size wide. */
export const GUTTER_MIN_EM = 1.5;

/** Each column of a band holds at least this many lines. */
export const MIN_COLUMN_LINES = 3;

/** A line of at least this many words is running text. */
export const PROSE_MIN_WORDS = 4;

/** Lines further apart than this many em are not set together. */
const PARAGRAPH_GAP_EM = 1.6;

/** Columns inside columns go no deeper than this. */
const MAX_DEPTH = 3;

/**
 * Assemble runs into lines in reading order, column by column.
 *
 * @param {Array<import('./text-runs.js').TextRun>} runs
 * @returns {Array<import('./lines.js').Line>}
 */
export function assembleColumnLines(runs) {
  const lines = assembleLines(runs);
  const blank = runs.filter((r) => !/\S/.test(r.str));
  return orderColumns(lines, blank, 0);
}

function orderColumns(lines, blank, depth) {
  if (depth >= MAX_DEPTH || lines.length < 2 * MIN_COLUMN_LINES) return lines;
  const em = bodySize(lines);
  for (const gutter of gutters(lines, em)) {
    const bands = bandsAt(lines, gutter, em);
    if (!bands.some((band) => band.columns)) continue;
    return bands.flatMap((band) => {
      if (!band.columns) return orderColumns(band.lines, blank, depth + 1);
      return splitBand(band.lines, gutter, blank, em).flatMap((side) =>
        orderColumns(side, blank, depth + 1),
      );
    });
  }
  return lines;
}

/** The size that carries most of the characters. */
function bodySize(lines) {
  const chars = new Map();
  for (const line of lines) {
    const size = Math.round(line.size * 2) / 2;
    chars.set(size, (chars.get(size) || 0) + line.text.length);
  }
  let best = 0;
  for (const [size, count] of chars)
    if (count > (chars.get(best) || 0)) best = size;
  return best;
}

const crosses = (line, { from, to }) =>
  line.segments.some((s) => s.x < to && s.x + s.width > from);

/**
 * Candidate gutters, widest strip first. A strip is at least
 * {@link GUTTER_MIN_EM} wide, has text on both sides and is covered by at
 * most a third as many lines as the densest stretch of the page; the gutter
 * is its emptiest part. Which lines cross the gutter decides the bands.
 */
function gutters(lines, em) {
  const left = Math.min(...lines.map((l) => l.x));
  const right = Math.max(...lines.map((l) => l.x + l.width));
  const step = 0.5;
  const bins = Math.ceil((right - left) / step);
  const cover = new Array(bins).fill(0);
  for (const line of lines) {
    for (const s of line.segments) {
      const a = Math.max(0, Math.floor((s.x - left) / step));
      const b = Math.min(bins, Math.ceil((s.x + s.width - left) / step));
      for (let i = a; i < b; i++) cover[i] += 1;
    }
  }
  // A strip is open where the text is thin next to the densest stretch:
  // a heading or an intro set across the columns may cross it.
  const allowed = Math.floor(Math.max(...cover) / 3);
  const found = [];
  for (const [a, b] of runsOf(cover, (c) => c <= allowed)) {
    if (a === 0 || b === bins || (b - a) * step < GUTTER_MIN_EM * em) continue;
    // The gutter proper is the emptiest part of the strip: the lines of a
    // ragged column edge reach into the strip without crossing it, and
    // an author line split around the gutter stops short of its middle.
    const least = Math.min(...cover.slice(a, b));
    const [from, to] = runsOf(cover.slice(a, b), (c) => c === least)
      .map(([x, y]) => [left + (a + x) * step, left + (a + y) * step])
      .reduce((p, q) => (q[1] - q[0] > p[1] - p[0] ? q : p));
    if (to - from >= SEGMENT_GAP_EM * em)
      found.push({ from, to, width: (b - a) * step });
  }
  return found.sort((a, b) => b.width - a.width);
}

/** Index ranges [start, end) where `test` holds for every value. */
function runsOf(values, test) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= values.length; i++) {
    const hit = i < values.length && test(values[i]);
    if (hit && start < 0) start = i;
    if (!hit && start >= 0) {
      runs.push([start, i]);
      start = -1;
    }
  }
  return runs;
}

/**
 * The page cut into bands at a gutter: runs of consecutive lines that do
 * not cross it, and the lines in between that do. A band is in columns
 * when its two sides read as columns.
 *
 * A line with text on both sides set right under or above a crossing line
 * belongs with it, not with the columns: the e-mail addresses under a row
 * of author names, a second title line split around the gutter.
 */
function bandsAt(lines, gutter, em) {
  const bands = [];
  let current = null;
  for (const line of lines) {
    const free = !crosses(line, gutter);
    if (!current || current.free !== free) {
      current = { free, lines: [] };
      bands.push(current);
    }
    current.lines.push(line);
  }
  const close = (a, b) => Math.abs(b.y - a.y) <= PARAGRAPH_GAP_EM * em;
  const bothSides = (line) =>
    line.segments.some((s) => s.x + s.width <= gutter.from) &&
    line.segments.some((s) => s.x >= gutter.to);
  bands.forEach((band, i) => {
    if (!band.free) return;
    const before = bands[i - 1];
    const after = bands[i + 1];
    while (
      before &&
      band.lines.length &&
      bothSides(band.lines[0]) &&
      close(before.lines.at(-1), band.lines[0])
    )
      before.lines.push(band.lines.shift());
    while (
      after &&
      band.lines.length &&
      bothSides(band.lines.at(-1)) &&
      close(band.lines.at(-1), after.lines[0])
    )
      after.lines.unshift(band.lines.pop());
  });
  return bands
    .filter((band) => band.lines.length)
    .map(({ free, lines: group }) => ({
      lines: group,
      columns: free && readsAsColumns(group, gutter),
    }));
}

const words = (text) => text.split(/\s+/).filter(Boolean).length;

function readsAsColumns(lines, gutter) {
  const text = (segs) => segs.map((s) => s.text).join(' ');
  let left = 0;
  let right = 0;
  let leftOnly = 0;
  let rightOnly = 0;
  let shared = 0;
  let sharedProse = 0;
  for (const line of lines) {
    const l = line.segments.filter((s) => s.x + s.width <= gutter.from);
    const r = line.segments.filter((s) => s.x >= gutter.to);
    if (l.length) left += 1;
    if (r.length) right += 1;
    if (l.length && !r.length) leftOnly += 1;
    if (r.length && !l.length) rightOnly += 1;
    if (l.length && r.length) {
      shared += 1;
      if (
        words(text(l)) >= PROSE_MIN_WORDS &&
        words(text(r)) >= PROSE_MIN_WORDS
      )
        sharedProse += 1;
    }
  }
  if (left < MIN_COLUMN_LINES || right < MIN_COLUMN_LINES) return false;
  const ownBaselines = leftOnly * 2 >= left && rightOnly * 2 >= right;
  // Where the baselines coincide, a line of running text stands on each side.
  const coinciding = shared >= MIN_COLUMN_LINES && sharedProse * 2 >= shared;
  return ownBaselines || coinciding;
}

/**
 * The lines of a band per side of the gutter, each side rebuilt from its
 * own runs (and the spaces between them) so a shared baseline splits.
 */
function splitBand(lines, gutter, blank, em) {
  const mid = (gutter.from + gutter.to) / 2;
  const top = Math.min(...lines.map((l) => l.y)) - em;
  const bottom = Math.max(...lines.map((l) => l.y)) + em;
  const spaces = blank.filter((r) => r.y >= top && r.y <= bottom);
  const visible = lines.flatMap((l) => l.runs);
  const onLeft = (r) => r.x + r.width / 2 < mid;
  return [
    assembleLines([...visible, ...spaces].filter(onLeft)),
    assembleLines([...visible, ...spaces].filter((r) => !onLeft(r))),
  ];
}
