// Small, shared helpers for the editor view.
import { newId } from '../../lib/util/id.js';
import { t } from '../../lib/ui-i18n.js';

// Scroll locking for overlay modals (ref-counted; safe for nested modals).
let sbScrollLockCount = 0;
let sbPrevHtmlOverflow = '';
let sbPrevBodyOverflow = '';
export function lockDocumentScroll() {
  if (sbScrollLockCount === 0) {
    sbPrevHtmlOverflow =
      document.documentElement.style.overflow;
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
      document.documentElement.style.overflow =
        sbPrevHtmlOverflow;
      document.body.style.overflow = sbPrevBodyOverflow;
    }
  };
}

export function slideLabel(slide, slideTypes) {
  const def = slideTypes?.[slide?.type];
  const defLabel = t(
    def?.labelKey || `slideType.${slide?.type}.label`,
    def?.label || slide?.type || ''
  );
  const content = slide?.content || {};

  // Check for labelField in slide type definition (for custom slide types)
  if (def?.labelField && content[def.labelField]) {
    return content[def.labelField];
  }

  // Core slide type special cases (for backwards compatibility)
  if (slide?.type === 'title-slide')
    return content.title || defLabel || 'Title slide';
  if (slide?.type === 'chapter-title-slide')
    return content.title || defLabel || 'Section title';
  if (slide?.type === 'content-slide')
    return content.title || defLabel || 'Content slide';
  if (slide?.type === 'chart-slide')
    return content.title || defLabel || 'Chart';
  if (slide?.type === 'lijstje-slide')
    return content.title || defLabel || 'List';
  if (slide?.type === 'image-text-slide')
    return content.title || defLabel || 'Image + text (split)';
  if (slide?.type === 'quote-slide')
    return content.quote || defLabel || 'Quote slide';
  if (slide?.type === 'poll-slide')
    return content.question || defLabel || 'Poll';
  if (slide?.type === 'image-slide')
    return content.caption || defLabel || 'Image slide';

  // Fallback: check for title field, then use definition label
  const title = String(content.title || '').trim();
  if (title) return title;
  return defLabel || slide?.type || 'Slide';
}

export function oneLine(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(s, max = 64) {
  const t = oneLine(s);
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

export function slidePrimaryLabel(slide, slideTypes) {
  const def = slideTypes?.[slide.type];
  const defLabel = t(
    def?.labelKey || `slideType.${slide?.type}.label`,
    def?.label || slide?.type || ''
  );
  const content = slide?.content || {};

  // Check for labelField in slide type definition (for custom slide types)
  if (def?.labelField && content[def.labelField]) {
    return truncate(content[def.labelField], 52);
  }

  // Core slide type special cases (for backwards compatibility)
  if (slide?.type === 'quote-slide')
    return truncate(content.quote || defLabel || 'Quote', 52);
  if (slide?.type === 'poll-slide')
    return truncate(content.question || defLabel || 'Poll', 52);
  if (slide?.type === 'image-slide') {
    const caption = String(content.caption || '').trim();
    if (caption) return truncate(caption, 52);
    const title = String(content.title || '').trim();
    if (title) return truncate(title, 52);
    return defLabel || 'Image slide';
  }

  // Fallback: check for title field, then use definition label
  const title = String(content.title || '').trim();
  if (title) return truncate(title, 52);

  return truncate(defLabel || slide?.type || 'Slide', 52);
}

export function deepClone(v) {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : JSON.parse(JSON.stringify(v));
}

export function makeNewSlide(type, slideTypes, { lang } = {}) {
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
  if (type === 'poll-slide') {
    const pollId =
      typeof slide.content?.pollId === 'string'
        ? slide.content.pollId.trim()
        : '';
    if (!pollId) {
      slide.content.pollId = newId();
    }
  }
  return slide;
}