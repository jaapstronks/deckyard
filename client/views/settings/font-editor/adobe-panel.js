/**
 * Adobe Fonts (Typekit) panel for font editor.
 * Allows discovering and importing fonts from an Adobe Fonts project.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { api } from '../../../lib/api.js';
import { toast } from '../../../lib/toast.js';

/**
 * Create the Adobe Fonts panel.
 * @param {Object} options
 * @param {Object} options.sourceConfig - Current source_config (may have projectId)
 * @param {Function} options.onImport - Called when a family is imported
 * @returns {{ el: HTMLElement }}
 */
export function createAdobePanel({ sourceConfig = {}, onImport }) {
  const el = h('div', { class: 'font-source-panel' });

  const desc = h('p', {
    class: 'help',
    text: t(
      'fonts.adobeHelp',
      'Enter your Adobe Fonts (Typekit) project ID to discover available fonts. You can find it at fonts.adobe.com/my_fonts > Web Projects.'
    ),
  });

  const inputRow = h('div', { class: 'row gap-2', style: 'align-items: flex-end;' });

  const fieldWrap = h('div', { class: 'stack', style: 'flex: 1;' });
  const label = h('label', {
    class: 'field-label',
    text: t('fonts.adobeProjectId', 'Project ID'),
  });
  const input = h('input', {
    class: 'input',
    type: 'text',
    placeholder: 'abc1def',
    value: sourceConfig.projectId || '',
    maxlength: '12',
  });
  fieldWrap.append(label, input);

  const discoverBtn = h('button', {
    class: 'btn btn-secondary',
    type: 'button',
    text: t('fonts.discover', 'Discover Fonts'),
  });
  inputRow.append(fieldWrap, discoverBtn);

  const resultsContainer = h('div', { class: 'font-discover-results' });

  discoverBtn.addEventListener('click', async () => {
    const projectId = input.value.trim();
    if (!projectId) {
      toast.error(t('fonts.adobeProjectRequired', 'Please enter a project ID.'));
      return;
    }

    discoverBtn.disabled = true;
    discoverBtn.textContent = t('fonts.discovering', 'Discovering...');
    resultsContainer.innerHTML = '';

    try {
      const result = await api('/api/font-families/discover-adobe', {
        method: 'POST',
        body: JSON.stringify({ projectId }),
      });

      if (!result.families || result.families.length === 0) {
        resultsContainer.append(
          h('div', { class: 'help', text: t('fonts.noFontsFound', 'No font families found in this project.') })
        );
        return;
      }

      for (const family of result.families) {
        const row = h('div', { class: 'font-discover-family' });

        const info = h('div', { class: 'font-discover-family-info' });
        info.append(
          h('div', { class: 'font-discover-family-name', text: family.name }),
          h('div', {
            class: 'font-discover-family-variants',
            text: `${family.variants.length} variant${family.variants.length !== 1 ? 's' : ''}: ${family.variants.map((v) => `${v.weight}${v.style === 'italic' ? 'i' : ''}`).join(', ')}`,
          })
        );

        const importBtn = h('button', {
          class: 'btn btn-primary is-compact',
          type: 'button',
          text: t('fonts.import', 'Import'),
        });

        importBtn.addEventListener('click', async () => {
          importBtn.disabled = true;
          importBtn.textContent = t('fonts.importing', 'Importing...');
          try {
            const imported = await api('/api/font-families/import-adobe-family', {
              method: 'POST',
              body: JSON.stringify({
                projectId,
                familyName: family.name,
                category: 'sans-serif',
                variants: family.variants,
              }),
            });
            toast.success(t('fonts.importSuccess', `Imported "${family.name}".`));
            importBtn.textContent = t('fonts.imported', 'Imported');
            if (onImport) onImport(imported);
          } catch (err) {
            toast.error(err.message || t('fonts.importError', 'Failed to import font.'));
            importBtn.disabled = false;
            importBtn.textContent = t('fonts.import', 'Import');
          }
        });

        row.append(info, importBtn);
        resultsContainer.append(row);
      }
    } catch (err) {
      toast.error(err.message || t('fonts.discoverError', 'Failed to discover fonts.'));
    } finally {
      discoverBtn.disabled = false;
      discoverBtn.textContent = t('fonts.discover', 'Discover Fonts');
    }
  });

  el.append(desc, inputRow, resultsContainer);
  return { el };
}
