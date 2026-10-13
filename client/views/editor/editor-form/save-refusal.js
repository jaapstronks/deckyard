/** Field-local feedback for a slide save refused by the server. */
import { createInlineError } from '../../../lib/dom/inline-error.js';

/** Own the refusal across form rerenders, until another save or field edit. */
export function createSaveRefusal() {
  let refusal = null;
  const surfaces = new Set();
  const fields = new Map();
  const clear = () => {
    refusal = null;
    for (const surface of surfaces) {
      surface.clear();
      surface.el.remove();
    }
    surfaces.clear();
  };
  const matches = (slide, field) =>
    refusal?.details?.slideId === slide?.id &&
    refusal?.details?.field === field?.key;
  const decorate = (el, slide, field) => {
    fields.set(el, { slide, field });
    if (!matches(slide, field)) return;
    const surface = createInlineError();
    surfaces.add(surface);
    el.append(surface.el);
    const control = el.querySelector('input, textarea, select, button');
    surface.show(refusal.details.errors?.join('; ') || refusal.message, {
      control,
      focus: false,
    });
    el.addEventListener('input', clear, { once: true });
    el.addEventListener('change', clear, { once: true });
  };
  return {
    clear,
    detach() {
      clear();
      fields.clear();
    },
    set(error) {
      clear();
      refusal = error;
      for (const [el, { slide, field }] of fields) {
        if (el.isConnected) decorate(el, slide, field);
        else fields.delete(el);
      }
    },
    matches,
    reveal() {
      for (const el of fields.keys()) if (!el.isConnected) fields.delete(el);
      for (const surface of surfaces) {
        for (
          let parent = surface.el.parentElement;
          parent;
          parent = parent.parentElement
        ) {
          if (parent.tagName === 'DETAILS') parent.open = true;
        }
      }
    },
    decorate,
  };
}
