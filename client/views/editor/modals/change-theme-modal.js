/**
 * Change Theme Modal
 *
 * Displays warnings when changing themes affects slides and provides options:
 * - Review slides first
 * - Export backup
 * - Convert compatible slides
 * - Proceed anyway
 */

import { createPromiseModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Open the change theme warning modal.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Root element to append modal to
 * @param {Function} options.api - API fetch function
 * @param {Function} options.toast - Toast notification function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.presId - Presentation ID
 * @param {Object} options.analysis - Result from analyze-theme-change endpoint
 * @param {Set} [options.openOverlayClosers] - Set of overlay closers
 * @param {Function} [options.onNavigateToSlide] - Called when user wants to review a slide
 * @param {Function} [options.onThemeChanged] - Called after theme is successfully changed
 * @returns {Promise<{ ok: boolean }>}
 */
export function openChangeThemeModal({
  h,
  root,
  api,
  toast,
  pres,
  presId,
  analysis,
  openOverlayClosers,
  onNavigateToSlide,
  onThemeChanged,
} = {}) {
  const { problematicSlides, newTheme, newThemeLabel } = analysis;
  const slideCount = problematicSlides.length;

  const modal = createPromiseModal(h, {
    title: t('editor.changeTheme.warningTitle', '{count} slides may be affected', {
      count: String(slideCount),
    }),
    hint: t(
      'editor.changeTheme.warningHint',
      'These slides use features that work differently in the new theme.'
    ),
    closeOnBackdrop: false,
    onClose: (result) => result,
  });

  // State
  let selectedAction = 'proceed';
  let isApplying = false;

  // Slides list
  const slidesList = h('div', { class: 'change-theme-slides-list' });

  for (const slide of problematicSlides) {
    const slideItem = h('div', { class: 'change-theme-slide-item' });

    const slideInfo = h('div', { class: 'change-theme-slide-info' });
    const slideNum = h('span', {
      class: 'change-theme-slide-num',
      text: `${slide.index + 1}`,
    });
    const slideTitle = h('span', {
      class: 'change-theme-slide-title',
      text: slide.title || `Slide ${slide.index + 1}`,
    });
    slideInfo.append(slideNum, slideTitle);

    const reasonText =
      slide.reason === 'theme_specific'
        ? t('editor.changeTheme.reasonThemeSpecific', 'Theme-specific slide type')
        : t('editor.changeTheme.reasonWillBeHidden', 'Hidden in new theme');
    const reasonBadge = h('span', {
      class: `change-theme-reason change-theme-reason-${slide.reason}`,
      text: reasonText,
    });

    slideItem.append(slideInfo, reasonBadge);
    slidesList.append(slideItem);
  }

  // Options
  const optionsContainer = h('div', { class: 'change-theme-options' });

  const options = [
    {
      id: 'review',
      label: t('editor.changeTheme.optionReview', 'Review slides first'),
      description: t(
        'editor.changeTheme.optionReviewDesc',
        'Close this modal and navigate to the first affected slide'
      ),
    },
    {
      id: 'export',
      label: t('editor.changeTheme.optionExport', 'Export backup first'),
      description: t(
        'editor.changeTheme.optionExportDesc',
        'Download presentation as JSON before making changes'
      ),
    },
  ];

  // Only show convert option if any slides can be converted
  const convertibleSlides = problematicSlides.filter(
    (s) => Array.isArray(s.convertibleTo) && s.convertibleTo.length > 0
  );
  if (convertibleSlides.length > 0) {
    options.push({
      id: 'convert',
      label: t('editor.changeTheme.optionConvert', 'Convert {count} compatible slides', {
        count: String(convertibleSlides.length),
      }),
      description: t(
        'editor.changeTheme.optionConvertDesc',
        'Automatically convert slides to compatible types and change theme'
      ),
    });
  }

  options.push({
    id: 'proceed',
    label: t('editor.changeTheme.optionProceed', 'Proceed anyway'),
    description: t(
      'editor.changeTheme.optionProceedDesc',
      'Change theme without converting slides (they may look different)'
    ),
  });

  for (const opt of options) {
    const optionRow = h('label', { class: 'change-theme-option' });
    const radio = h('input', {
      type: 'radio',
      name: 'change-theme-action',
      value: opt.id,
    });
    radio.checked = opt.id === selectedAction;
    radio.addEventListener('change', () => {
      if (radio.checked) selectedAction = opt.id;
    });

    const optionText = h('div', { class: 'change-theme-option-text' });
    const optionLabel = h('div', { class: 'change-theme-option-label', text: opt.label });
    const optionDesc = h('div', { class: 'change-theme-option-desc help', text: opt.description });
    optionText.append(optionLabel, optionDesc);

    optionRow.append(radio, optionText);
    optionsContainer.append(optionRow);
  }

  // Buttons
  const btnRow = h('div', { class: 'row is-end is-mt-8' });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.close({ ok: false }),
  });

  const btnApply = h('button', {
    class: 'btn btn-primary',
    text: t('editor.changeTheme.apply', 'Apply'),
    onclick: () => handleApply(),
  });

  btnRow.append(btnCancel, btnApply);

  modal.content.append(slidesList, optionsContainer, btnRow);

  /**
   * Handle the apply button click based on selected action
   */
  async function handleApply() {
    if (isApplying) return;
    isApplying = true;
    btnApply.disabled = true;
    btnCancel.disabled = true;

    try {
      switch (selectedAction) {
        case 'review':
          // Navigate to first affected slide
          if (problematicSlides.length > 0) {
            onNavigateToSlide?.(problematicSlides[0].index);
          }
          modal.close({ ok: false, action: 'review' });
          return;

        case 'export':
          // Export presentation as JSON
          await exportPresentation();
          // Don't close - let user decide what to do next
          isApplying = false;
          btnApply.disabled = false;
          btnCancel.disabled = false;
          toast?.(t('editor.changeTheme.exported', 'Backup downloaded'));
          return;

        case 'convert':
          // Convert compatible slides and change theme
          await applyThemeChange(true);
          break;

        case 'proceed':
          // Just change theme without conversions
          await applyThemeChange(false);
          break;
      }
    } catch (err) {
      console.error('[change-theme] Error:', err);
      toast?.(t('editor.changeTheme.error', 'Failed to change theme'));
      isApplying = false;
      btnApply.disabled = false;
      btnCancel.disabled = false;
    }
  }

  /**
   * Export the presentation as JSON
   */
  async function exportPresentation() {
    const exportUrl = `/api/presentations/${presId}?format=json`;
    const resp = await api(exportUrl);
    const blob = new Blob([JSON.stringify(resp, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pres.title || 'presentation'}-backup.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Apply the theme change
   * @param {boolean} convertCompatible - Whether to convert compatible slides
   */
  async function applyThemeChange(convertCompatible) {
    const body = {
      newThemeId: newTheme,
    };

    if (convertCompatible && convertibleSlides.length > 0) {
      // Convert each slide to its first convertible type
      body.convertSlides = convertibleSlides.map((s) => ({
        slideId: s.id,
        convertTo: s.convertibleTo[0], // Use first available conversion
      }));
    }

    const result = await api(`/api/presentations/${presId}/change-theme`, {
      method: 'POST',
      body,
    });

    if (result?.success) {
      toast?.(t('editor.changeTheme.success', 'Theme changed successfully'));
      onThemeChanged?.(result.presentation);
      modal.close({ ok: true, presentation: result.presentation });
    } else {
      throw new Error(result?.error || t('common.unknownError', 'Unknown error'));
    }
  }

  modal.show(root, openOverlayClosers);
  return modal.promise;
}

/**
 * Analyze and apply theme change, showing modal only if there are problems.
 *
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Root element
 * @param {Function} options.api - API fetch function
 * @param {Function} options.toast - Toast notification function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.presId - Presentation ID
 * @param {string} options.newThemeId - New theme ID to apply
 * @param {Set} [options.openOverlayClosers] - Set of overlay closers
 * @param {Function} [options.onNavigateToSlide] - Called when user wants to review a slide
 * @param {Function} [options.onThemeChanged] - Called after theme is successfully changed
 * @returns {Promise<{ ok: boolean }>}
 */
export async function analyzeAndApplyThemeChange({
  h,
  root,
  api,
  toast,
  pres,
  presId,
  newThemeId,
  openOverlayClosers,
  onNavigateToSlide,
  onThemeChanged,
} = {}) {
  // Skip if same theme
  const currentThemeId = String(pres.themeId || 'deckyard').trim();
  if (currentThemeId === newThemeId) {
    return { ok: false, reason: 'same_theme' };
  }

  // Analyze the theme change
  const analysis = await api(`/api/presentations/${presId}/analyze-theme-change`, {
    method: 'POST',
    body: { newThemeId },
  });

  if (analysis.compatible) {
    // No problems, apply directly
    const result = await api(`/api/presentations/${presId}/change-theme`, {
      method: 'POST',
      body: { newThemeId },
    });

    if (result?.success) {
      toast?.(t('editor.changeTheme.success', 'Theme changed successfully'));
      onThemeChanged?.(result.presentation);
      return { ok: true, presentation: result.presentation };
    } else {
      toast?.(t('editor.changeTheme.error', 'Failed to change theme'));
      return { ok: false, error: result?.error };
    }
  }

  // Show warning modal
  return openChangeThemeModal({
    h,
    root,
    api,
    toast,
    pres,
    presId,
    analysis,
    openOverlayClosers,
    onNavigateToSlide,
    onThemeChanged,
  });
}
