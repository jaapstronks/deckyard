/**
 * Logo Uploader Component
 * Drag-and-drop or URL input for theme logos.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { uploadImage } from './upload-image.js';

/**
 * Create a logo uploader component.
 * @param {Object} options
 * @param {string} options.value - Initial logo URL
 * @param {Function} options.onChange - Change callback (receives URL)
 * @returns {Object} { el }
 */
export function createLogoUploader({ value, onChange }) {
  const container = h('div', { class: 'theme-logo-uploader' });

  let currentUrl = value || '';
  let uploading = false;

  // Hidden file input
  const fileInput = h('input', {
    type: 'file',
    accept: 'image/*,.svg',
    style: 'display: none',
  });

  // Preview area
  const previewArea = h('div', { class: 'theme-logo-preview-area' });
  const preview = h('div', { class: 'theme-logo-preview' });

  // Dropzone (shown when no logo)
  const dropzone = h('div', { class: 'theme-logo-dropzone' });
  const dropzoneIcon = h('div', { class: 'theme-logo-dropzone-icon' });
  dropzoneIcon.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  const dropzoneText = h('div', {
    class: 'theme-logo-dropzone-text',
    text: t('settings.themes.dropLogoHere', 'Drop logo here or click to upload'),
  });
  const dropzoneHint = h('div', {
    class: 'theme-logo-dropzone-hint help',
    text: t('settings.themes.logoFormats', 'SVG, PNG, or JPG'),
  });
  dropzone.append(dropzoneIcon, dropzoneText, dropzoneHint);

  // Status message
  const status = h('div', { class: 'theme-logo-status help' });

  // Action buttons (shown when logo exists)
  const actions = h('div', { class: 'theme-logo-actions row gap-2' });
  const changeBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('settings.themes.changeLogo', 'Change'),
    onclick: () => fileInput.click(),
  });
  const removeBtn = h('button', {
    class: 'btn btn-danger btn-sm',
    type: 'button',
    text: t('common.remove', 'Remove'),
    onclick: () => {
      currentUrl = '';
      renderState();
      onChange?.('');
    },
  });
  actions.append(changeBtn, removeBtn);

  // URL input (alternative)
  const urlToggle = h('button', {
    class: 'theme-logo-url-toggle',
    type: 'button',
    text: t('settings.themes.useUrl', 'Or use URL'),
  });
  const urlSection = h('div', { class: 'theme-logo-url-section is-hidden' });
  const urlInput = h('input', {
    class: 'input',
    type: 'text',
    placeholder: t('settings.themes.logoUrlPlaceholder', 'https://example.com/logo.svg'),
  });
  const urlApplyBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('common.apply', 'Apply'),
    onclick: () => {
      const url = urlInput.value.trim();
      if (url) {
        currentUrl = url;
        renderState();
        onChange?.(url);
      }
    },
  });
  urlSection.append(urlInput, urlApplyBtn);

  urlToggle.addEventListener('click', () => {
    urlSection.classList.toggle('is-hidden');
    urlToggle.textContent = urlSection.classList.contains('is-hidden')
      ? t('settings.themes.useUrl', 'Or use URL')
      : t('settings.themes.hideUrl', 'Hide URL');
  });

  // Render state
  function renderState() {
    preview.innerHTML = '';
    status.textContent = '';

    if (uploading) {
      preview.classList.add('is-uploading');
      dropzone.classList.add('is-hidden');
      actions.classList.add('is-hidden');
      status.textContent = t('settings.themes.uploading', 'Uploading...');
      return;
    }

    preview.classList.remove('is-uploading');

    if (currentUrl) {
      preview.classList.remove('is-empty');
      dropzone.classList.add('is-hidden');
      actions.classList.remove('is-hidden');

      const img = h('img', {
        src: currentUrl,
        alt: 'Logo',
        onerror: () => {
          preview.innerHTML = '';
          preview.classList.add('is-empty');
          preview.textContent = t('settings.themes.invalidLogo', 'Invalid URL');
        },
      });
      preview.append(img);
    } else {
      preview.classList.add('is-empty');
      dropzone.classList.remove('is-hidden');
      actions.classList.add('is-hidden');
      preview.textContent = t('settings.themes.noLogo', 'No logo');
    }
  }

  // Handle file upload
  async function handleFile(file) {
    if (!file || uploading) return;

    uploading = true;
    renderState();

    try {
      const result = await uploadImage(file);
      currentUrl = result.url;
      onChange?.(result.url);
    } catch (err) {
      status.textContent = String(err?.message || 'Upload failed');
    } finally {
      uploading = false;
      renderState();
    }
  }

  // File input change
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });

  // Dropzone click
  dropzone.addEventListener('click', () => fileInput.click());

  // Drag and drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('is-dragover');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.type.startsWith('image/') || file.name.endsWith('.svg'))) {
      handleFile(file);
    }
  });

  // Assemble
  previewArea.append(preview, dropzone);
  container.append(fileInput, previewArea, status, actions, urlToggle, urlSection);

  // Initial render
  renderState();

  return { el: container };
}
