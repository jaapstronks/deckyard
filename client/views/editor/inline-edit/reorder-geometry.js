/**
 * Pure geometry for inline card reorder (no DOM access): map a pointer
 * position over one repeatable-items level to an insertion gap, and describe
 * the drop-indicator line for that gap.
 *
 * Works for horizontal rows, vertical stacks and wrapping grids alike. Every
 * item contributes two gap candidates - "before me" (its leading edge) and
 * "after me" (its trailing edge) - oriented per neighbouring pair, and the
 * pointer snaps to the nearest candidate. At a grid row-break the
 * "after last of row k" and "before first of row k+1" candidates carry the
 * same insertion index, so wrapping needs no special casing.
 *
 * Rects and points are expected in the same coordinate space (the unscaled
 * thumb, like the rest of the overlay layer).
 */

/** @typedef {{left:number, top:number, width:number, height:number}} Rect */
/**
 * @typedef {Object} GapCandidate
 * @property {number} index - insertion index into the array (0..length)
 * @property {number} x - anchor point the pointer snaps to
 * @property {number} y
 * @property {{x:number, y:number, length:number, orientation:'v'|'h'}} line
 *   zero-thickness indicator segment (top-left origin at x/y)
 */

function centerOf(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Whether two neighbouring rects read as side-by-side (true) or stacked
 * (false), by comparing per-axis center distance.
 * @param {Rect} a
 * @param {Rect} b
 */
function isHorizontalPair(a, b) {
  const ca = centerOf(a);
  const cb = centerOf(b);
  return Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y);
}

/**
 * An edge candidate for rect `r`: `side` is 'leading' or 'trailing' along the
 * given arrangement axis.
 * @param {Rect} r
 * @param {boolean} horizontal - items arranged side by side
 * @param {'leading'|'trailing'} side
 * @param {number} index - insertion index this edge represents
 * @returns {GapCandidate}
 */
function edgeCandidate(r, horizontal, side, index) {
  if (horizontal) {
    const x = side === 'leading' ? r.left : r.left + r.width;
    return {
      index,
      x,
      y: r.top + r.height / 2,
      line: { x, y: r.top, length: r.height, orientation: 'v' },
    };
  }
  const y = side === 'leading' ? r.top : r.top + r.height;
  return {
    index,
    x: r.left + r.width / 2,
    y,
    line: { x: r.left, y, length: r.width, orientation: 'h' },
  };
}

/**
 * All insertion-gap candidates for the level. Gap index g inserts before item
 * g (g === rects.length appends). Items must be ordered by item index.
 * @param {Rect[]} rects
 * @returns {GapCandidate[]}
 */
export function gapCandidates(rects) {
  const out = [];
  const dist2 = (a, b) => {
    const ca = centerOf(a);
    const cb = centerOf(b);
    return (cb.x - ca.x) ** 2 + (cb.y - ca.y) ** 2;
  };
  for (let i = 0; i < rects.length; i += 1) {
    // Orient each item's edges by its NEAREST index-neighbour: at a grid
    // row-break the next item sits on another row, but the previous one is
    // the true same-row buddy (and vice versa), so nearest wins.
    const prev = rects[i - 1];
    const next = rects[i + 1];
    const buddy =
      prev && next
        ? (dist2(rects[i], prev) <= dist2(rects[i], next) ? prev : next)
        : prev || next;
    const horizontal = buddy ? isHorizontalPair(rects[i], buddy) : rects[i].width < rects[i].height;
    out.push(edgeCandidate(rects[i], horizontal, 'leading', i));
    out.push(edgeCandidate(rects[i], horizontal, 'trailing', i + 1));
  }
  return out;
}

/**
 * The insertion gap nearest to `point`.
 * @param {Rect[]} rects - item rects ordered by item index (>= 2)
 * @param {{x:number, y:number}} point
 * @returns {GapCandidate|null}
 */
export function computeDrop(rects, point) {
  let best = null;
  let bestDist = Infinity;
  for (const c of gapCandidates(rects)) {
    const dx = c.x - point.x;
    const dy = c.y - point.y;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best;
}

/**
 * Translate an insertion index (gap) into the target array index for a move
 * of the item at `from`. Returns `from` itself for the two no-op gaps
 * directly around the dragged item.
 * @param {number} from
 * @param {number} insertionIndex
 */
export function resolveMove(from, insertionIndex) {
  return insertionIndex > from ? insertionIndex - 1 : insertionIndex;
}
