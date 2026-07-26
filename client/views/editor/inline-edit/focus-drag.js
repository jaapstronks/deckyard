/**
 * Focal-point drag affordance for the inline editor (descriptor `focus`).
 *
 * A handle on each filled, cropped image sets the crop focus (object-position)
 * by direct manipulation, replacing a trip to the 3x3 grid in the inspector.
 * The handle updates the image live during the drag; the model write + save
 * happens on pointerup (same dirty/save path as the popover), with no rerender
 * mid-drag — the inline style already reflects it.
 *
 * Split out of inline-editor.js (B10 P4 seam), behaviour-preserving. The whole
 * concern is self-contained: four of its functions are private to it, and its
 * only entry point is insertFocusAffordances (called once, from refresh()).
 *
 * The host wires it in via the closure state it needs:
 *   - overlay            — the unscaled affordance overlay (focusPoint/reposition).
 *   - resolveMediaTarget — resolve a photo element to its member object + index.
 *   - getSlide / getSlideDef — read the current slide and its type definition.
 *   - markDirty / requestSave — the shared dirty/save path (fired on commit).
 */

import { getInlineDescriptor } from './descriptors.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * @param {object} opts
 * @param {object} opts.overlay - inline affordance overlay.
 * @param {(photoEl: HTMLElement) => ({idx:number, member:Object, media:Object}|null)} opts.resolveMediaTarget
 * @param {() => (Object|null)} opts.getSlide - current slide.
 * @param {(type: string) => (Object|null)} opts.getSlideDef - slide-type definition.
 * @param {() => void} opts.markDirty - mark the deck dirty.
 * @param {() => void} opts.requestSave - request a save.
 * @returns {{ insertFocusAffordances: (root: HTMLElement, def: Object, descriptor: Object) => void }}
 */
export function createFocusDrag({
  overlay,
  resolveMediaTarget,
  getSlide,
  getSlideDef,
  markDirty,
  requestSave,
}) {
  const clampPct = (n) => Math.max(0, Math.min(100, n));
  const focusNum = (v) => {
    if (v === '' || v == null) return 50;
    const n = Number(v);
    return Number.isFinite(n) ? clampPct(n) : 50;
  };

  /**
   * Resolve where a photo's focal point reads/writes: reuse resolveMediaTarget
   * for the member object + index, then the descriptor's `focus` knob for the
   * field keys, the crop mode, and (optionally) the effective initial value.
   * @returns {{idx:number, member:Object, xKey:string, yKey:string,
   *   cropMode:string, initial:{x:number, y:number}}|null}
   */
  function resolveFocusTarget(photoEl) {
    const base = resolveMediaTarget(photoEl);
    if (!base) return null;
    const slide = getSlide?.();
    const descriptor = slide
      ? getInlineDescriptor(slide.type, getSlideDef?.(slide.type))
      : null;
    const focus = descriptor?.focus;
    if (!focus) return null;
    const { idx, member, media } = base;
    const sub = (s) => (media.list ? s : String(s).replace('{n}', String(idx)));
    const xKey = sub(focus.xField);
    const yKey = sub(focus.yField);
    const cropMode =
      typeof focus.cropMode === 'function' ? focus.cropMode(slide, idx) : 'cover';
    const raw =
      typeof focus.get === 'function'
        ? focus.get(slide, idx)
        : { x: member[xKey], y: member[yKey] };
    return {
      idx,
      member,
      xKey,
      yKey,
      cropMode,
      initial: { x: focusNum(raw?.x), y: focusNum(raw?.y) },
    };
  }

  /** A draggable focal point on each filled image whose current mode crops. */
  function insertFocusAffordances(root, _def, descriptor) {
    if (!descriptor.focus || !descriptor.media?.photoSelector) return;
    for (const photo of root.querySelectorAll(descriptor.media.photoSelector)) {
      if (photo.classList.contains('is-empty')) continue; // filled images only
      const ft = resolveFocusTarget(photo);
      if (!ft || ft.cropMode !== 'cover') continue; // crop focus only
      const pt = overlay.focusPoint(photo, ft.initial);
      pt.title = t('editor.inline.focus.hint', 'Drag to set image focus');
      wireFocusDrag(pt, photo, ft);
    }
  }

  function wireFocusDrag(pt, photo, ft) {
    let dragging = false;
    // object-position lives on the <img>. Some types tag the wrapper as the
    // photo element (content-columns' .cc-image div holds the img inside), so
    // resolve the actual image for the live style; the wrapper still gives the
    // rect for pointer mapping (the img fills it).
    const styleTarget =
      photo.tagName === 'IMG' ? photo : photo.querySelector('img') || photo;
    const toPct = (e) => {
      const r = photo.getBoundingClientRect();
      return {
        x: clampPct(((e.clientX - r.left) / (r.width || 1)) * 100),
        y: clampPct(((e.clientY - r.top) / (r.height || 1)) * 100),
      };
    };
    const apply = ({ x, y }) => {
      pt.dataset.fx = String(x);
      pt.dataset.fy = String(y);
      pt.setAttribute('aria-valuetext', `${Math.round(x)}% ${Math.round(y)}%`);
      overlay.reposition();
      styleTarget.style.objectPosition = `${x}% ${y}%`;
    };
    const commit = () => {
      ft.member[ft.xKey] = Math.round(focusNum(pt.dataset.fx));
      ft.member[ft.yKey] = Math.round(focusNum(pt.dataset.fy));
      markDirty?.();
      requestSave?.();
    };
    pt.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      pt.classList.add('is-dragging');
      try {
        pt.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is best-effort */
      }
    });
    pt.addEventListener('pointermove', (e) => {
      if (dragging) apply(toPct(e));
    });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      pt.classList.remove('is-dragging');
      try {
        pt.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      commit();
    };
    pt.addEventListener('pointerup', end);
    pt.addEventListener('pointercancel', end);
    // Keyboard: arrows nudge (Shift = fine 1%, else 5%), Home centers. Writes +
    // saves per keypress; no rerender, so focus stays on the handle for repeats.
    pt.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 5;
      let x = focusNum(pt.dataset.fx);
      let y = focusNum(pt.dataset.fy);
      switch (e.key) {
        case 'ArrowLeft': x -= step; break;
        case 'ArrowRight': x += step; break;
        case 'ArrowUp': y -= step; break;
        case 'ArrowDown': y += step; break;
        case 'Home': x = 50; y = 50; break;
        default: return;
      }
      e.preventDefault();
      e.stopPropagation();
      apply({ x: clampPct(x), y: clampPct(y) });
      commit();
    });
    // A tap on the handle must not bubble to the image click (select + open tab).
    pt.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  }

  return { insertFocusAffordances };
}
