/**
 * Rectangles on a page (B827): origin top-left, y down, page units.
 *
 * A line carries a baseline and a font size; a block, a table or a drawing
 * is the union of what it holds. The arithmetic the page model's `box`
 * fields share lives here, so no detector keeps a private copy of it.
 */

/** @typedef {{ x: number, y: number, width: number, height: number }} Box */

/** A line's box reaches this many em above its baseline ... */
export const LINE_ASCENT_EM = 1;

/** ... and this many em below it (descenders). */
export const LINE_DESCENT_EM = 0.2;

/**
 * The box of a line of text, from its baseline and font size.
 *
 * @param {{ x: number, y: number, width: number, size: number }} line
 * @returns {Box}
 */
export function lineBox({ x, y, width, size }) {
  return {
    x,
    y: y - LINE_ASCENT_EM * size,
    width,
    height: (LINE_ASCENT_EM + LINE_DESCENT_EM) * size,
  };
}

/** @param {Box} box */
export function boxArea(box) {
  return box.width * box.height;
}

/**
 * The area two boxes share; 0 when they do not touch.
 *
 * @param {Box} a
 * @param {Box} b
 * @returns {number}
 */
export function overlapArea(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? (right - x) * (bottom - y) : 0;
}

/**
 * The smallest box around all of `boxes`; null for none.
 *
 * @param {Box[]} boxes
 * @returns {Box | null}
 */
export function unionBoxes(boxes) {
  if (!boxes.length) return null;
  let x = Infinity;
  let y = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const b of boxes) {
    x = Math.min(x, b.x);
    y = Math.min(y, b.y);
    right = Math.max(right, b.x + b.width);
    bottom = Math.max(bottom, b.y + b.height);
  }
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The box widened by `by` on every side.
 *
 * @param {Box} box
 * @param {number} by
 * @returns {Box}
 */
export function growBox(box, by) {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + 2 * by,
    height: box.height + 2 * by,
  };
}

/**
 * Whether at least `fraction` of `box`'s area lies inside `within`.
 *
 * @param {Box} box
 * @param {Box} within
 * @param {number} fraction - 0..1
 * @returns {boolean}
 */
export function liesWithin(box, within, fraction) {
  const area = boxArea(box);
  return area > 0
    ? overlapArea(box, within) >= fraction * area
    : overlapArea(growBox(box, 0.5), within) > 0;
}
