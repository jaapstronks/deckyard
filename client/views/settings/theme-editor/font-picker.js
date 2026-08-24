/**
 * Font Picker Component
 * Dropdown for selecting from curated fonts and managed (custom) fonts with live preview.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import {
  ensureGoogleFontPreview,
  ensureGoogleFontPreviews,
  ensureManagedFontPreview,
} from '../../../lib/theme/font-assets.js';
import {
  CURATED_FONTS,
  getFontsByCategory as getSharedFontsByCategory,
} from '../../../../shared/theme-fonts.js';

// Group fonts by category (re-export from shared module)
const getFontsByCategory = getSharedFontsByCategory;

const CATEGORY_LABELS = {
  'sans-serif': 'Sans-serif',
  serif: 'Serif',
  display: 'Display',
  monospace: 'Monospace',
};

/**
 * Filter managed fonts by context.
 * - body: only fonts with at least weight 400 + 700 variants
 * - heading: any font (single variant is sufficient)
 */
function filterManagedFonts(managedFonts, context) {
  if (!Array.isArray(managedFonts) || managedFonts.length === 0) return [];
  if (context === 'body') {
    return managedFonts.filter((mf) => {
      if (!Array.isArray(mf.variants) || mf.variants.length === 0) {
        // Non-upload sources (adobe, google, monotype) don't require variant checks
        return mf.source !== 'upload';
      }
      const weights = new Set(mf.variants.map((v) => v.weight));
      return weights.has(400) && weights.has(700);
    });
  }
  // heading or any — show all
  return managedFonts;
}

// Marker value prefix to distinguish managed font selections from curated
const MANAGED_PREFIX = '__managed__';

/**
 * Create a font picker component.
 * @param {Object} options
 * @param {string} options.label - Field label
 * @param {string} options.value - Initial value (font family name)
 * @param {string} [options.familyId] - Initial managed font family ID
 * @param {Array} [options.managedFonts] - Managed font families with variants
 * @param {string} [options.context] - 'heading' | 'body' | 'any' (for filtering)
 * @param {Function} options.onChange - Change callback (fontFamily, familyId)
 * @returns {Object} { el, getValue, setValue, getSource, getFamilyId }
 */
export function createFontPicker({
  label,
  value,
  familyId,
  managedFonts,
  context,
  onChange,
}) {
  const container = h('div', { class: 'theme-font-picker' });

  const labelEl = h('label', { class: 'theme-font-picker-label', text: label });

  const selectWrapper = h('div', { class: 'theme-font-picker-select-wrapper' });

  // Track current selection
  let currentFamilyId = familyId || null;
  let currentSource = null;

  const select = h('select', {
    class: 'form-input theme-font-picker-select',
    onchange: (e) => {
      const raw = e.target.value;
      if (raw.startsWith(MANAGED_PREFIX)) {
        const mfId = raw.slice(MANAGED_PREFIX.length);
        const mf = filteredManaged.find((f) => f.id === mfId);
        if (mf) {
          currentFamilyId = mf.id;
          currentSource = mf.source;
          updatePreview(mf.name);
          ensureManagedFontPreview(mf);
          if (onChange) onChange(mf.name, mf.id);
        }
      } else {
        currentFamilyId = null;
        currentSource = null;
        updatePreview(raw);
        if (onChange) onChange(raw, null);
      }
    },
    onfocus: () => {
      // Load every curated font when the user opens the dropdown — one
      // combined request, not one per family.
      ensureGoogleFontPreviews(CURATED_FONTS.map((f) => f.family));
    },
  });

  // Filter managed fonts by context
  const filteredManaged = filterManagedFonts(managedFonts || [], context);

  // Add managed fonts optgroup (if any)
  if (filteredManaged.length > 0) {
    const managedGroup = h('optgroup', {
      label: t('fonts.customFonts', 'Custom Fonts'),
    });

    for (const mf of filteredManaged) {
      const optValue = `${MANAGED_PREFIX}${mf.id}`;
      const option = h('option', {
        value: optValue,
        text: mf.name,
      });
      option.style.fontFamily = `'${mf.name}', ${mf.category === 'serif' ? 'serif' : mf.category === 'monospace' ? 'monospace' : 'sans-serif'}`;
      if (mf.id === familyId) {
        option.selected = true;
        currentFamilyId = mf.id;
        currentSource = mf.source;
      }
      managedGroup.append(option);
    }

    select.append(managedGroup);
  }

  // Build curated options grouped by category
  const grouped = getFontsByCategory();

  for (const [category, fonts] of Object.entries(grouped)) {
    if (fonts.length === 0) continue;

    const optgroup = h('optgroup', {
      label: CATEGORY_LABELS[category] || category,
    });

    for (const font of fonts) {
      const option = h('option', {
        value: font.family,
        text: font.family,
      });
      option.style.fontFamily = `'${font.family}', ${font.category === 'serif' ? 'serif' : font.category === 'monospace' ? 'monospace' : 'sans-serif'}`;
      // Select if matching and not already selected by managed font
      if (font.family === value && !currentFamilyId) {
        option.selected = true;
      }
      optgroup.append(option);
    }

    select.append(optgroup);
  }

  // Preview text showing the selected font
  const preview = h('div', { class: 'theme-font-picker-preview' });
  preview.textContent = t(
    'common.pangram',
    'The quick brown fox jumps over the lazy dog',
  );

  function updatePreview(fontFamily) {
    ensureGoogleFontPreview(fontFamily);
    preview.style.fontFamily = `'${fontFamily}', sans-serif`;
  }

  // Load and preview initial font
  if (currentFamilyId) {
    const mf = filteredManaged.find((f) => f.id === currentFamilyId);
    if (mf) {
      ensureManagedFontPreview(mf);
      updatePreview(mf.name);
    }
  } else {
    ensureGoogleFontPreview(value);
    updatePreview(value);
  }

  selectWrapper.append(select);
  container.append(labelEl, selectWrapper, preview);

  return {
    el: container,
    getValue: () => {
      const raw = select.value;
      if (raw.startsWith(MANAGED_PREFIX)) {
        const mfId = raw.slice(MANAGED_PREFIX.length);
        const mf = filteredManaged.find((f) => f.id === mfId);
        return mf ? mf.name : value;
      }
      return raw;
    },
    setValue: (v, fId) => {
      if (fId) {
        select.value = `${MANAGED_PREFIX}${fId}`;
        currentFamilyId = fId;
        const mf = filteredManaged.find((f) => f.id === fId);
        if (mf) {
          currentSource = mf.source;
          ensureManagedFontPreview(mf);
          updatePreview(mf.name);
        }
      } else {
        select.value = v;
        currentFamilyId = null;
        currentSource = null;
        updatePreview(v);
      }
    },
    getSource: () => currentSource,
    getFamilyId: () => currentFamilyId,
  };
}
