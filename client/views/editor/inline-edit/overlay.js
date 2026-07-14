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
 *
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {HTMLElement} opts.thumb - the unscaled preview container
 */
export function createInlineOverlay({ h, thumb }) {
  const layer = h('div', { class: 'ie-overlay', 'aria-hidden': 'false' });

  /**
   * @type {Array<{el:HTMLElement, target:HTMLElement, place:string, gap:number}>}
   * `place`: 'cover' | 'top-right' | 'bottom-center' | 'below-start'
   */
  let placements = [];

  function ensureAttached() {
    // thumb is the positioning context (comment-markers also relies on this).
    if (!thumb.style.position) thumb.style.position = 'relative';
    if (layer.parentNode !== thumb) thumb.appendChild(layer);
  }

  function clear() {
    placements = [];
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
    layer.appendChild(el);
    placements.push({ el, target, place: placeMode, gap });
    return el;
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

  function destroy() {
    ro.disconnect();
    layer.remove();
  }

  return { layer, clear, outline, place, reposition, ensureAttached, destroy };
}
