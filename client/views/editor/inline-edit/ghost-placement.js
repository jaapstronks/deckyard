/**
 * Where a "+ <field>" ghost chip stands (B435, D212).
 *
 * A ghost chip marks an insertion point: "X lands here when you click". So
 * its place follows from where the field is inserted - the descriptor's
 * anchor + `pos` - and from the stacking direction of the block the field
 * lands in. It is never declared separately: the old per-anchor `chip` mode
 * was a second spelling of the same fact, and the two drifted apart (the
 * title-slide "+ Meta" chip sat on the title because `bottom-start` inside a
 * block that holds only the title IS the title).
 *
 * The seam lies perpendicular to the local stacking direction:
 *
 *   vertical stack (a text column)  -> a horizontal seam, chip under/over the
 *                                      neighbour, aligned like the column text
 *   horizontal stack (a row)        -> a vertical seam, chip beside the
 *                                      neighbour
 *
 * When the full chip at that seam would cover a text field or another chip,
 * it first slides along its seam (three empty fields that all insert after
 * one heading stand side by side), and when the seam has no room at all - it
 * lies between two filled fields - it shrinks to the compact variant: a small
 * round "+" in the margin at the seam, its label shown on hover and focus.
 * Images are not in the way: a caption is inserted onto its image. Repeatable items keep their own "+ Add" affordance
 * (cards); this module places single-field ghosts only.
 *
 * Two halves: `describeSeam()` reads the DOM (computed style, the
 * neighbour's rect) and `placeGhost()` is pure geometry over rects, so the
 * rule is testable without a browser (tests/inline-ghost-placement.test.js).
 */

/**
 * @typedef {{left:number, top:number, width:number, height:number}} Rect
 * @typedef {'vertical'|'horizontal'} Direction
 * @typedef {'after'|'before'|'inside'} Side
 * @typedef {'start'|'center'|'end'} Align
 * @typedef {{direction:Direction, side:Side, ref:HTMLElement,
 *   block:HTMLElement, align:Align}} Seam
 *   `ref` is the neighbour the seam borders, `block` the element the field is
 *   inserted into: the seam runs as long as the block, not the neighbour.
 */

/** Screen px between a chip and the neighbour it borders. */
export const SEAM_GAP = 6;

/**
 * The stacking direction of a block, from its computed layout: the axis the
 * next field inserted into it runs along. A flex row - wrapping or not - and
 * a grid with more than one column put it beside the last one (horizontal);
 * block flow, a flex column and a one-column grid put it underneath.
 * @param {Element} el
 * @returns {Direction}
 */
export function stackDirection(el) {
  const cs = el?.ownerDocument?.defaultView?.getComputedStyle?.(el);
  if (!cs) return 'vertical';
  const display = cs.display || '';
  if (display.includes('flex')) {
    return (cs.flexDirection || 'row').startsWith('row')
      ? 'horizontal'
      : 'vertical';
  }
  if (display.includes('grid')) {
    const tracks = (cs.gridTemplateColumns || '').trim().split(/\s+/);
    return tracks.length > 1 && tracks[0] !== 'none'
      ? 'horizontal'
      : 'vertical';
  }
  return 'vertical';
}

/** @param {Element} el */
function isRendered(el) {
  if (!el || el.classList?.contains('ie-ghost-input')) return false;
  const r = el.getBoundingClientRect?.();
  return !!r && (r.width > 0 || r.height > 0);
}

/** @param {Element} el @returns {Align} */
function textAlign(el) {
  const cs = el?.ownerDocument?.defaultView?.getComputedStyle?.(el);
  const a = cs?.textAlign || 'start';
  if (a === 'center') return 'center';
  if (a === 'right' || a === 'end') return 'end';
  return 'start';
}

/**
 * Turn a descriptor anchor (`el` + DOM insertion `pos`) into the seam the
 * field will occupy. `after`/`before` border the anchor itself inside its
 * parent; `append`/`prepend` border the last/first rendered child of the
 * anchor, or sit inside it when it has none.
 * @param {HTMLElement} el
 * @param {'after'|'before'|'append'|'prepend'} pos
 * @returns {Seam}
 */
export function describeSeam(el, pos) {
  if (pos === 'after' || pos === 'before') {
    const block = el.parentElement || el;
    return {
      direction: stackDirection(block),
      side: pos,
      ref: el,
      block,
      align: textAlign(el),
    };
  }
  const kids = [...(el.children || [])].filter(isRendered);
  const direction = stackDirection(el);
  if (!kids.length) {
    return {
      direction,
      side: 'inside',
      ref: el,
      block: el,
      align: textAlign(el),
    };
  }
  const ref = pos === 'prepend' ? kids[0] : kids[kids.length - 1];
  return {
    direction,
    side: pos === 'prepend' ? 'before' : 'after',
    ref,
    block: el,
    align: textAlign(ref),
  };
}

/** @param {Rect} a @param {Rect} b */
export function overlaps(a, b) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/** x of a box of width `w` aligned to `ref` by `align`. */
function alignX(ref, w, align) {
  if (align === 'center') return ref.left + ref.width / 2 - w / 2;
  if (align === 'end') return ref.left + ref.width - w;
  return ref.left;
}

/**
 * Positions along the seam, nearest to `at` first: a chip that finds its spot
 * taken slides along its own seam - never past its ends, where it would stand
 * beside the content instead of in it - before it gives up its label.
 * @param {number} at - the preferred coordinate
 * @param {number} step - distance between tries
 * @param {number} from - the lowest coordinate on the seam
 * @param {number} to - the highest coordinate on the seam
 */
function along(at, step, from, to) {
  const out = [at];
  for (let k = 1; k <= 24; k++) {
    if (at + k * step <= to) out.push(at + k * step);
    if (at - k * step >= from) out.push(at - k * step);
  }
  return out;
}

/**
 * The full chip at the seam (sliding along it), then the compact "+" in the
 * margin beside the seam, in order of preference. The seam is as long as the
 * block the field is inserted into.
 * @returns {Array<{rect:Rect, compact:boolean}>}
 */
function candidates({
  direction,
  side,
  ref,
  block,
  align,
  chip,
  compact,
  gap,
}) {
  const out = [];
  const push = (size, isCompact) => (left, top) =>
    out.push({
      rect: { left, top, width: size.width, height: size.height },
      compact: isCompact,
    });
  const full = push(chip, false);
  const small = push(compact, true);
  const bottom = ref.top + ref.height;
  const right = ref.left + ref.width;
  // The seam runs the length of the block the field is inserted into.
  const span = block || ref;
  const spanBottom = span.top + span.height;
  const spanRight = span.left + span.width;

  if (direction === 'horizontal' && side !== 'inside') {
    // A vertical seam beside ref: the chip stands in it, sliding down.
    const seamX = side === 'after' ? right + gap / 2 : ref.left - gap / 2;
    const fullX =
      side === 'after' ? seamX + gap / 2 : seamX - gap / 2 - chip.width;
    for (const y of along(ref.top, gap, span.top, spanBottom - chip.height)) {
      full(fullX, y);
    }
    const cx = seamX - compact.width / 2;
    const mid = ref.top + ref.height / 2 - compact.height / 2;
    small(cx, ref.top - compact.height - gap);
    for (const y of along(mid, gap, span.top, spanBottom - compact.height)) {
      small(cx, y);
    }
    return out;
  }

  // A horizontal seam under (after) / over (before) ref, or along the top of
  // the block (inside): the chip stands in it, sliding sideways.
  const top =
    side === 'after'
      ? bottom + gap
      : side === 'before'
        ? ref.top - gap - chip.height
        : ref.top + gap;
  const at = alignX(ref, chip.width, align);
  // Chips sharing the seam fill it like a line of text: along it first, then
  // on a next line away from ref (below after, above before).
  const lineStep = (side === 'before' ? -1 : 1) * (chip.height + gap);
  for (let line = 0; line < 3; line++) {
    for (const x of along(at, gap, span.left, spanRight - chip.width)) {
      full(x, top + line * lineStep);
    }
  }
  const seamY =
    side === 'after'
      ? bottom + gap / 2
      : side === 'before'
        ? ref.top - gap / 2
        : ref.top + gap + compact.height / 2;
  const cTop = seamY - compact.height / 2;
  // Compact in the margin: leading side, then trailing side, then further
  // out on both, so several empty fields that share one seam line up beside
  // the column instead of on it.
  for (let k = 0; k < 4; k++) {
    const step = k * (compact.width + gap);
    small(ref.left - compact.width - gap - step, cTop);
    small(right + gap + step, cTop);
  }
  return out;
}

/** Shift `r` the least distance that puts it inside `bounds`. */
function clampInto(r, bounds) {
  if (!bounds) return r;
  const maxLeft = bounds.left + bounds.width - r.width;
  const maxTop = bounds.top + bounds.height - r.height;
  return {
    ...r,
    left: Math.max(bounds.left, Math.min(r.left, maxLeft)),
    top: Math.max(bounds.top, Math.min(r.top, maxTop)),
  };
}

/**
 * Place one ghost chip at its seam without covering anything.
 *
 * The full chip stands at its aligned spot in the seam. When a text field is
 * there, the seam has no room (it lies between two filled fields) and the
 * chip goes compact in the margin beside the seam. When only other chips are
 * there, it slides along the seam first - chips that share a seam line up.
 * Every candidate is pulled inside `bounds` first, so a seam at the canvas
 * edge (a caption under a full-bleed image) keeps its chip on the canvas.
 * When every candidate collides, the first compact one is returned with
 * `collides: true`, so a caller or a test can see the seam had no room.
 *
 * @param {Object} o
 * @param {Direction} o.direction
 * @param {Side} o.side
 * @param {Rect} o.ref - the neighbour the seam borders (or the block, inside)
 * @param {Rect} [o.block] - the block the field is inserted into; the seam's
 *   length (defaults to `ref`)
 * @param {Align} [o.align]
 * @param {{width:number, height:number}} o.chip - measured full chip
 * @param {{width:number, height:number}} o.compact - measured compact chip
 * @param {Rect[]} [o.fields] - the rendered text fields
 * @param {Rect[]} [o.chips] - the chips already standing
 * @param {Rect} [o.bounds] - where a chip may stand (the preview)
 * @param {number} [o.gap]
 * @returns {{rect:Rect, compact:boolean, collides:boolean}}
 */
export function placeGhost({
  direction,
  side,
  ref,
  block = null,
  align = 'start',
  chip,
  compact,
  fields = [],
  chips = [],
  bounds = null,
  gap = SEAM_GAP,
}) {
  const list = candidates({
    direction,
    side,
    ref,
    block,
    align,
    chip,
    compact,
    gap,
  }).map((c) => ({ ...c, rect: clampInto(c.rect, bounds) }));
  const hits = (r, set) => set.some((o) => overlaps(r, o));
  // The seam has room for the full chip when its own spot is free of fields;
  // the later lines only take chips that share it.
  const seamHasRoom = !hits(list[0].rect, fields);
  for (const c of list) {
    if (!c.compact && !seamHasRoom) continue;
    if (hits(c.rect, fields) || hits(c.rect, chips)) continue;
    return { ...c, collides: false };
  }
  const fallback = list.find((c) => c.compact) || list[0];
  return { ...fallback, collides: true };
}

/**
 * Place a set of ghost chips, in order, each against the fields and every
 * chip standing before it - the one loop the overlay and the all-types test
 * both run, so the test measures the editor's rule and not a copy of it.
 * @param {Array<{seam:{direction:Direction, side:Side, align:Align, ref:Rect,
 *   block:Rect}, chip:{width:number,height:number},
 *   compact:{width:number,height:number}}>} ghosts - seams as rects
 * @param {{fields:Rect[], chips?:Rect[], bounds?:Rect, gap?:number}} ctx
 * @returns {Array<{rect:Rect, compact:boolean, collides:boolean}>}
 */
export function solveGhosts(
  ghosts,
  { fields, chips = [], bounds = null, gap },
) {
  const standing = [...chips];
  return ghosts.map(({ seam, chip, compact }) => {
    const res = placeGhost({
      ...seam,
      chip,
      compact,
      fields,
      chips: standing,
      bounds,
      ...(gap === undefined ? {} : { gap }),
    });
    standing.push(res.rect);
    return res;
  });
}
