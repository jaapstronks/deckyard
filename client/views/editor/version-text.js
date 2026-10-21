/**
 * Write text in the active projection or an inactive language buffer.
 * Inactive collab writes must go through the doc: buffer-only changes are
 * discarded on the next projection. Legacy writes require an exact revision.
 */
import {
  recordTranslationSource,
  translationSource,
} from '../../../shared/translation-provenance.js';
import { valueAtPath } from '../../../shared/slide-types/text-fields.js';

const isPlainObject = (v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const isPath = (path) =>
  Array.isArray(path) &&
  path.length > 0 &&
  path.every((p) => typeof p === 'string' || Number.isInteger(p)) &&
  typeof path[path.length - 1] === 'string';

/**
 * Set the string at `path` in `content` when its parent exists and the
 * current value is a string or absent.
 * @returns {boolean} whether it was set
 */
function setTextAt(content, path, value) {
  const parent =
    path.length === 1 ? content : valueAtPath(content, path.slice(0, -1));
  if (!isPlainObject(parent)) return false;
  const key = path[path.length - 1];
  if (parent[key] !== undefined && typeof parent[key] !== 'string')
    return false;
  parent[key] = value;
  return true;
}

function writeIntoSlide(slides, slideId, path, value) {
  const slide = Array.isArray(slides)
    ? slides.find((s) => s?.id === slideId)
    : null;
  if (!isPlainObject(slide)) return false;
  if (!isPlainObject(slide.content)) slide.content = {};
  return setTextAt(slide.content, path, value);
}

const isDeckTitle = (slideId, path) =>
  !slideId && path.length === 1 && path[0] === 'title';

/**
 * @param {Object} opts
 * @param {Object} opts.pres - the editor's live presentation
 * @param {Function} opts.normalizeLang - canonical deck-language spelling
 * @param {Function} opts.markDirty - the controller's edit seam; returns
 *   false when it refused the edit (a slide lock)
 * @param {Function} [opts.syncVersionStructure] - mirror the active version's
 *   structure into the others (legacy save manager)
 * @param {boolean} [opts.liveEditsActive] - collab live edits are on
 * @param {Function} [opts.getLiveEdits] - () => the live-edits handle, or null
 *   before it loaded
 * @param {Function} [opts.onTitleChanged] - (title) after the active title changed
 * @returns {(lang: string, slideId: string|null, path: Array<string|number>,
 *   value: string, options?: {sourceLang?: string}) => boolean} the write seam;
 *   false when nothing was written. `sourceLang` stamps provenance from that
 *   version's text at the same address; where it has none, the write stands
 *   without a stamp.
 */
export function createVersionTextWriter({
  pres,
  normalizeLang,
  markDirty,
  syncVersionStructure,
  liveEditsActive = false,
  getLiveEdits,
  onTitleChanged,
} = {}) {
  const writeActive = (slideId, path, value, source) => {
    const version = pres.i18n?.versions?.[pres.i18n?.active];
    const previousSources = version?.translationSources
      ? structuredClone(version.translationSources)
      : null;
    const record = () => {
      if (source && version)
        recordTranslationSource(version, slideId, path, source);
    };
    if (isDeckTitle(slideId, path)) {
      pres.title = value;
      const buf = pres.i18n?.versions?.[pres.i18n?.active];
      if (isPlainObject(buf)) buf.title = value;
      onTitleChanged?.(value);
      record();
      markDirty({ action: 'edit' });
      return true;
    }
    if (!slideId || !writeIntoSlide(pres.slides, slideId, path, value))
      return false;
    // False: another user holds the slide; the controller takes the text
    // back out (D112), so it is no write.
    record();
    if (markDirty({ slideId, action: 'edit' }) !== false) return true;
    if (source && version) {
      if (previousSources) version.translationSources = previousSources;
      else delete version.translationSources;
    }
    return false;
  };

  const writeLegacy = (lang, slideId, path, value, source) => {
    const version = () => pres.i18n?.versions?.[lang];
    if (!isPlainObject(version())) return false;
    if (isDeckTitle(slideId, path)) {
      version().title = value;
    } else if (!slideId) {
      return false;
    } else if (!writeIntoSlide(version().slides, slideId, path, value)) {
      // The version may lag the active structure until the next save (a
      // slide or item added since): mirror it now and try once more.
      syncVersionStructure?.();
      if (!writeIntoSlide(version().slides, slideId, path, value)) return false;
    }
    if (source) recordTranslationSource(version(), slideId, path, source);
    markDirty({ noActiveSlide: true, action: 'edit' });
    return true;
  };

  return function writeVersionText(
    lang,
    slideId,
    path,
    value,
    { sourceLang = null } = {},
  ) {
    const l = normalizeLang?.(lang);
    if (!l || typeof value !== 'string' || !isPath(path)) return false;
    let source = null;
    if (sourceLang) {
      const from = normalizeLang(sourceLang);
      if (!from || from === l || !pres.i18n?.versions?.[from]) return false;
      const version =
        from === normalizeLang(pres.i18n.active)
          ? pres
          : pres.i18n.versions[from];
      const text = isDeckTitle(slideId, path)
        ? version.title
        : valueAtPath(
            version.slides?.find((s) => s.id === slideId)?.content,
            path,
          );
      // No text on the other side means nothing to record provenance from,
      // not a refused write: a source-column edit whose target version lacks
      // that field (never translated) must still save (B816). Same rule as
      // `recordTranslatedVersion`: a blank source stamps nothing.
      if (typeof text === 'string' && text.trim())
        source = translationSource(from, text);
    }
    if (l === normalizeLang?.(pres.i18n?.active))
      return writeActive(slideId, path, value, source);
    if (liveEditsActive)
      return !!getLiveEdits?.()?.writeVersionText(
        l,
        slideId,
        path,
        value,
        source,
      );
    return writeLegacy(l, slideId, path, value, source);
  };
}

/**
 * The signal the translation view (B763) follows: a language buffer, the
 * readiness to write, or a slide lock may have changed. One signal rather
 * than one per cause: the view re-reads the deck either way.
 * @returns {{subscribe: (fn: Function) => Function, emit: () => void}}
 */
export function createVersionTextSignal() {
  const listeners = new Set();
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit() {
      for (const fn of [...listeners]) {
        try {
          fn();
        } catch (e) {
          console.warn('[version-text] listener failed:', e?.message || e);
        }
      }
    },
  };
}
