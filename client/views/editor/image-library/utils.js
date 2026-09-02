import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { getSupportedLangs } from '../../../lib/format/i18n.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';

/** Slide aspect ratio (16:9) */
const SLIDE_ASPECT_RATIO = 16 / 9;

/** Threshold for aspect ratio mismatch to trigger auto-fit (35%) */
const ASPECT_MISMATCH_THRESHOLD = 0.35;

/**
 * Load image dimensions from a URL
 * @param {string} url - Image URL
 * @returns {Promise<{width: number, height: number}>} Image dimensions
 */
function loadImageDimensions(url) {
  return new Promise((resolve, reject) => {
    if (!url || typeof url !== 'string') {
      reject(new Error('Invalid image URL'));
      return;
    }
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

/**
 * Determine the recommended image fit mode for a given image URL.
 * Loads the image to get dimensions, then calculates mismatch.
 *
 * @param {string} url - Image URL
 * @returns {Promise<{shouldContain: boolean, width: number, height: number, mismatch: number}>}
 */
export async function getRecommendedImageFit(url) {
  const { width, height } = await loadImageDimensions(url);
  const imageAspect = width / height;
  const mismatch =
    Math.abs(SLIDE_ASPECT_RATIO - imageAspect) / SLIDE_ASPECT_RATIO;
  const shouldContain = mismatch > ASPECT_MISMATCH_THRESHOLD;
  return { shouldContain, width, height, mismatch };
}

/**
 * Read a file as a data URL
 * @param {File} file - File to read
 * @returns {Promise<string>} Data URL
 */
export const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

/**
 * Check if an item matches a search query
 * @param {Object} item - Image library item
 * @param {string} query - Search query
 * @param {string} activeTag - Active tag filter
 * @returns {boolean} Whether the item matches
 */
export function matchesSearch(item, query, activeTag) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const tags = Array.isArray(item?.tags) ? item.tags : [];
  const alts = item?.alts && typeof item.alts === 'object' ? item.alts : {};

  if (activeTag && !tags.includes(activeTag)) {
    return false;
  }

  if (!q) return true;

  const hay = [
    item?.description,
    item?.photographer,
    item?.url,
    ...tags,
    ...Object.values(alts || {}),
  ]
    .map((x) => String(x || '').toLowerCase())
    .join(' | ');

  return hay.includes(q);
}

/**
 * Get all unique tags from items
 * @param {Array} items - Image library items
 * @returns {Array<string>} Sorted unique tags
 */
export function getAllTags(items) {
  const set = new Set();
  for (const it of items) {
    for (const tg of Array.isArray(it?.tags) ? it.tags : []) {
      const t0 = String(tg || '').trim();
      if (t0) set.add(t0);
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Install autocomplete for tags input
 * @param {HTMLInputElement} inputEl - Input element
 * @param {HTMLDataListElement} datalistEl - Datalist element
 * @param {Function} getTagsFn - Function to get available tags
 * @returns {Function} Cleanup function
 */
export function installTagsAutocomplete(inputEl, datalistEl, getTagsFn) {
  if (!inputEl || !datalistEl) return () => {};

  let prevValue = String(inputEl.value || '');

  const applySelectionIfNeeded = () => {
    const curVal = String(inputEl.value || '');
    const all = getTagsFn();
    if (!all.includes(curVal)) return;
    const prev = String(prevValue || '');
    const idx = prev.lastIndexOf(',');
    if (idx < 0) return;
    const prefix = prev.slice(0, idx + 1) + ' ';
    inputEl.value = `${prefix}${curVal}`;
  };

  const update = () => {
    applySelectionIfNeeded();
    const raw = String(inputEl.value || '');
    const idx = raw.lastIndexOf(',');
    const cur = idx >= 0 ? raw.slice(idx + 1) : raw;
    const q = cur.trim().toLowerCase();

    const all = getTagsFn();
    const filtered = q
      ? all.filter((t0) => String(t0).toLowerCase().startsWith(q))
      : all;

    datalistEl.innerHTML = '';
    for (const tg of filtered.slice(0, 30)) {
      const opt = h('option');
      opt.value = tg;
      datalistEl.append(opt);
    }

    prevValue = String(inputEl.value || '');
  };

  inputEl.addEventListener('input', update);
  update();
  return () => inputEl.removeEventListener('input', update);
}

/**
 * Create a wrapped field label + input
 * @param {string} label - Field label
 * @param {HTMLElement} control - Input control
 * @param {Object} opts - Options
 * @returns {HTMLElement} Field wrapper
 */
export function createFieldWrap(label, control, opts = {}) {
  const helpText = typeof opts?.helpText === 'string' ? opts.helpText : '';
  return h('label', { class: 'stack is-field' }, [
    h('div', { class: 'field-label', text: label }),
    control,
    helpText ? h('div', { class: 'help', text: helpText }) : null,
  ]);
}

/**
 * One alt-text input per enabled deck language.
 *
 * The library is a workspace-level store, so its alt map is keyed by the
 * workspace's enabled subset (`getSupportedLangs()`) rather than by the
 * versions of one deck — D72 #5. Before B182 fase 5 both call sites hardcoded
 * a Dutch and an English input, which is why a workspace running German or
 * Finnish could store `alts.de` through the API but never type one.
 *
 * The returned handle owns the whole set: `fields` renders it, `read()` builds
 * the `alts` payload for the API, `write()` fills it from a response, and
 * `isEmpty()` answers the "no alt text yet" prompts.
 *
 * @param {Object} [opts]
 * @param {boolean} [opts.disabled] - render the inputs read-only
 * @param {boolean} [opts.asPlaceholder] - label inside the input instead of above it
 * @returns {{
 *   langs: string[],
 *   fields: HTMLElement[],
 *   read: () => Record<string, string>,
 *   write: (alts: Object|null|undefined) => void,
 *   isEmpty: () => boolean,
 * }}
 */
export function createAltLangInputs({
  disabled = false,
  asPlaceholder = false,
} = {}) {
  const langs = getSupportedLangs();
  const inputs = new Map();
  const fields = [];

  for (const lang of langs) {
    const label = t('imageLibrary.alt.langLabel', 'Alt text ({lang})', {
      lang: getLangDisplayName(lang),
    });
    const input = h('input', {
      class: 'form-input',
      disabled,
      ...(asPlaceholder ? { placeholder: label } : {}),
    });
    inputs.set(lang, input);
    fields.push(asPlaceholder ? input : createFieldWrap(label, input));
  }

  const valueOf = (lang) => String(inputs.get(lang)?.value || '');

  return {
    langs,
    fields,
    read: () => Object.fromEntries(langs.map((l) => [l, valueOf(l)])),
    write: (alts) => {
      const map = alts && typeof alts === 'object' ? alts : {};
      for (const lang of langs) {
        const input = inputs.get(lang);
        if (input) input.value = String(map?.[lang] || '');
      }
    },
    isEmpty: () => langs.every((l) => !valueOf(l).trim()),
  };
}
