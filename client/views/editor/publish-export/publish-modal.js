import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { toast } from '../../../lib/dom/toast.js';

export function openPublishModal({
  h,
  api,
  pres,
  id,
  root,
  openOverlayClosers,
  lockDocumentScroll,
  copyToClipboard,
  syncPublishUi,
  currentLang,
  otherLang: otherLangCode,
  url,
  urlOther,
  embedUrl,
  embedUrlOther,
  iframeSnippet,
  iframeSnippetOther,
  sdkSnippet,
  sdkSnippetOther,
} = {}) {
  if (!root) {
    // Back-compat (shouldn't happen in the editor): just open the public URL.
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', {
    class: 'modal publish-modal',
  });

  const unlockScroll = lockDocumentScroll();
  let closed = false;
  const onDocKeyDown = (e) => {
    if (e.key === 'Escape') close();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    unlockScroll();
    document.removeEventListener('keydown', onDocKeyDown);
    openOverlayClosers?.delete?.(close);
    backdrop.remove();
  };
  openOverlayClosers?.add?.(close);

  const header = h('div', {
    class: 'row spread',
  });
  header.append(
    h('h2', { text: t('editor.publishModal.title', 'Published') }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    })
  );

  const topHelp = h('div', {
    class: 'help publish-top-help',
    text: t(
      'editor.publishModal.help',
      'Copy the public link or embed code below. Tip: the public link is already on your clipboard.'
    ),
  });

  const previewRow = (() => {
    const publishId =
      typeof pres?.published?.id === 'string' ? pres.published.id : '';
    if (!publishId) return h('div', { hidden: true });

    const currentOgUrl =
      typeof pres?.published?.ogImageUrl === 'string' ? pres.published.ogImageUrl : '';

    const wrap = h('div', { class: 'publish-field' });
    const head = h('div', { class: 'publish-field-head' });

    const status = h('div', {
      class: 'help publish-field-status',
    });
    status.textContent = currentOgUrl
      ? t('editor.publishModal.previewHint', 'Preview image is generated from your first slide.')
      : t('editor.publishModal.previewHintDefault', 'A default preview image is used.');

    const refreshBtn = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('editor.publishModal.refreshPreview', 'Refresh preview'),
      onclick: async function () {
        this.disabled = true;
        this.textContent = t('editor.publishModal.generating', 'Generating...');
        status.textContent = '';
        try {
          const resp = await api(
            `/api/presentations/${id}/preview/regenerate`,
            { method: 'POST' }
          );
          pres.published = pres.published || {};
          pres.published.ogImageUrl = resp.ogImageUrl || '';
          status.textContent = t('editor.publishModal.previewUpdated', 'Preview updated.');
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
              style: 'max-width: 240px; height: auto; border-radius: 4px; border: 1px solid var(--color-border, #ddd); cursor: pointer;',
            });
            link.append(img);
            container.append(link);
          }
        } catch (e) {
          status.textContent = String(e?.message || e);
        } finally {
          this.disabled = false;
          this.textContent = t('editor.publishModal.refreshPreview', 'Refresh preview');
        }
      },
    });

    head.append(
      h('div', { class: 'publish-field-label', text: t('editor.publishModal.ogPreview', 'Social preview') }),
      h('div', { class: 'publish-field-actions' }, [refreshBtn])
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
        style: 'max-width: 240px; height: auto; border-radius: 4px; border: 1px solid var(--color-border, #ddd); cursor: pointer;',
      });
      link.append(img);
      previewContainer.append(link);
    } else {
      previewContainer.append(h('div', {
        class: 'preview-placeholder',
        text: t('editor.publishModal.noPreviewYet', 'No preview image yet'),
        style: 'width: 240px; height: 126px; display: flex; align-items: center; justify-content: center; background: var(--color-bg-muted, #f5f5f5); border-radius: 4px; border: 1px dashed var(--color-border, #ddd); font-size: 12px; color: var(--color-text-muted, #666);',
      }));
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
      h('div', { class: 'publish-field-label', text: t('editor.publishModal.slug', 'Slug') }),
      h('div', { class: 'publish-field-actions' }, [
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('common.save', 'Save'),
          onclick: async () => {
            try {
              const resp = await api(
                `/api/presentations/${id}/publish/slug`,
                {
                  method: 'PATCH',
                  body: JSON.stringify({ slug: input.value }),
                }
              );
              pres.published = pres.published || {};
              pres.published.slug = resp.slug;
              status.textContent = t('editor.publishModal.saved', 'Saved.');
              input.value = resp.slug;
            } catch (e) {
              status.textContent = String(e?.message || e);
            }
          },
        }),
      ])
    );
    const input = h('input', {
      class: 'form-input publish-field-input',
      value: currentSlug,
      placeholder: t('editor.publishModal.slugPlaceholder', 'e.g. my-presentation'),
    });
    const status = h('div', {
      class: 'help publish-field-status',
      text:
        t(
          'editor.publishModal.slugHint',
          'Tip: existing links will keep working (they redirect to the new slug).'
        ),
    });
    wrap.append(head, input, status);
    return wrap;
  })();

  const dangerRow = (() => {
    const publishId =
      typeof pres?.published?.id === 'string' ? pres.published.id : '';
    if (!publishId) return h('div', { hidden: true });
    return h('div', { class: 'publish-field' }, [
      h('div', { class: 'publish-field-head' }, [
        h('div', { class: 'publish-field-label', text: t('editor.publishModal.publication', 'Publication') }),
      ]),
      h('div', { class: 'help', text: t('editor.publishModal.unpublishHint', 'You can also unpublish later.') }),
      h(
        'div',
        {
          class: 'row is-end',
        },
        [
          h('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: t('editor.publish.unpublish', 'Unpublish'),
            onclick: async () => {
              const ok = await confirmModal(h, root, {
                title: t('editor.publish.unpublish', 'Unpublish'),
                message: t(
                  'editor.publish.unpublish.confirm',
                  'Unpublish?\n\nThis will invalidate the public link and embed links. Anyone with a shared /p/ or /embed/ link will no longer be able to open the presentation.\n\nIf you use this link in a website, invite, follow-along, notes/QR or other tooling, it will stop working there too.'
                ),
                confirmLabel: t('editor.publish.unpublish', 'Unpublish'),
                danger: true,
              });
              if (!ok) return;
              try {
                await api(`/api/presentations/${id}/publish`, {
                  method: 'DELETE',
                });
                delete pres.published;
                syncPublishUi?.();
                close();
              } catch (e) {
                toast.error(String(e?.message || e));
              }
            },
          }),
        ]
      ),
    ]);
  })();

  const langLabel = currentLang === 'nl' ? 'NL' : 'EN';
  const otherLabel =
    otherLangCode === 'nl' ? 'NL' : otherLangCode === 'en-GB' ? 'EN' : '';

  const makeRow = ({ label, value, openHref, kind = 'input' } = {}) => {
    const wrap = h('div', { class: 'publish-row' });
    const labelEl = h('div', { class: 'publish-row-label', text: label });

    const status = h('div', {
      class: 'help publish-row-status',
    });
    status.hidden = true;

    let fieldEl = null;
    if (kind === 'textarea') {
      const ta = h('textarea', {
        class: 'form-input publish-row-input publish-row-textarea',
        readonly: true,
      });
      ta.value = String(value ?? '');
      fieldEl = ta;
    } else {
      fieldEl = h('input', {
        class: 'form-input publish-row-input',
        readonly: true,
        value: String(value ?? ''),
      });
    }

    const showStatus = (msg) => {
      const m = String(msg || '').trim();
      status.textContent = m;
      status.hidden = !m;
      if (!m) return;
      clearTimeout(showStatus._t);
      showStatus._t = setTimeout(() => {
        status.textContent = '';
        status.hidden = true;
      }, 1500);
    };

    const actions = h('div', { class: 'publish-row-actions' });
    actions.append(
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('common.copy', 'Copy'),
        onclick: async () => {
          const ok = await copyToClipboard(value);
          showStatus(
            ok
              ? t('common.copied', 'Copied')
              : t('common.copyFailed', 'Copy failed (select and copy manually).')
          );
          try {
            fieldEl.focus?.();
            fieldEl.select?.();
          } catch {
            // ignore
          }
        },
      })
    );
    if (openHref) {
      actions.append(
        h('a', {
          class: 'btn btn-secondary',
          href: openHref,
          target: '_blank',
          rel: 'noopener noreferrer',
          text: t('common.open', 'Open'),
        })
      );
    }

    const mainRow = h('div', { class: 'publish-row-main' });
    mainRow.append(labelEl, fieldEl, actions);

    wrap.append(mainRow, status);
    return wrap;
  };

  const makeLangSection = ({
    langShort,
    urlVal,
    embedUrlVal,
    iframeVal,
    sdkVal,
    showAdvanced = false,
  } = {}) => {
    const section = h('div', { class: 'publish-lang' });
    section.append(h('div', { class: 'publish-lang-title', text: langShort }));
    section.append(
      makeRow({ label: `Link (${langShort})`, value: urlVal, openHref: urlVal }),
      makeRow({ label: `Embed URL (${langShort})`, value: embedUrlVal })
    );

    if (showAdvanced) {
      section.append(
        makeRow({ label: `Iframe (${langShort})`, value: iframeVal, kind: 'textarea' }),
        makeRow({ label: `SDK (${langShort})`, value: sdkVal, kind: 'textarea' })
      );
    }
    return section;
  };

  const main = h('div', { class: 'publish-sections' });
  main.append(
    makeLangSection({
      langShort: langLabel,
      urlVal: url,
      embedUrlVal: embedUrl,
      iframeVal: iframeSnippet,
      sdkVal: sdkSnippet,
      showAdvanced: false,
    })
  );
  if (urlOther) {
    main.append(
      makeLangSection({
        langShort: otherLabel || '—',
        urlVal: urlOther,
        embedUrlVal: embedUrlOther,
        iframeVal: iframeSnippetOther,
        sdkVal: sdkSnippetOther,
        showAdvanced: false,
      })
    );
  }

  const advanced = h('details', { class: 'publish-advanced' });
  advanced.append(
    h('summary', {
      class: 'publish-advanced-summary',
      text: t('editor.publish.advanced', 'Advanced (iframe / SDK)'),
    })
  );
  const advBody = h('div', { class: 'publish-advanced-body' });
  advBody.append(
    makeLangSection({
      langShort: langLabel,
      urlVal: url,
      embedUrlVal: embedUrl,
      iframeVal: iframeSnippet,
      sdkVal: sdkSnippet,
      showAdvanced: true,
    })
  );
  if (urlOther) {
    advBody.append(
      makeLangSection({
        langShort: otherLabel || '—',
        urlVal: urlOther,
        embedUrlVal: embedUrlOther,
        iframeVal: iframeSnippetOther,
        sdkVal: sdkSnippetOther,
        showAdvanced: true,
      })
    );
  }
  advanced.append(advBody);

  const grid = h('div', { class: 'publish-grid' }, [main, advanced]);

  // Put "Publicatie" controls at the top (most important + potentially destructive),
  // then preview, then the slug, then the link guidance + link sections.
  modal.append(header, dangerRow, previewRow, slugRow, topHelp, grid);
  backdrop.append(modal);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  // Bound for the modal's lifetime and removed in close(). It used to be a
  // `{ once: true }` listener, which any keystroke consumed — so Escape stopped
  // closing the modal as soon as the user typed in the slug field, and the
  // handler lingered on document until some unrelated key press disarmed it.
  document.addEventListener('keydown', onDocKeyDown);
  root.append(backdrop);

  // Convenience: copy the public URL on open, but never block the UI if it fails.
  copyToClipboard(url).catch(() => {});
}
