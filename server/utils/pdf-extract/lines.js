/**
 * Text runs → lines (B751).
 *
 * PDF producers break runs anywhere: mid-word ("Fourth" + " quarter",
 * ", 202" + "5"), around a ligature ("begr" + "ĳ" + "pen"), and within a line
 * not always in reading order. This module puts them back together, and that
 * is all it may do with the text (the import's literalness rule): runs on the
 * same baseline form a line, sorted by x; a space goes in only where the gap
 * between two runs is wider than a fraction of the font size; whitespace is
 * collapsed. No case changes, no hyphen handling, no other rewriting.
 */

/** Runs whose baselines differ by at most this many em share a line. */
export const BASELINE_TOLERANCE_EM = 0.3;

/** A horizontal gap wider than this many em between two runs is a space. */
export const SPACE_GAP_EM = 0.2;

/**
 * A gap wider than this many em splits a line into segments: table cells,
 * a label and its tab-leader page number, two columns on one baseline. The
 * line text still joins the segments with one space.
 */
export const SEGMENT_GAP_EM = 0.8;

/**
 * Collapse whitespace runs to one space and trim. Nothing else changes.
 *
 * @param {string} text
 * @returns {string}
 */
export function normalizeText(text) {
  return String(text).replace(/\s+/g, ' ').trim();
}

/**
 * @typedef {object} LineSegment
 * @property {string} text
 * @property {number} x
 * @property {number} width
 * @property {boolean} bold
 */

/**
 * @typedef {object} Line
 * @property {string} text - the segments joined by one space
 * @property {number} x - left edge of the first run
 * @property {number} y - baseline of the line's largest run, from the top
 * @property {number} width
 * @property {number} size - the largest font size on the line
 * @property {boolean} bold - every visible run on the line is bold
 * @property {LineSegment[]} segments
 * @property {string[]} mcids - marked-content ids of the runs, in x order
 * @property {Array<import('./text-runs.js').TextRun>} runs
 */

const isBlank = (str) => !/\S/.test(str);

/**
 * Assemble runs into lines, in reading order (top to bottom, then left to
 * right). Whitespace-only runs never start a line or widen one; they only
 * count as a space between the runs around them.
 *
 * @param {Array<import('./text-runs.js').TextRun>} runs
 * @returns {Line[]}
 */
export function assembleLines(runs) {
  const visible = runs.filter((r) => !isBlank(r.str));
  const blank = runs.filter((r) => isBlank(r.str));
  const groups = [];
  for (const run of [...visible].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const group = nearestGroup(groups, run);
    if (group) group.runs.push(run);
    else
      groups.push({ anchor: run.y, size: run.size, runs: [run], spacers: [] });
  }
  for (const run of blank) nearestGroup(groups, run)?.spacers.push(run);
  return groups
    .map(buildLine)
    .filter((line) => line.text)
    .sort((a, b) => a.y - b.y || a.x - b.x);
}

function nearestGroup(groups, run) {
  let best = null;
  let bestDistance = Infinity;
  for (const group of groups) {
    const tolerance = BASELINE_TOLERANCE_EM * Math.max(group.size, run.size);
    const distance = Math.abs(group.anchor - run.y);
    if (distance <= tolerance && distance < bestDistance) {
      best = group;
      bestDistance = distance;
    }
  }
  return best;
}

function buildLine(group) {
  const ordered = [
    ...group.runs.map((run) => ({ run, spacer: false })),
    ...group.spacers.map((run) => ({ run, spacer: true })),
  ].sort((a, b) => a.run.x - b.run.x || Number(a.spacer) - Number(b.spacer));

  const segments = [];
  let current = null;
  let prevEnd = null;
  let pendingSpace = false;
  for (const { run, spacer } of ordered) {
    if (spacer) {
      pendingSpace = current !== null;
      continue;
    }
    const gap = prevEnd === null ? 0 : run.x - prevEnd;
    if (!current || gap > SEGMENT_GAP_EM * run.size) {
      current = { raw: '', x: run.x, end: run.x + run.width, bold: true };
      segments.push(current);
    } else if (
      (pendingSpace || gap > SPACE_GAP_EM * run.size) &&
      !/\s$/.test(current.raw) &&
      !/^\s/.test(run.str)
    ) {
      current.raw += ' ';
    }
    current.raw += run.str;
    current.end = Math.max(current.end, run.x + run.width);
    current.bold &&= run.bold;
    prevEnd = Math.max(prevEnd ?? -Infinity, run.x + run.width);
    pendingSpace = false;
  }

  const cleanSegments = segments
    .map((s) => ({
      text: normalizeText(s.raw),
      x: s.x,
      width: s.end - s.x,
      bold: s.bold,
    }))
    .filter((s) => s.text);
  const runsByX = ordered.filter((o) => !o.spacer).map((o) => o.run);
  const largest = runsByX.reduce((a, b) => (b.size > a.size ? b : a));
  const x = Math.min(...runsByX.map((r) => r.x));
  const end = Math.max(...runsByX.map((r) => r.x + r.width));
  return {
    text: cleanSegments.map((s) => s.text).join(' '),
    x,
    y: largest.y,
    width: end - x,
    size: largest.size,
    bold: runsByX.every((r) => r.bold),
    segments: cleanSegments,
    mcids: [...new Set(runsByX.map((r) => r.mcid).filter(Boolean))],
    runs: runsByX,
  };
}

/**
 * The text of a paragraph: its lines joined by one space.
 *
 * @param {Array<{ text: string }>} lines
 * @returns {string}
 */
export function joinLineText(lines) {
  return normalizeText(lines.map((l) => l.text).join(' '));
}
