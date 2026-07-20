/**
 * Upload panel for font editor.
 * Shows a grid of weight x style slots for uploading font variants.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { formatFileSize } from '../../../lib/format.js';
import { toast } from '../../../lib/toast.js';

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

const WEIGHT_FALLBACKS = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

/**
 * Translated name for a font weight. Resolved at render time so it follows the
 * active UI locale (the dictionary is not loaded yet at module evaluation).
 * @param {number} value - CSS font weight
 * @returns {string} Weight name
 */
function weightName(value) {
  const fallback = WEIGHT_FALLBACKS[value];
  return fallback ? t(`fonts.weightName.${value}`, fallback) : String(value);
}

/**
 * Create the upload panel.
 * @param {Object} options
 * @param {string} options.familyId - Font family UUID
 * @param {Array} options.variants - Existing variants
 * @param {Function} options.onVariantChange - Callback when variants change
 * @returns {{ el: HTMLElement, setVariants: Function }}
 */
export function createUploadPanel({ familyId, variants = [], onVariantChange }) {
  const el = h('div', { class: 'font-source-panel' });
  let currentVariants = [...variants];

  const grid = h('div', { class: 'font-variant-grid' });

  // Header
  const header = h('div', { class: 'font-variant-grid-header' });
  header.append(
    h('span', { text: t('fonts.weight', 'Weight') }),
    h('span', { text: t('fonts.normal', 'Normal') }),
    h('span', { text: t('fonts.italic', 'Italic') })
  );
  grid.append(header);

  const rowEls = {};

  function findVariant(weight, style) {
    return currentVariants.find((v) => v.weight === weight && v.style === style);
  }

  function renderGrid() {
    // Clear rows (keep header)
    for (const key of Object.keys(rowEls)) {
      rowEls[key].remove();
      delete rowEls[key];
    }

    for (const w of WEIGHTS) {
      const row = h('div', { class: 'font-variant-row' });

      const weightLabel = h('div', { class: 'font-variant-weight', text: `${w}` });
      weightLabel.title = weightName(w);

      const normalCell = createVariantCell(w, 'normal');
      const italicCell = createVariantCell(w, 'italic');

      row.append(weightLabel, normalCell, italicCell);
      grid.append(row);
      rowEls[w] = row;
    }
  }

  function createVariantCell(weight, style) {
    const cell = h('div', { class: 'font-variant-cell' });
    const variant = findVariant(weight, style);

    if (variant) {
      const info = h('span', { class: 'font-variant-filename' });
      const styleLabel = style === 'italic'
        ? t('fonts.italic', 'Italic')
        : t('fonts.normal', 'Normal');
      info.textContent = t('fonts.variantLabel', '{weight} {style}', {
        weight: weightName(weight),
        style: styleLabel,
      });
      if (variant.fileSize) {
        const size = h('span', { class: 'font-variant-size', text: formatFileSize(variant.fileSize) });
        cell.append(info, size);
      } else {
        cell.append(info);
      }

      const deleteBtn = h('button', {
        class: 'btn btn-secondary is-compact is-danger',
        type: 'button',
        text: '\u00D7', // ×
        title: t('fonts.removeVariant', 'Remove variant'),
        onclick: () => handleRemoveVariant(variant.id, weight, style),
      });
      cell.append(deleteBtn);
    } else {
      const uploadBtn = h('button', {
        class: 'btn btn-secondary is-compact',
        type: 'button',
        text: t('fonts.uploadCta', '+ Upload'),
        onclick: () => handleUploadVariant(weight, style),
      });
      cell.append(uploadBtn);
    }

    return cell;
  }

  async function handleUploadVariant(weight, style) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.woff2,.woff';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // Determine format from extension
      const ext = file.name.split('.').pop().toLowerCase();
      const format = ext === 'woff' ? 'woff' : 'woff2';

      // Read as data URL
      const reader = new FileReader();
      reader.onerror = () => {
        console.error('Failed to read font file');
      };
      reader.onload = async () => {
        try {
          const result = await api(`/api/font-families/${familyId}/upload-variant`, {
            method: 'POST',
            body: JSON.stringify({
              dataUrl: reader.result,
              weight,
              style,
              format,
            }),
          });

          currentVariants.push(result);
          renderGrid();
          if (onVariantChange) onVariantChange(currentVariants);
          toast.success(t('fonts.variantUploaded', 'Font variant uploaded.'));
        } catch (err) {
          toast.error(err.message || t('fonts.uploadError', 'Failed to upload font file.'));
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  async function handleRemoveVariant(variantId, weight, style) {
    try {
      await api(`/api/font-families/${familyId}/variants/${variantId}`, {
        method: 'DELETE',
      });

      currentVariants = currentVariants.filter((v) => v.id !== variantId);
      renderGrid();
      if (onVariantChange) onVariantChange(currentVariants);
      toast.success(t('fonts.variantRemoved', 'Font variant removed.'));
    } catch (err) {
      toast.error(err.message || t('fonts.removeError', 'Failed to remove variant.'));
    }
  }

  const hint = h('div', {
    class: 'help',
    text: t('fonts.uploadHint', 'Upload WOFF2 or WOFF font files for each weight and style you need.'),
  });

  el.append(hint, grid);
  renderGrid();

  return {
    el,
    setVariants: (v) => {
      currentVariants = [...v];
      renderGrid();
    },
  };
}
