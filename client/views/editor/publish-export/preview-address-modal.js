import { t } from '../../../lib/ui-i18n.js';
import { createModal } from '../../../lib/dom/modal.js';
import { h } from '../../../lib/dom.js';

/**
 * Manage what a published deck's page looks like and where it lives: the
 * social preview image and the slug.
 *
 * The links themselves are not here: they have one place, the Share dialog's
 * Public tab (B342). This modal used to repeat them per language, with the
 * embed URL and snippets under "Advanced", which is where the embed got lost.
 *
 * @param {Object} opts
 * @param {Function} opts.api - API call function
 * @param {Object} opts.pres - the deck; must be published
 * @param {string} opts.id - the deck id
 * @param {HTMLElement} opts.root - element to append the modal to
 * @param {Function} opts.lockDocumentScroll - locks document scroll
 * @param {Function} [opts.onChange] - called after the slug changed, so the
 *   links on the Public tab follow
 */
export function openPreviewAddressModal({
  api,
  pres,
  id,
  root,
  lockDocumentScroll,
  onChange,
} = {}) {
  if (!root) return;

  const unlockScroll = lockDocumentScroll();

  const modal = createModal({
    title: t('editor.publishModal.title', 'Preview and address'),
    modalClass: 'publish-modal',
    onClose: () => unlockScroll(),
  });

  const previewRow = (() => {
    const publishId =
      typeof pres?.published?.id === 'string' ? pres.published.id : '';
    if (!publishId) return h('div', { hidden: true });

    const currentOgUrl =
      typeof pres?.published?.ogImageUrl === 'string'
        ? pres.published.ogImageUrl
        : '';

    const wrap = h('div', { class: 'publish-field' });
    const head = h('div', { class: 'publish-field-head' });

    const status = h('div', {
      class: 'help publish-field-status',
    });
    status.textContent = currentOgUrl
      ? t(
          'editor.publishModal.previewHint',
          'Preview image is generated from your first slide.',
        )
      : t(
          'editor.publishModal.previewHintDefault',
          'A default preview image is used.',
        );

    const refreshBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('editor.publishModal.refreshPreview', 'Refresh preview'),
      onclick: async function () {
        this.disabled = true;
        this.textContent = t('editor.publishModal.generating', 'Generating…');
        status.textContent = '';
        try {
          const resp = await api(
            `/api/presentations/${id}/preview/regenerate`,
            { method: 'POST' },
          );
          pres.published = pres.published || {};
          pres.published.ogImageUrl = resp.ogImageUrl || '';
          status.textContent = t(
            'editor.publishModal.previewUpdated',
            'Preview updated.',
          );
          // Update the thumbnail if it exists
          const container = wrap.querySelector('.publish-preview-container');
          if (container && resp.ogImageUrl) {
            container.innerHTML = '';
            const link = h('a', {
              class: 'preview-thumb-link',
              href: resp.ogImageUrl,
              target: '_blank',
              rel: 'noopener noreferrer',
              style: 'display: inline-block;',
            });
            const img = h('img', {
              class: 'preview-thumb',
              src: resp.ogImageUrl,
              alt: t('editor.publishModal.previewAlt', 'Social preview image'),
              style:
                'max-width: 240px; height: auto; border-radius: 4px; border: 1px solid var(--color-border, #ddd); cursor: pointer;',
            });
            link.append(img);
            container.append(link);
          }
        } catch (e) {
          status.textContent = String(e?.message || e);
        } finally {
          this.disabled = false;
          this.textContent = t(
            'editor.publishModal.refreshPreview',
            'Refresh preview',
          );
        }
      },
    });

    head.append(
      h('div', {
        class: 'publish-field-label',
        text: t('editor.publishModal.ogPreview', 'Social preview'),
      }),
      h('div', { class: 'publish-field-actions' }, [refreshBtn]),
    );

    // Show the current OG image as a clickable thumbnail
    const previewContainer = h('div', {
      class: 'publish-preview-container',
      style: 'margin-top: 8px;',
    });
    if (currentOgUrl) {
      const link = h('a', {
        class: 'preview-thumb-link',
        href: currentOgUrl,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: 'display: inline-block;',
      });
      const img = h('img', {
        class: 'preview-thumb',
        src: currentOgUrl,
        alt: t('editor.publishModal.previewAlt', 'Social preview image'),
        style:
          'max-width: 240px; height: auto; border-radius: 4px; border: 1px solid var(--color-border, #ddd); cursor: pointer;',
      });
      link.append(img);
      previewContainer.append(link);
    } else {
      previewContainer.append(
        h('div', {
          class: 'preview-placeholder',
          text: t('editor.publishModal.noPreviewYet', 'No preview image yet'),
          style:
            'width: 240px; height: 126px; display: flex; align-items: center; justify-content: center; background: var(--color-bg-muted, #f5f5f5); border-radius: 4px; border: 1px dashed var(--color-border, #ddd); font-size: 12px; color: var(--color-text-muted, #666);',
        }),
      );
    }

    wrap.append(head, previewContainer, status);
    return wrap;
  })();

  const slugRow = (() => {
    const currentSlug =
      typeof pres?.published?.slug === 'string' ? pres.published.slug : '';
    const publishId =
      typeof pres?.published?.id === 'string' ? pres.published.id : '';
    if (!publishId) return h('div', { hidden: true });

    const wrap = h('div', { class: 'publish-field' });
    const head = h('div', { class: 'publish-field-head' });
    head.append(
      h('div', {
        class: 'publish-field-label',
        text: t('editor.publishModal.slug', 'Slug'),
      }),
      h('div', { class: 'publish-field-actions' }, [
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('common.save', 'Save'),
          onclick: async () => {
            try {
              const resp = await api(`/api/presentations/${id}/publish/slug`, {
                method: 'PATCH',
                body: { slug: input.value },
              });
              pres.published = pres.published || {};
              pres.published.slug = resp.slug;
              status.textContent = t('editor.publishModal.saved', 'Saved.');
              input.value = resp.slug;
              onChange?.();
            } catch (e) {
              status.textContent = String(e?.message || e);
            }
          },
        }),
      ]),
    );
    const input = h('input', {
      class: 'form-input publish-field-input',
      value: currentSlug,
      placeholder: t(
        'editor.publishModal.slugPlaceholder',
        'e.g. my-presentation',
      ),
    });
    const status = h('div', {
      class: 'help publish-field-status',
      text: t(
        'editor.publishModal.slugHint',
        'Tip: existing links will keep working (they redirect to the new slug).',
      ),
    });
    wrap.append(head, input, status);
    return wrap;
  })();

  modal.append(previewRow, slugRow);
  modal.show(root);
}
