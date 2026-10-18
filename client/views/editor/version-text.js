/**
 * Write one text into any language version of the open deck (B762).
 *
 * The editor edits one version at a time: `pres.title`/`pres.slides` are the
 * active version, and every edit seam writes there. A surface that shows two
 * languages side by side (the translation view, B763) needs to write the other
 * one too, and neither persistence mode had a route for that: the live-doc
 * binder diffs only `pres.slides` and re-projects the other versions over
 * anything written into them, and the legacy save tracks only active slides.
 *
 * `writeVersionText(lang, slideId, path, value)` is that route, for both
 * columns, so there is one write path for translated text:
 *
 * - **the active version** → `pres`, then `markDirty` (the seam every editor
 *   edit takes, in both modes);
 * - **another version, collab** → the binder writes that language's Y.Text;
 * - **another version, legacy** → `pres.i18n.versions[lang]`, then
 *   `markDirty({ noActiveSlide: true })`; the PUT carries every version.
 *
 * Only an existing text address is written: the slide must be in the version
 * and the item the path names must exist (the active version's structure
 * decides; a legacy version that lags behind it is mirrored first). Adding a
 * language or a slide is not a text write.
 */
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
 * @param {Function} opts.markDirty - the controller's edit seam
 * @param {Function} [opts.syncVersionStructure] - mirror the active version's
 *   structure into the others (legacy save manager)
 * @param {boolean} [opts.liveEditsActive] - collab live edits are on
 * @param {Function} [opts.getLiveEdits] - () => the live-edits handle, or null
 *   before it loaded
 * @param {Function} [opts.onTitleChanged] - (title) after the active title changed
 * @returns {(lang: string, slideId: string|null, path: Array<string|number>,
 *   value: string) => boolean} the write seam; false when nothing was written
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
  const writeActive = (slideId, path, value) => {
    if (isDeckTitle(slideId, path)) {
      pres.title = value;
      const buf = pres.i18n?.versions?.[pres.i18n?.active];
      if (isPlainObject(buf)) buf.title = value;
      onTitleChanged?.(value);
      markDirty({ action: 'edit' });
      return true;
    }
    if (!slideId || !writeIntoSlide(pres.slides, slideId, path, value))
      return false;
    markDirty({ slideId, action: 'edit' });
    return true;
  };

  const writeLegacy = (lang, slideId, path, value) => {
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
    markDirty({ noActiveSlide: true, action: 'edit' });
    return true;
  };

  return function writeVersionText(lang, slideId, path, value) {
    const l = normalizeLang?.(lang);
    if (!l || typeof value !== 'string' || !isPath(path)) return false;
    if (l === normalizeLang?.(pres.i18n?.active))
      return writeActive(slideId, path, value);
    if (liveEditsActive)
      return !!getLiveEdits?.()?.writeVersionText(l, slideId, path, value);
    return writeLegacy(l, slideId, path, value);
  };
}
