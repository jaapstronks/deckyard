import { iconUrl, resolveIconName } from '../../../../shared/icon-names.js';
import { t } from '../../../lib/ui-i18n.js';
import { openIconPicker } from './icon-picker-modal.js';

export function createIconFields({ h } = {}) {
  /**
   * Render an icon field: a preview + the current name that opens the visual
   * icon picker modal on click.
   *
   * @param {string} label - Field label
   * @param {string} value - Current icon name
   * @param {(name: string) => void} onChange - Called with the chosen icon name
   * @param {Object} [opts]
   * @param {string} [opts.helpText] - Hint shown under the field
   * @returns {HTMLElement}
   */
  const fieldIconPicker = (
    label,
    value,
    onChange,
    { helpText = t('editor.iconPicker.help', 'Pick from the icon library') } = {}
  ) => {
    let current = String(value || '').trim();

    const previewImg = h('img', { class: 'icon-picker-preview-img', alt: '' });
    const previewFallback = h('div', {
      class: 'icon-picker-preview-fallback',
      'aria-hidden': 'true',
    });
    const nameLabel = h('span', { class: 'icon-picker-trigger-name' });

    const setPreview = (name) => {
      const resolved = resolveIconName(name);
      const url = iconUrl(resolved);
      if (url) {
        previewImg.src = url;
        previewImg.style.display = 'block';
        previewFallback.style.display = 'none';
        nameLabel.textContent = resolved;
        nameLabel.classList.remove('is-empty');
      } else {
        previewImg.removeAttribute('src');
        previewImg.style.display = 'none';
        previewFallback.style.display = 'block';
        nameLabel.textContent = t('editor.iconPicker.none', 'No icon');
        nameLabel.classList.add('is-empty');
      }
    };
    setPreview(current);

    const trigger = h(
      'button',
      {
        type: 'button',
        class: 'icon-picker-trigger',
        onclick: () => {
          openIconPicker({
            current,
            onSelect: (name) => {
              current = name;
              setPreview(name);
              onChange(name);
            },
          });
        },
      },
      [
        previewImg,
        previewFallback,
        nameLabel,
        h('span', {
          class: 'icon-picker-trigger-action',
          text: t('editor.iconPicker.change', 'Change'),
        }),
      ]
    );

    // `is-field` keeps the label tight to the control so this lines up with the
    // adjacent text input in a two-column field grid (e.g. Icon next to Title).
    return h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: label }),
      trigger,
      h('div', { class: 'help', text: helpText }),
    ]);
  };

  return { fieldIconPicker };
}
