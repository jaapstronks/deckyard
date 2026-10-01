/**
 * The entry buttons of an image field: "Choose image…" through the picker
 * seam, and "Upload from computer" when the seam has a direct upload route
 * (B579). One builder so every image field offers the same pair.
 */
import { t } from '../../../../lib/ui-i18n.js';
import { h } from '../../../../lib/dom/index.js';

/**
 * @param {Function & {providers?: Array, upload?: Function|null}} openImagePicker - the seam
 * @param {() => Object} pickerOpts - built per click, so the active language is current
 * @returns {HTMLButtonElement[]} nothing when no source is configured
 */
export function createImagePickerButtons(openImagePicker, pickerOpts) {
  if (
    typeof openImagePicker !== 'function' ||
    !openImagePicker.providers?.length
  ) {
    return [];
  }
  const buttons = [
    h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('editor.image.choose', 'Choose image…'),
      onclick: () => openImagePicker(pickerOpts()),
    }),
  ];
  if (typeof openImagePicker.upload === 'function') {
    buttons.push(
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('editor.image.uploadFromComputer', 'Upload from computer'),
        onclick: () => openImagePicker.upload(pickerOpts()),
      }),
    );
  }
  return buttons;
}
