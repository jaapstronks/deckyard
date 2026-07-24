/**
 * Overlay affordance layer for the inline (WYSIWYG) editor.
 *
 * Why this exists: the slide is rendered into a fixed 1600x900 canvas and then
 * `transform: scale(var(--thumb-scale))`-d down to fit inside `.thumb` (see
 * thumb-scale.js). Anything rendered *inside* the slide is scaled down with it -
 * a 14px "+ Subheading" chip becomes ~4px, a 1px dashed outline becomes a hair.
 * That is why the first passes of the affordances read as microscopic.
 *
 * This layer sits on the UNSCALED `.thumb` (the same trick comment-markers.js
 * uses) and positions each affordance by measuring its target element's rect via
 * getBoundingClientRect (which already accounts for the slide's scale). So the
 * chips, clear buttons, card controls and dashed outlines render at real screen
 * pixels and stay consistently sized at any preview zoom.
 *
 * mountSlideInto() wipes `thumb.innerHTML` on every rerender, so the layer is
 * re-attached (ensureAttached) and rebuilt on each refresh, like the markers.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {HTMLElement} opts.thumb - the unscaled preview container
 */
export function createInlineOverlay({ h, thumb }) {
  const layer = h('div', { class: 'ie-overlay', 'aria-hidden': 'false' });

  /**
   * @type {Array<{el:HTMLElement, target:HTMLElement, place:string, gap:number}>}
   * `place`: 'cover' | 'top-right' | 'bottom-center' | 'below-start' | 'below-end'
   */
  let placements = [];
  // The collection item whose scoped chips are currently revealed (per-item
  // reveal, see the pointer/focus controller below). Reset on every rebuild.
  let activeOwner = null;

  function ensureAttached() {
    // thumb is the positioning context (comment-markers also relies on this).
    if (!thumb.style.position) thumb.style.position = 'relative';
    if (layer.parentNode !== thumb) thumb.appendChild(layer);
  }

  function clear() {
    placements = [];
    activeOwner = null;
    layer.replaceChildren();
  }

  function rectIn(target) {
    const t = thumb.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    return {
      left: r.left - t.left,
      top: r.top - t.top,
      width: r.width,
      height: r.height,
    };
  }

  /**
   * A dashed outline box drawn over a field (shown on hover via CSS). Returns the
   * box so callers can associate it with its field for the stronger direct-hover.
   */
  function outline(target) {
    const box = h('div', { class: 'ie-ol-outline' });
    layer.appendChild(box);
    placements.push({ el: box, target, place: 'cover', gap: 0 });
    return box;
  }

  /**
   * Place an interactive affordance (chip / button) relative to a target.
   * @param {HTMLElement} el
   * @param {HTMLElement} target
   * @param {string} place - 'top-right' | 'bottom-center' | 'right-center' | 'below-start'
   * @param {number} [gap]
   */
  function place(el, target, placeMode = 'below-start', gap = 6) {
    el.classList.add('ie-ol-item');
    // Item-scoped chips (a card's ×/grip, a per-item ghost) reveal only for the
    // hovered/focused collection item, not the whole slide - a dense grid
    // (text-blocks 3x3 = ~40 chips) would otherwise show everything at once. A
    // chip whose target lives inside a collection item ([data-inline-item-index])
    // is tagged and remembered against that item; slide-level chips (header
    // ghosts, the container "+ Add") stay on the whole-slide hover reveal.
    const owner = target?.closest?.('[data-inline-item-index]') || null;
    if (owner) {
      el.classList.add('ie-item-scoped');
      el.__ieOwner = owner;
    }
    layer.appendChild(el);
    placements.push({ el, target, place: placeMode, gap, owner });
    return el;
  }

  /**
   * A draggable focal-point handle positioned at (x, y) as a percentage inside
   * the target image's rect. The caller wires the pointer drag and updates the
   * handle's `data-fx` / `data-fy` (0..100) during the drag; reposition() reads
   * them back so the handle tracks the image at any preview zoom / on reflow.
   * @param {HTMLElement} target - the filled <img> element
   * @param {{x:number, y:number}} pos - focus percentages (0..100)
   */
  function focusPoint(target, { x = 50, y = 50 } = {}) {
    const pt = h('div', {
      class: 'ie-ol-item ie-focus-point',
      role: 'slider',
      'aria-label': t('editor.inline.focusPoint', 'Image focus point'),
      // Keyboard-operable (arrow keys nudge, Home centers) so focus is not a
      // pointer-only control - the caller wires the keydown handler.
      tabindex: '0',
      'aria-valuetext': `${Math.round(x)}% ${Math.round(y)}%`,
    });
    pt.dataset.fx = String(x);
    pt.dataset.fy = String(y);
    layer.appendChild(pt);
    placements.push({ el: pt, target, place: 'focus-point', gap: 0 });
    return pt;
  }

  function reposition() {
    ensureAttached();
    // Chips sharing an anchor (subheading + byline + attribution) pack into a
    // horizontal row, wrapping to a new row only if they exceed the slide width
    // - so bottom-anchored fields don't push chips off-slide.
    const pack = { x: new Map(), rowTop: new Map(), width: thumb.clientWidth || 9999 };
    for (const p of placements) {
      if (!p.target || !p.target.isConnected) {
        p.el.style.display = 'none';
        continue;
      }
      p.el.style.display = '';
      applyPlacement(p, rectIn(p.target), pack);
    }
    // Second pass: keep interactive chips from overlapping each other even when
    // they anchor to *different* elements. The per-anchor packing above only
    // reconciles chips that share one target; two ghosts on separate anchors
    // (e.g. the title-slide "+ Subtitle" under `.title` and "+ Meta" inside
    // `.tsu-content`) can still land on top of each other. Here the overlay sees
    // every chip at once - the one place that knows the full set - so it can
    // nudge later chips downward until nothing collides.
    resolveOverlaps();
  }

  /**
   * Global de-collision for interactive chips. Runs after every chip is placed,
   * measures their real rects, and pushes any chip that overlaps an already-
   * settled one straight down until it clears. Because it operates on the whole
   * placement set (not per-anchor), it structurally prevents cross-anchor chip
   * overlaps rather than fixing them case by case.
   */
  function resolveOverlaps() {
    const MARGIN = 4; // breathing room between chips (screen px)
    // Field outlines (`cover`) sit on their field by design and the image focus
    // handle lives inside the image - neither participates. Item-scoped chips
    // count only when their owner is the revealed one, since just one item's
    // chips are visible at a time (opacity-hidden chips still occupy a rect).
    const boxes = placements
      .filter(
        (p) =>
          p.place !== 'cover' &&
          p.place !== 'focus-point' &&
          p.el.style.display !== 'none' &&
          (!p.owner || p.owner === activeOwner),
      )
      .map((p) => ({ p, r: rectIn(p.el) }))
      .sort((a, b) => a.r.top - b.r.top || a.r.left - b.r.left);

    const settled = [];
    for (const box of boxes) {
      const { left, width, height } = box.r;
      let top = box.r.top;
      // Push down past every settled chip this one still horizontally overlaps.
      // Bounded by the chip count - each iteration clears at least one chip.
      for (let guard = 0; guard < settled.length; guard++) {
        const hit = settled.find(
          (q) =>
            left < q.left + q.width + MARGIN &&
            left + width + MARGIN > q.left &&
            top < q.top + q.height + MARGIN &&
            top + height + MARGIN > q.top,
        );
        if (!hit) break;
        top = hit.top + hit.height + MARGIN;
      }
      const delta = top - box.r.top;
      if (delta > 0.5) {
        // style.top is what applyPlacement just wrote; a transform (if any) is a
        // constant offset, so shifting style.top shifts the rect by the same px.
        const cur = parseFloat(box.p.el.style.top) || 0;
        box.p.el.style.top = `${cur + delta}px`;
      }
      settled.push({ left, top, width, height });
    }
  }

  function applyPlacement(p, r, pack) {
    const s = p.el.style;
    switch (p.place) {
      case 'cover':
        s.left = `${r.left}px`;
        s.top = `${r.top}px`;
        s.width = `${r.width}px`;
        s.height = `${r.height}px`;
        s.transform = '';
        break;
      case 'top-right':
        // Centered ON the field's top-right corner (macOS-badge style). The
        // thumb has overflow visible in inline-edit mode, so the overhang is
        // not clipped.
        s.left = `${r.left + r.width}px`;
        s.top = `${r.top}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      case 'top-left':
        // Centered on the top-left corner.
        s.left = `${r.left}px`;
        s.top = `${r.top}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      case 'top-center':
        // Centered on the middle of the top edge - the reorder grip's
        // default: a corner would collide with the remove × of a grid/row
        // neighbour (adjacent cards share their gutter corners), the edge
        // middle never does, and it reads as a drag handle.
        s.left = `${r.left + r.width / 2}px`;
        s.top = `${r.top}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      case 'bottom-left':
        // Centered on the bottom-left corner (container-level grips whose
        // top-left corner coincides with the first child card's own grip).
        s.left = `${r.left}px`;
        s.top = `${r.top + r.height}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      case 'bottom-right':
        // Centered on the bottom-right corner. Used for container-level remove
        // buttons (a text-blocks row) whose top-right corner coincides with the
        // last child card's own remove ×.
        s.left = `${r.left + r.width}px`;
        s.top = `${r.top + r.height}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      case 'bottom-center':
        s.left = `${r.left + r.width / 2}px`;
        s.top = `${r.top + r.height + p.gap}px`;
        s.transform = 'translateX(-50%)';
        break;
      case 'center':
        s.left = `${r.left + r.width / 2}px`;
        s.top = `${r.top + r.height / 2}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      case 'inset-bottom-left':
        // Inset just inside the target's bottom-left corner (on-image controls
        // like the fit toggle), anchored by its own bottom-left.
        s.left = `${r.left + p.gap}px`;
        s.top = `${r.top + r.height - p.gap}px`;
        s.transform = 'translateY(-100%)';
        break;
      case 'inset-bottom-right':
        // Inset just inside the target's bottom-right corner (e.g. the "more
        // settings" chip), anchored by its own bottom-right.
        s.left = `${r.left + r.width - p.gap}px`;
        s.top = `${r.top + r.height - p.gap}px`;
        s.transform = 'translate(-100%, -100%)';
        break;
      case 'focus-point': {
        // Positioned at (fx%, fy%) inside the target image, read live from the
        // handle's dataset so a drag repositions it without a rerender.
        const fx = Number(p.el.dataset.fx);
        const fy = Number(p.el.dataset.fy);
        const px = Number.isFinite(fx) ? fx : 50;
        const py = Number.isFinite(fy) ? fy : 50;
        s.left = `${r.left + (r.width * px) / 100}px`;
        s.top = `${r.top + (r.height * py) / 100}px`;
        s.transform = 'translate(-50%, -50%)';
        break;
      }
      case 'below-end': {
        // Below the anchor, right-aligned to the anchor's right edge. Like
        // below-start but shifted right: the anchor is a full-width heading and
        // the body starts immediately under it, so below-start lands the opaque
        // chip on top of the first body line (issue #113). Body text is
        // left-aligned, so the top-right of the content area is empty - the chip
        // sits there instead. Single-chip only (no horizontal packing): the
        // subheading ghost is alone on its anchor.
        s.transform = '';
        const w = p.el.offsetWidth || 90;
        let left = r.left + r.width - w;
        // Never push past the anchor's own left edge (short/narrow anchors).
        if (left < r.left) left = r.left;
        s.left = `${left}px`;
        s.top = `${r.top + r.height + p.gap}px`;
        break;
      }
      case 'right-center': {
        // At the target's right-edge midpoint, on the (vertical) center line.
        // Used for the "+ Add item" affordance of single-row horizontal layouts
        // (timeline, horizontal process): a new item appends to the right, so the
        // add button sits at the right insertion point (on the track line) rather
        // than bottom-center. The slide fills the canvas, so we clamp the center
        // inward to keep the whole pill on-thumb instead of clipping past the
        // right edge.
        s.transform = 'translate(-50%, -50%)';
        const w = p.el.offsetWidth || 90;
        let cx = r.left + r.width + p.gap;
        const maxCx = (pack?.width || 9999) - w / 2 - 2;
        if (cx > maxCx) cx = maxCx;
        s.left = `${cx}px`;
        s.top = `${r.top + r.height / 2}px`;
        break;
      }
      // Chip rows. All three share the horizontal packing; they differ only in
      // where the first row starts relative to the target rect:
      //   below-start  - under the target (default; ghost under its anchor)
      //   top-start    - inside the target's top-left (headers, whole-slide anchors)
      //   bottom-start - inside the target's bottom-left (bottom-anchored fields)
      case 'top-start':
      case 'bottom-start':
      case 'below-start':
      default: {
        s.transform = '';
        const hh0 = p.el.offsetHeight || 24;
        const baseTop =
          p.place === 'top-start'
            ? r.top + p.gap
            : p.place === 'bottom-start'
              ? r.top + r.height - hh0 - p.gap
              : r.top + r.height + p.gap;
        const key = `${p.place}:`;
        const mapKey = p.target; // chips share a row per target+mode
        const xKey = pack.x.get(mapKey)?.[key];
        const tKey = pack.rowTop.get(mapKey)?.[key];
        let x = xKey != null ? xKey : r.left;
        let rowTop = tKey != null ? tKey : baseTop;
        // Tentatively place, measure, then wrap if it runs past the slide edge.
        s.left = `${x}px`;
        s.top = `${rowTop}px`;
        const w = p.el.offsetWidth || 90;
        const hh = p.el.offsetHeight || 24;
        if (x > r.left && x + w > pack.width - 4) {
          rowTop += hh + 6;
          x = r.left;
          s.left = `${x}px`;
          s.top = `${rowTop}px`;
        }
        if (!pack.x.has(mapKey)) pack.x.set(mapKey, {});
        if (!pack.rowTop.has(mapKey)) pack.rowTop.set(mapKey, {});
        pack.x.get(mapKey)[key] = x + w + 8;
        pack.rowTop.get(mapKey)[key] = rowTop;
        break;
      }
    }
  }

  ensureAttached();
  const ro = new ResizeObserver(() => reposition());
  ro.observe(thumb);

  // --- Per-item affordance reveal -------------------------------------------
  // Item-scoped chips stay hidden until their owning collection item is hovered
  // or focused, so a dense grid doesn't reveal dozens of chips at once. The
  // overlay layer is pointer-events:none (only chips are interactive), so a
  // pointerover on the thumb reports the real slide element under the cursor, or
  // the chip itself when hovering one.
  function setActiveOwner(owner) {
    if (owner === activeOwner) return;
    activeOwner = owner;
    for (const p of placements) {
      if (p.owner) p.el.classList.toggle('is-item-active', p.owner === owner);
    }
  }
  function ownerFromEventTarget(node) {
    if (!node?.closest) return null;
    const chip = node.closest('.ie-item-scoped');
    if (chip?.__ieOwner) return chip.__ieOwner;
    return node.closest('[data-inline-item-index]') || null;
  }
  thumb.addEventListener('pointerover', (e) => setActiveOwner(ownerFromEventTarget(e.target)));
  thumb.addEventListener('pointerleave', (e) => {
    // Chips can overhang the thumb's edge; moving onto one must not clear the
    // reveal (relatedTarget is then a node inside the overlay layer).
    if (e.relatedTarget && layer.contains(e.relatedTarget)) return;
    setActiveOwner(null);
  });
  thumb.addEventListener('focusin', (e) => {
    const owner = ownerFromEventTarget(e.target);
    if (owner) setActiveOwner(owner);
  });

  function destroy() {
    ro.disconnect();
    layer.remove();
  }

  return { layer, clear, outline, place, focusPoint, reposition, ensureAttached, destroy };
}
