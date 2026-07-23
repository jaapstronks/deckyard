import { t } from '../../../../lib/ui-i18n.js';
import { createAndPopulateThemeSelect } from '../../../../lib/theme/theme-select.js';
import { analyzeAndApplyThemeChange } from '../change-theme-modal.js';

/**
 * Theme selector. Changing theme runs the analyze-and-apply flow, which may
 * close the modal and navigate. Falls back to a disabled note without an API.
 *
 * @param {object} ctx - {
 *   h, root, pres, api, toast, openOverlayClosers, modal,
 *   onThemeChanged, onNavigateToSlide
 * }
 * @returns {{ el: HTMLElement }}
 */
export function buildThemeSection({
  h,
  root,
  pres,
  api,
  toast,
  openOverlayClosers,
  modal,
  onThemeChanged,
  onNavigateToSlide,
}) {
  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.theme.title', 'Theme'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.theme.help',
      'Visual styling for your presentation. Changing themes may affect some slides.'
    ),
  });

  if (!api) {
    wrap.append(
      label,
      h('div', {
        class: 'help',
        text: t(
          'editor.deckSettings.theme.unavailable',
          'Theme selection is not available.'
        ),
      })
    );
    return { el: wrap };
  }

  const currentTheme = String(pres.themeId || 'deckyard').trim();
  const themeSelector = createAndPopulateThemeSelect({
    h,
    api,
    initialTheme: currentTheme,
    className: '',
    onChange: async (newThemeId) => {
      if (newThemeId === currentTheme) return;

      const result = await analyzeAndApplyThemeChange({
        h,
        root,
        api,
        toast,
        pres,
        presId: pres.id,
        newThemeId,
        openOverlayClosers,
        onNavigateToSlide: (slideIndex) => {
          modal.close();
          onNavigateToSlide?.(slideIndex);
        },
        onThemeChanged: (updatedPres) => {
          pres.themeId = updatedPres.themeId;
          if (Array.isArray(updatedPres.slides)) {
            pres.slides = updatedPres.slides;
          }
          modal.close();
          onThemeChanged?.(updatedPres);
        },
      });

      // If cancelled or same theme, reset selector to current value
      if (!result?.ok) {
        themeSelector.setTheme(pres.themeId || 'deckyard');
      }
    },
  });
  wrap.append(label, themeSelector.select, help);
  return { el: wrap };
}
