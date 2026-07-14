import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { readFileAsDataUrl, getAllTags, installTagsAutocomplete, createFieldWrap } from './utils.js';

/**
 * Creates the image library detail view component
 * @param {Object} options - Component options
 * @returns {Object} Detail component API
 */
export function createImageLibraryDetail({
  h,
  api,
  user,
  items,
  canAiAlt,
  context,
  onPick,
  onClose,
  onItemUpdated,
  onItemDeleted,
  onToggleFavorite = null,
  allowCaptionCredit,
  creditCb,
  setStatus,
  setBusy,
} = {}) {
  const detailWrap = h('div', { class: 'image-lib-detail', hidden: true });
  const usageById = new Map();
  const usageLoading = new Set();
  let activeDetailId = '';

  const deleteFromLibrary = async (it) => {
    if (!user?.isAdmin) return;
    const id = String(it?.id || '').trim();
    if (!id) return;

    try {
      setBusy(true);
      setStatus(t('imageLibrary.usage.loading', 'Checking usage…'));
      const usageResp = await api(`/api/image-library/${id}/usage`);
      const usage = Array.isArray(usageResp?.usage) ? usageResp.usage : [];
      const usedBy = usage.length;
      const usedByPublished = usage.filter((u) => (u?.published || []).length > 0).length;

      const lines = [];
      if (usedBy) {
        lines.push(
          t('imageLibrary.delete.usedBy', 'Used by {count} presentation(s).', { count: usedBy })
        );
        if (usedByPublished) {
          lines.push(
            t('imageLibrary.delete.usedByPublished', 'Warning: {count} of those are published on the web.', {
              count: usedByPublished,
            })
          );
        }
        lines.push('');
        lines.push(t('imageLibrary.delete.usedByList', 'Used by (most recent first):'));
        for (const u of usage.slice(0, 8)) {
          const title = String(u?.title || u?.id || '').trim() || '(Untitled)';
          const mod = u?.modified ? ` — ${u.modified}` : '';
          const pub = (u?.published || []).length ? ' — PUBLISHED' : '';
          lines.push(`- ${title}${mod}${pub}`);
        }
        if (usage.length > 8) lines.push('…');
        lines.push('');
      }

      lines.push(
        t(
          'imageLibrary.delete.confirm',
          'Delete this image from the library? This will NOT delete the uploaded file; existing slides using the URL will keep working.'
        )
      );
      const ok = await confirmModal(h, document.body, {
        title: t('imageLibrary.delete.title', 'Delete image'),
        message: lines.join('\n'),
        confirmLabel: t('common.delete', 'Delete'),
        danger: true,
      });
      if (!ok) return;

      setStatus(t('imageLibrary.delete.deleting', 'Deleting…'));
      await api(`/api/image-library/${id}`, { method: 'DELETE' });
      setStatus(t('imageLibrary.delete.deleted', 'Deleted.'));
      onItemDeleted(id);
    } catch (e) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const renderDetail = (it) => {
    detailWrap.innerHTML = '';
    const isEditable = !!user;
    const alts = it?.alts && typeof it.alts === 'object' ? it.alts : {};
    const tags = Array.isArray(it?.tags) ? it.tags : [];

    // Favorite button in detail view
    const isFavorite = !!it?.isFavorite;
    const btnFavorite = onToggleFavorite
      ? h('button', {
          class: `btn btn-secondary image-lib-detail-favorite${isFavorite ? ' is-favorite' : ''}`,
          type: 'button',
          title: isFavorite
            ? t('imageLibrary.unfavorite', 'Remove from favorites')
            : t('imageLibrary.favorite', 'Add to favorites'),
          onclick: () => onToggleFavorite(it),
        })
      : null;

    if (btnFavorite) {
      btnFavorite.innerHTML = isFavorite
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    }

    const headerRow = h('div', { class: 'image-lib-detail-top' }, [
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('common.back', 'Back'),
        onclick: () => hide(),
      }),
      h('div', { class: 'row is-gap-sm' }, [
        btnFavorite,
        h('div', { class: 'help', text: String(it?.id || '') }),
      ]),
    ]);

    const img = h('img', {
      class: 'image-lib-detail-preview',
      src: it?.url || '',
      alt: '',
      loading: 'lazy',
    });

    const inUrl = h('input', { class: 'form-input', value: String(it?.url || ''), readonly: true });
    const inDescription = h('input', {
      class: 'form-input',
      value: String(it?.description || ''),
      disabled: !isEditable,
    });
    const inTags = h('input', {
      class: 'form-input',
      value: tags.join(', '),
      disabled: !isEditable,
    });
    const tagsDatalistId = `image-lib-tags-detail-${Math.random().toString(16).slice(2)}`;
    inTags.setAttribute('list', tagsDatalistId);
    const tagsDatalist = h('datalist', { id: tagsDatalistId });
    installTagsAutocomplete(inTags, tagsDatalist, () => getAllTags(items()));

    const inPhotographer = h('input', {
      class: 'form-input',
      value: String(it?.photographer || ''),
      disabled: !isEditable,
    });
    const inAltNl = h('input', {
      class: 'form-input',
      value: String(alts?.nl || ''),
      disabled: !isEditable,
    });
    const inAltEn = h('input', {
      class: 'form-input',
      value: String(alts?.['en-GB'] || ''),
      disabled: !isEditable,
    });

    const altsAreEmpty = () =>
      !String(inAltNl.value || '').trim() && !String(inAltEn.value || '').trim();

    const ensureAltBeforeUse = async () => {
      if (!altsAreEmpty()) return true;
      if (canAiAlt) {
        const genOk = await confirmModal(h, document.body, {
          title: t('imageLibrary.alt.missingTitle', 'Alt text missing'),
          message: t('imageLibrary.alt.missingSuggestGenerate', 'Alt text is empty. Generate it with AI now? (Recommended)'),
        });
        if (genOk) {
          try {
            setBusy(true);
            setStatus(t('imageLibrary.alt.generating', 'Generating alt text…'));
            const resp = await api(`/api/image-library/${it.id}/generate-alts`, {
              method: 'POST',
              body: JSON.stringify({ context: context || null }),
            });
            const a = resp?.alts && typeof resp.alts === 'object' ? resp.alts : {};
            inAltNl.value = String(a?.nl || '');
            inAltEn.value = String(a?.['en-GB'] || '');

            const updated = await api(`/api/image-library/${it.id}`, {
              method: 'PUT',
              body: JSON.stringify({
                alts: { nl: String(inAltNl.value || ''), 'en-GB': String(inAltEn.value || '') },
              }),
            });
            onItemUpdated(updated);
            setStatus(t('imageLibrary.alt.generated', 'Generated.'));
            renderDetail(updated);
            return true;
          } catch (e) {
            setStatus(String(e?.message || e));
            return false;
          } finally {
            setBusy(false);
          }
        }
      }
      return await confirmModal(h, document.body, {
        title: t('imageLibrary.alt.missingTitle', 'Alt text missing'),
        message: t('imageLibrary.alt.missingConfirmUse', 'Alt text is still empty. Use this image anyway?'),
      });
    };

    const btnGenerateAlt = canAiAlt
      ? h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('imageLibrary.alt.generate', 'Generate alt text (AI)'),
          onclick: async () => {
            try {
              const overwriteOk =
                String(inAltNl.value || '').trim() || String(inAltEn.value || '').trim()
                  ? await confirmModal(h, document.body, {
                      title: t('imageLibrary.alt.overwriteTitle', 'Overwrite alt text'),
                      message: t('imageLibrary.alt.overwriteConfirm', 'Overwrite existing alt text with AI-generated text?'),
                      confirmLabel: t('imageLibrary.alt.overwrite', 'Overwrite'),
                      danger: true,
                    })
                  : true;
              if (!overwriteOk) return;
              setBusy(true);
              setStatus(t('imageLibrary.alt.generating', 'Generating alt text…'));
              const resp = await api(`/api/image-library/${it.id}/generate-alts`, {
                method: 'POST',
                body: JSON.stringify({ context: context || null }),
              });
              const a = resp?.alts && typeof resp.alts === 'object' ? resp.alts : {};
              inAltNl.value = String(a?.nl || '');
              inAltEn.value = String(a?.['en-GB'] || '');
              setStatus(t('imageLibrary.alt.generated', 'Generated.'));
            } catch (e) {
              setStatus(String(e?.message || e));
            } finally {
              setBusy(false);
            }
          },
        })
      : null;

    const created = typeof it?.created === 'string' ? it.created : '';
    const modified = typeof it?.modified === 'string' ? it.modified : '';
    const dates = h('div', { class: 'help' }, [
      h('div', { text: t('imageLibrary.detail.created', 'Uploaded: {date}', { date: created || '—' }) }),
      h('div', { text: t('imageLibrary.detail.modified', 'Modified: {date}', { date: modified || '—' }) }),
    ]);

    const btnUse = onPick
      ? h('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: t('imageLibrary.useThis', 'Use this image'),
          onclick: async () => {
            const ok = await ensureAltBeforeUse();
            if (!ok) return;
            onPick?.(it, { applyCaptionCredit: allowCaptionCredit && creditCb?.checked });
            onClose();
          },
        })
      : null;

    const btnSave = isEditable
      ? h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('common.save', 'Save'),
          onclick: async () => {
            try {
              setBusy(true);
              setStatus(t('common.save', 'Save') + '…');
              const tagsArr = String(inTags.value || '').split(',').map((s) => s.trim()).filter(Boolean);
              const updated = await api(`/api/image-library/${it.id}`, {
                method: 'PUT',
                body: JSON.stringify({
                  description: inDescription.value || '',
                  tags: tagsArr,
                  photographer: inPhotographer.value || '',
                  alts: { nl: inAltNl.value || '', 'en-GB': inAltEn.value || '' },
                }),
              });
              onItemUpdated(updated);
              setStatus(t('common.saved', 'Saved.'));
              renderDetail(updated);
            } catch (e) {
              setStatus(String(e?.message || e));
            } finally {
              setBusy(false);
            }
          },
        })
      : null;

    const canReplaceInPlace = String(it?.url || '').startsWith('/uploads/');
    const inputReplace = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
      class: 'is-hidden',
    });
    const btnReplace = isEditable
      ? h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('imageLibrary.replace', 'Replace file…'),
          disabled: !canReplaceInPlace,
          onclick: () => inputReplace.click(),
        })
      : null;

    inputReplace.addEventListener('change', async () => {
      const f = inputReplace.files?.[0];
      if (!f) return;
      try {
        setBusy(true);
        setStatus(t('imageLibrary.replace.replacing', 'Replacing file…'));
        const dataUrl = await readFileAsDataUrl(f);
        const updated = await api(`/api/image-library/${it.id}/replace-upload`, {
          method: 'POST',
          body: JSON.stringify({ dataUrl }),
        });
        onItemUpdated(updated);
        setStatus(t('imageLibrary.replace.done', 'Replaced. Existing slides keep working (URL unchanged).'));
        renderDetail(updated);
      } catch (e) {
        setStatus(String(e?.error || e?.message || e));
      } finally {
        inputReplace.value = '';
        setBusy(false);
      }
    });

    // Usage info
    const usageResp = usageById.get(String(it?.id || '').trim()) || null;
    const usageArr = Array.isArray(usageResp?.usage) ? usageResp.usage : [];
    const usedByCount = usageArr.length;
    const publishedCount = usageArr.filter((u) => Array.isArray(u?.published) && u.published.length).length;

    const usageBlock = h('div', { class: 'image-lib-usage' }, [
      h('div', { class: 'field-label', text: t('imageLibrary.usage.title', 'Where is this used?') }),
      usageLoading.has(String(it?.id || '').trim())
        ? h('div', { class: 'help', text: t('imageLibrary.usage.loading', 'Checking usage…') })
        : h('div', {
            class: 'help',
            text: usedByCount
              ? t('imageLibrary.usage.summary', 'Used by {count} presentation(s) ({published} published).', {
                  count: usedByCount,
                  published: publishedCount,
                })
              : t('imageLibrary.usage.none', 'Not used by any presentations.'),
          }),
      usedByCount
        ? h(
            'div',
            { class: 'stack is-gap-sm' },
            usageArr.slice(0, 12).map((u) => {
              const title = String(u?.title || u?.id || '').trim() || '(Untitled)';
              const pub = Array.isArray(u?.published) ? u.published : [];
              const pubLinks = pub
                .slice(0, 2)
                .map((p) => {
                  const pid = String(p?.publishId || '').trim();
                  if (!pid) return null;
                  const slug = String(p?.slug || '').trim() || 'presentation';
                  return h('a', {
                    class: 'btn btn-secondary is-compact-sm',
                    href: `/p/${pid}-${slug}`,
                    target: '_blank',
                    rel: 'noreferrer',
                    text: t('imageLibrary.usage.openPublic', 'Open public'),
                  });
                })
                .filter(Boolean);
              return h('div', { class: 'row spread is-wrap is-gap-sm' }, [
                h('div', { class: 'stack' }, [
                  h('div', { text: title }),
                  h('div', { class: 'help', text: String(u?.modified || '') }),
                ]),
                h('div', { class: 'row is-wrap is-gap-sm' }, [
                  h('a', {
                    class: 'btn btn-secondary is-compact-sm',
                    href: `/app/${u.id}`,
                    target: '_blank',
                    rel: 'noreferrer',
                    text: t('imageLibrary.usage.openEditor', 'Open editor'),
                  }),
                  ...pubLinks,
                ]),
              ]);
            })
          )
        : null,
    ]);

    const btnDelete =
      user?.isAdmin && it?.id
        ? h('button', {
            class: 'btn btn-danger',
            type: 'button',
            text: t('common.delete', 'Delete'),
            onclick: async () => {
              await deleteFromLibrary(it);
              hide();
            },
          })
        : null;

    detailWrap.append(
      headerRow,
      img,
      dates,
      h('div', { class: 'image-lib-detail-meta' }, [
        h('div', { class: 'image-lib-detail-grid' }, [
          createFieldWrap(h, t('imageLibrary.upload.url.label', 'Image URL'), inUrl, {
            helpText: t(
              'imageLibrary.detail.urlHelp',
              'Slides store the URL, so deleting from the library does not break existing slides.'
            ),
          }),
          createFieldWrap(h, t('imageLibrary.description.label', 'Description (internal)'), inDescription),
          createFieldWrap(h, t('imageLibrary.tags.label', 'Tags'), inTags),
          createFieldWrap(h, t('imageLibrary.photographer.label', 'Photographer'), inPhotographer),
          createFieldWrap(h, t('imageLibrary.altNl.label', 'Alt text (NL)'), inAltNl),
          createFieldWrap(h, t('imageLibrary.altEn.label', 'Alt text (EN)'), inAltEn),
        ]),
        tagsDatalist,
        inputReplace,
        canReplaceInPlace
          ? null
          : h('div', {
              class: 'help',
              text: t(
                'imageLibrary.replace.notLocal',
                'Replace file is only available for images stored as local uploads (/uploads/…).'
              ),
            }),
        usageBlock,
        h('div', { class: 'image-lib-detail-actions' }, [
          h('div', {}, [btnUse]),
          h('div', { class: 'row is-wrap' }, [btnReplace, btnGenerateAlt, btnSave, btnDelete]),
        ]),
      ])
    );
  };

  const show = (it) => {
    const id = String(it?.id || '').trim();
    if (!id) return;
    activeDetailId = id;
    detailWrap.hidden = false;
    renderDetail(it);

    // Lazy-load usage
    if (!usageById.has(id) && !usageLoading.has(id)) {
      usageLoading.add(id);
      api(`/api/image-library/${id}/usage`)
        .then((resp) => usageById.set(id, resp))
        .catch(() => {})
        .finally(() => {
          usageLoading.delete(id);
          if (activeDetailId === id) {
            const updatedIt = items().find((x) => x?.id === id) || it;
            renderDetail(updatedIt);
          }
        });
    }
  };

  const hide = () => {
    activeDetailId = '';
    detailWrap.hidden = true;
    setStatus('');
  };

  const getActiveId = () => activeDetailId;

  return {
    element: detailWrap,
    show,
    hide,
    getActiveId,
    renderDetail,
  };
}