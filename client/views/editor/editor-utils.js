// Small, shared helpers for the editor view.
import { newId } from '../../lib/util/id.js';
import { t } from '../../lib/ui-i18n.js';
import { applyInstanceKeyDefaults } from '../../../shared/slide-types/instance-keys.js';

// Scroll locking for overlay modals (ref-counted; safe for nested modals).
let sbScrollLockCount = 0;
let sbPrevHtmlOverflow = '';
let sbPrevBodyOverflow = '';
export function lockDocumentScroll() {
  if (sbScrollLockCount === 0) {
    sbPrevHtmlOverflow = document.documentElement.style.overflow;
    sbPrevBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
  }
  sbScrollLockCount += 1;
  let unlocked = false;
  return () => {
    if (unlocked) return;
    unlocked = true;
    sbScrollLockCount = Math.max(0, sbScrollLockCount - 1);
    if (sbScrollLockCount === 0) {
      document.documentElement.style.overflow = sbPrevHtmlOverflow;
      document.body.style.overflow = sbPrevBodyOverflow;
    }
  };
}

export function slideLabel(slide, slideTypes) {
  const def = slideTypes?.[slide?.type];
  const defLabel = t(
    def?.labelKey || `slideType.${slide?.type}.label`,
    def?.label || slide?.type || '',
  );
  const content = slide?.content || {};

  // The type's declared label driver (quote, question, caption, …), then the
  // shared title fallback. No per-type branches: the declaration is the table.
  if (def?.labelField && content[def.labelField]) {
    return content[def.labelField];
  }

  const title = String(content.title || '').trim();
  if (title) return title;
  return defLabel || slide?.type || 'Slide';
}

export function oneLine(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s, max = 64) {
  const t = oneLine(s);
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function slidePrimaryLabel(slide, slideTypes) {
  return truncate(slideLabel(slide, slideTypes), 52);
}

export function deepClone(v) {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));
}

/**
 * Build a slide of `type`, seeded from the type's defaults for the deck's
 * language, with its declared instance keys filled in.
 *
 * `presentationId` is what the type's `instanceKeys` declaration needs to
 * resolve a `presentation-id` source; without it such a key is left alone
 * (see `applyInstanceKeyDefaults`). Passing it is what lets a freshly inserted
 * follow-invite slide render a working QR code before the first save, rather
 * than waiting for the server's save seam to repair it.
 *
 * @param {string} type - slide-type name; must exist in `slideTypes`
 * @param {Object} slideTypes - the type registry (`/api/slide-types` metadata)
 * @param {Object} [options]
 * @param {string} [options.lang] - deck language ('nl' / 'en-GB' seed
 *   `defaultsByLang`; anything else falls back to `defaults`)
 * @param {string} [options.presentationId] - id of the deck the slide is
 *   being inserted into
 * @returns {{id: string, type: string, content: Object, notes: string}}
 */
export function makeNewSlide(type, slideTypes, { lang, presentationId } = {}) {
  const def = slideTypes?.[type];
  if (!def) throw new Error(`Unknown slide type: ${type}`);
  const id = newId();
  const l = lang === 'nl' || lang === 'en-GB' ? lang : null;
  const langDefaults =
    l &&
    def?.defaultsByLang &&
    typeof def.defaultsByLang === 'object' &&
    def.defaultsByLang?.[l] &&
    typeof def.defaultsByLang[l] === 'object'
      ? def.defaultsByLang[l]
      : null;
  const slide = {
    id,
    type,
    content: deepClone(langDefaults || def.defaults || {}),
    notes: '',
  };
  // Instance-bound content keys come from the type's `instanceKeys`
  // declaration, not from a branch on the type name here. Insert is the same
  // "fill in what is missing" moment as save — a fresh slide holds nothing yet,
  // so defaults and rekey coincide — and `applyInstanceKeyDefaults` is the
  // helper that names it. Declaration + rationale:
  // shared/slide-types/instance-keys.js.
  applyInstanceKeyDefaults(slide, {
    def,
    presentationId: presentationId || '',
    newId,
  });
  return slide;
}
