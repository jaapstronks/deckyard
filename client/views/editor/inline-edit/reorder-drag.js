/**
 * Drag-to-reorder affordance for the inline editor (repeatable card levels).
 *
 * A grip on each item starts a pointer drag that measures the level's item
 * rects once (the slide doesn't rerender mid-drag), snaps the pointer to the
 * nearest insertion gap (reorder-geometry.js) and draws an indicator line
 * there; pointerup commits the array move through the host. Pointer capture
 * keeps the events on the grip, so nothing leaks into click-to-edit. Esc
 * cancels.
 *
 * Split out of inline-editor.js (B10 P4 seam), behaviour-preserving. The whole
 * concern is self-contained: it owns only its transient drag state (the drop
 * indicator element, the pointer/keydown listeners, the pending drop position
 * and the dragging CSS classes), and its only entry point is `begin`, called
 * once, from the grip's pointerdown in insertCardLevel(). The array geometry
 * already lives in ./reorder-geometry.js.
 *
 * The host wires it in via the closure state it needs:
 *   - h         — the DOM helper, for the indicator element.
 *   - thumb     — the unscaled slide thumb (rect origin + dragging class).
 *   - overlay   — the affordance overlay; the indicator mounts on overlay.layer.
 *   - onReorder — commit an item move: (path, from, to) => void.
 */

import { computeDrop, resolveMove } from './reorder-geometry.js';
import { h } from '../../../lib/dom.js';

/**
 * @param {object} opts
 * @param {HTMLElement} opts.thumb - the unscaled slide thumb element.
 * @param {object} opts.overlay - inline affordance overlay (provides `.layer`).
 * @param {(path: string, from: number, to: number) => void} opts.onReorder -
 *   commit the array move once a drop is chosen.
 * @returns {{ begin: (e: PointerEvent, params: {path: string, scopeEl: HTMLElement,
 *   itemSelector: string, fromIdx: number}) => void }}
 */
export function createReorderDrag({ thumb, overlay, onReorder }) {
  function begin(e, { path, scopeEl, itemSelector, fromIdx }) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grip = e.currentTarget;
    const thumbRect = thumb.getBoundingClientRect();
    const items = [...scopeEl.querySelectorAll(itemSelector)]
      .filter((el) =>
        Number.isInteger(Number(el.getAttribute('data-inline-item-index'))),
      )
      .sort(
        (a, b) =>
          Number(a.getAttribute('data-inline-item-index')) -
          Number(b.getAttribute('data-inline-item-index')),
      );
    if (items.length < 2) return;
    const rects = items.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left - thumbRect.left,
        top: r.top - thumbRect.top,
        width: r.width,
        height: r.height,
      };
    });

    const indicator = h('div', { class: 'ie-drop-indicator' });
    overlay.layer.appendChild(indicator);
    thumb.classList.add('is-ie-dragging');
    grip.classList.add('is-dragging');
    grip.setPointerCapture?.(e.pointerId);

    let drop = null;
    const onMove = (ev) => {
      drop = computeDrop(rects, {
        x: ev.clientX - thumbRect.left,
        y: ev.clientY - thumbRect.top,
      });
      if (!drop) return;
      const line = drop.line;
      const s = indicator.style;
      if (line.orientation === 'v') {
        s.left = `${line.x - 1.5}px`;
        s.top = `${line.y}px`;
        s.width = '3px';
        s.height = `${line.length}px`;
      } else {
        s.left = `${line.x}px`;
        s.top = `${line.y - 1.5}px`;
        s.width = `${line.length}px`;
        s.height = '3px';
      }
    };
    const onKeyDown = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(false);
      }
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    function finish(commit) {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      indicator.remove();
      thumb.classList.remove('is-ie-dragging');
      grip.classList.remove('is-dragging');
      if (commit && drop) {
        const to = resolveMove(fromIdx, drop.index);
        if (to !== fromIdx) onReorder(path, fromIdx, to);
      }
    }
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
  }

  return { begin };
}
