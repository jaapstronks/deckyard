/**
 * Version Preview Modal
 * Shows slide thumbnails from a snapshot version
 */

import { createModal } from '../../../lib/modal.js';
import { renderSlideElement } from '../../../lib/slide-render.js';
import { fmtDate } from '../../../lib/format.js';
import { t } from '../../../lib/ui-i18n.js';

/**
 * Opens a modal showing slide thumbnails for a version.
 * @param {Object} options
 * @param {Function} options.h - DOM element factory
 * @param {HTMLElement} options.root - Root element for modal
 * @param {Function} options.api - API function
 * @param {string} options.presentationId - Presentation ID
 * @param {Object} options.version - Version metadata
 * @param {Object} options.theme - Theme for rendering
 * @param {Set} options.openOverlayClosers - Overlay closers set
 */
export function openVersionPreviewModal({
  h,
  root,
  api,
  presentationId,
  version,
  theme,
  openOverlayClosers,
} = {}) {
  const versionDate = fmtDate(version?.created);
  const versionLabel = version?.label || '';
  const titleText = versionLabel
    ? `${versionLabel} (${versionDate})`
    : t('editor.versions.preview.title', 'Preview: {date}', { date: versionDate });

  const modal = createModal(h, {
    title: titleText,
    modalClass: 'modal-wide',
    closeOnBackdrop: true,
  });

  const status = h('div', { class: 'help modal-status', text: t('common.loading', 'Loading…') });
  const grid = h('div', { class: 'version-preview-grid' });

  modal.content.append(status, grid);
  modal.show(root, openOverlayClosers);

  // Load version data
  loadVersionData();

  async function loadVersionData() {
    try {
      const versionData = await api(
        `/api/presentations/${presentationId}/versions/${version.id}`
      );
      const slides = versionData?.presentation?.slides || [];

      if (!slides.length) {
        status.textContent = t('editor.versions.preview.noSlides', 'No slides in this version.');
        return;
      }

      status.textContent = t('editor.versions.preview.slideCount', '{count} slides', {
        count: slides.length,
      });

      // Render slide thumbnails
      for (let i = 0; i < slides.length; i++) {
        const slide = slides[i];
        const item = h('div', { class: 'version-preview-item' });

        const thumb = h('div', { class: 'version-preview-thumb' });
        try {
          const slideEl = renderSlideElement(slide, {
            mode: 'thumb',
            theme,
            presentationId,
          });
          thumb.append(slideEl);
        } catch {
          thumb.textContent = t('editor.versions.preview.renderError', 'Could not render');
        }

        const label = h('div', {
          class: 'version-preview-label',
          text: `${i + 1}`,
        });

        item.append(thumb, label);
        grid.append(item);
      }
    } catch (e) {
      status.textContent = String(e?.message || e);
    }
  }

  return modal;
}
