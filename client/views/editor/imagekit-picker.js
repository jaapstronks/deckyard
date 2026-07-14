import { lockDocumentScroll } from './editor-utils.js';
import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/modal.js';
import { cleanStr, uniq, addTr, addNamedTr, buildDocTag } from './imagekit-picker/transform-utils.js';

export function openImageKitPicker({
  title = t('imagekit.title', 'ImageKit'),
  api,
  h,
  root,
  openOverlayClosers,
  context = null,
  docId = '',
  onPick,
} = {}) {
  if (typeof api !== 'function') throw new Error('openImageKitPicker: api is required');
  if (typeof h !== 'function') throw new Error('openImageKitPicker: h is required');
  if (!root) throw new Error('openImageKitPicker: root is required');

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', { class: 'modal imagekit-modal' });
  const unlockScroll = lockDocumentScroll();
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    unlockScroll();
    openOverlayClosers?.delete?.(close);
    backdrop.remove();
  };
  openOverlayClosers?.add?.(close);

  const statusLine = h('div', { class: 'help ui-status-line' });

  let cfg = null;
  let items = [];
  let selected = null;
  let busy = false;
  let allTags = [];
  let selectedTag = null;

  const setBusy = (v) => {
    busy = !!v;
    qInput.disabled = busy;
    advInput.disabled = busy;
    btnSearch.disabled = busy;
  };

  const aggregateTags = (fileList, tagPrefix = '') => {
    const tagCounts = new Map();
    for (const file of fileList) {
      const fileTags = uniq(file?.tags);
      for (const tag of fileTags) {
        const lower = tag.toLowerCase();
        // Filter out auto-generated document tags (e.g., deck:uuid)
        if (tagPrefix && lower.startsWith(tagPrefix.toLowerCase())) continue;
        tagCounts.set(lower, (tagCounts.get(lower) || 0) + 1);
      }
    }
    // Sort by count (descending), then alphabetically
    return Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([tag, count]) => ({ tag, count }));
  };

  const tagBar = h('div', { class: 'imagekit-tag-bar' });
  let tagsExpanded = false;

  const renderTagBar = () => {
    tagBar.innerHTML = '';
    if (!allTags.length) {
      tagBar.style.display = 'none';
      return;
    }
    tagBar.style.display = '';
    tagBar.classList.toggle('is-expanded', tagsExpanded);

    // "All" button to clear filter
    tagBar.append(
      h('button', {
        type: 'button',
        class: `imagekit-tag-chip${selectedTag === null ? ' is-active' : ''}`,
        text: t('imagekit.tags.all', 'All'),
        onclick: async () => {
          if (selectedTag === null) return;
          selectedTag = null;
          qInput.value = '';
          advInput.value = '';
          await reload();
          renderTagBar();
        },
      })
    );

    // Tag chips - show limited or all based on expansion state
    const maxVisible = tagsExpanded ? allTags.length : 12;
    const visibleTags = allTags.slice(0, maxVisible);
    for (const { tag } of visibleTags) {
      const isActive = selectedTag === tag;
      tagBar.append(
        h('button', {
          type: 'button',
          class: `imagekit-tag-chip${isActive ? ' is-active' : ''}`,
          onclick: async () => {
            if (selectedTag === tag) return;
            selectedTag = tag;
            qInput.value = '';
            advInput.value = `tags IN ["${tag}"]`;
            await reloadWithQuery();
            renderTagBar();
          },
        }, [
          h('span', { class: 'imagekit-tag-chip-hash', text: '#' }),
          h('span', { class: 'imagekit-tag-chip-label', text: tag }),
        ])
      );
    }

    // Show expand/collapse button if there are more tags
    const hiddenCount = allTags.length - 12;
    if (hiddenCount > 0) {
      tagBar.append(
        h('button', {
          type: 'button',
          class: 'imagekit-tag-chip',
          text: tagsExpanded
            ? t('imagekit.tags.showLess', 'Show less')
            : t('imagekit.tags.more', '+{count} more', { count: hiddenCount }),
          onclick: () => {
            tagsExpanded = !tagsExpanded;
            renderTagBar();
          },
        })
      );
    }
  };

  const header = h('div', { class: 'row spread' });
  header.append(
    h('h2', { text: title }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    })
  );

  const qInput = h('input', {
    class: 'form-input',
    placeholder: t('imagekit.search.placeholder', 'Search name or tags…'),
  });
  const advInput = h('input', {
    class: 'form-input',
    placeholder: t('imagekit.search.advanced.placeholder', 'Advanced searchQuery (optional)…'),
  });

  const btnSearch = h('button', {
    class: 'btn btn-primary',
    text: t('common.search', 'Search'),
  });

  const handleSearch = async () => {
    selectedTag = null;
    await reloadWithQuery();
    renderTagBar();
  };

  // Enter key triggers search
  qInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  });
  advInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  });

  const topControls = h('div', { class: 'imagekit-top-controls' }, [
    statusLine,
    h('div', { class: 'imagekit-search-row' }, [
      h('label', { class: 'stack is-field' }, [
        h('div', { class: 'field-label', text: t('imagekit.search.label', 'Search') }),
        qInput,
      ]),
      h('label', { class: 'stack is-field' }, [
        h('div', { class: 'field-label', text: t('imagekit.search.advanced.label', 'Advanced') }),
        advInput,
      ]),
      btnSearch,
    ]),
    tagBar,
  ]);

  const grid = h('div', { class: 'imagekit-grid' });
  const detail = h('div', { class: 'imagekit-detail' });

  const renderGrid = () => {
    grid.innerHTML = '';
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      grid.append(
        h('div', {
          class: 'help',
          text: t('imagekit.noResults', 'No results.'),
        })
      );
      return;
    }

    for (const it of list) {
      const fileId = cleanStr(it?.fileId);
      const isActive = selected && cleanStr(selected?.fileId) === fileId;
      const thumbUrl = addTr(it?.thumbnailUrl || it?.url || '', 'w-520,h-320,c-at_max,f-auto,q-70');
      const tags = uniq(it?.tags).slice(0, 3);
      grid.append(
        h(
          'button',
          {
            type: 'button',
            class: `imagekit-card${isActive ? ' is-active' : ''}`,
            onclick: async () => {
              selected = it;
              renderGrid();
              renderDetail();
              // Fetch full file details to get customMetadata (ALT text)
              const fileId = cleanStr(it?.fileId);
              if (fileId && cfg?.configured) {
                try {
                  const details = await api(`/api/media/imagekit/files/${encodeURIComponent(fileId)}/details`, { method: 'GET' });
                  if (details && cleanStr(details?.fileId) === fileId) {
                    // Merge full details (including customMetadata) into selected
                    selected = { ...selected, ...details };
                    items = items.map((x) => (cleanStr(x?.fileId) === fileId ? selected : x));
                    renderDetail();
                  }
                } catch {
                  // Ignore - use whatever metadata we have from list
                }
              }
            },
          },
          [
            h('img', {
              class: 'imagekit-thumb',
              src: thumbUrl,
              alt: '',
              loading: 'lazy',
            }),
            h('div', { class: 'imagekit-card-meta' }, [
              h('div', { class: 'imagekit-card-name', text: cleanStr(it?.name) || '(unnamed)' }),
              h('div', {
                class: 'imagekit-card-tags',
                text: tags.length ? tags.map((t0) => `#${t0}`).join(' ') : '',
              }),
            ]),
          ]
        )
      );
    }
  };

  const renderDetail = () => {
    detail.innerHTML = '';
    if (!selected) {
      detail.append(
        h('div', { class: 'help', text: t('imagekit.pickHint', 'Select an image to view details.') })
      );
      return;
    }

    const altKey = cleanStr(cfg?.metadataFields?.altSeed);
    const cm = selected?.customMetadata && typeof selected.customMetadata === 'object' ? selected.customMetadata : {};
    const existingAltSeed = altKey ? cleanStr(cm?.[altKey]) : '';

    let chosenTransform = '';
    const transformSel = h('select', { class: 'form-input' });
    const mkOpt = (value, label) => h('option', { value, text: label });
    transformSel.append(mkOpt('', t('imagekit.transform.original', 'Original')));
    for (const tr of Array.isArray(cfg?.recommendedNamedTransformations) ? cfg.recommendedNamedTransformations : []) {
      const id = cleanStr(tr?.id);
      if (!id) continue;
      transformSel.append(mkOpt(id, cleanStr(tr?.label) || id));
    }
    transformSel.addEventListener('change', () => {
      chosenTransform = cleanStr(transformSel.value);
      previewImg.src = addTr(
        addNamedTr(cleanStr(selected?.url), chosenTransform),
        'w-1200,h-800,c-at_max,f-auto,q-80'
      );
      urlOut.value = addNamedTr(cleanStr(selected?.url), chosenTransform);
    });

    const previewImg = h('img', {
      class: 'imagekit-detail-preview',
      src: addTr(cleanStr(selected?.thumbnailUrl || selected?.url), 'w-1200,h-800,c-at_max,f-auto,q-80'),
      alt: '',
      loading: 'lazy',
    });

    const urlOut = h('input', {
      class: 'form-input',
      readonly: true,
      value: cleanStr(selected?.url),
    });

    const altTa = h('textarea', {
      class: 'form-input',
      rows: 3,
      placeholder: t('imagekit.alt.placeholder', 'ALT text (English, recommended)'),
    });
    // Set value via property, not attribute (textarea doesn't use value attribute)
    altTa.value = existingAltSeed;

    const tagsIn = h('input', {
      class: 'form-input',
      value: uniq(selected?.tags).join(', '),
      placeholder: t('imagekit.tags.placeholder', 'tags (comma-separated)'),
    });

    const btnGenerateAlt = h('button', {
      class: 'btn btn-secondary',
      type: 'button',
      text: t('imagekit.alt.generate', 'Generate ALT (AI)'),
      onclick: async () => {
        try {
          setBusy(true);
          statusLine.textContent = t('imagekit.alt.generating', 'Generating…');
          const resp = await api('/api/image-library/generate-alts', {
            method: 'POST',
            body: JSON.stringify({
              url: cleanStr(selected?.url),
              description: cleanStr(selected?.name),
              tags: uniq(selected?.tags),
              photographer: '',
              context: context || null,
            }),
          });
          const a = resp?.alts && typeof resp.alts === 'object' ? resp.alts : {};
          // For this project we treat ImageKit metadata as a single “seed” (English-first).
          altTa.value = cleanStr(a?.['en-GB']) || cleanStr(a?.nl) || '';
          statusLine.textContent = t('imagekit.alt.generated', 'Generated.');
        } catch (e) {
          statusLine.textContent = String(e?.message || e);
        } finally {
          setBusy(false);
        }
      },
    });

    const bestEffortTag = () => buildDocTag(cfg, docId);

    // Checkbox to update ImageKit's ALT - checked by default only if image had no ALT
    const updateAltCheckbox = h('input', {
      type: 'checkbox',
      id: 'imagekit-update-alt',
    });
    updateAltCheckbox.checked = altKey && !existingAltSeed;

    const btnUse = h('button', {
      class: 'btn btn-primary',
      type: 'button',
      text: t('imagekit.use', 'Use this image'),
      onclick: async () => {
        const seed = cleanStr(altTa.value);
        if (!seed) {
          const ok = await confirmModal(h, root, {
            title: t('imagekit.alt.missingTitle', 'ALT text missing'),
            message: t(
              'imagekit.alt.missingConfirm',
              'ALT seed is empty. Use this image anyway?'
            ),
          });
          if (!ok) return;
        }

        // Save ALT to ImageKit if checkbox is checked
        if (updateAltCheckbox.checked && altKey && seed) {
          try {
            const fileId = cleanStr(selected?.fileId);
            const tag = bestEffortTag();
            if (fileId) {
              const nextTags = uniq(selected?.tags);
              if (tag && !nextTags.includes(tag)) nextTags.push(tag);
              const patch = { customMetadata: { ...(cm || {}), [altKey]: seed } };
              if (nextTags.length) patch.tags = nextTags;
              api(`/api/media/imagekit/files/${encodeURIComponent(fileId)}/details`, {
                method: 'PATCH',
                body: JSON.stringify(patch),
              }).catch(() => {});
            }
          } catch {
            // ignore - don't block "Use"
          }
        }

        onPick?.({
          url: cleanStr(urlOut.value) || cleanStr(selected?.url),
          fileId: cleanStr(selected?.fileId),
          altSeed: seed,
          tags: uniq(selected?.tags),
        });
        close();
      },
    });

    detail.append(
      previewImg,
      h('div', { class: 'stack is-field' }, [
        h('div', { class: 'field-label', text: t('imagekit.url', 'URL') }),
        urlOut,
      ]),
      h('div', { class: 'stack is-field' }, [
        h('div', { class: 'field-label', text: t('imagekit.transform', 'Transform') }),
        transformSel,
        h('div', {
          class: 'help',
          text: t('imagekit.transform.help', 'Optional: adds ?tr=n-<name> to the URL.'),
        }),
      ]),
      h('div', { class: 'stack is-field' }, [
        h('div', { class: 'field-label', text: t('imagekit.tags', 'Tags') }),
        tagsIn,
        h('div', {
          class: 'help',
          text: bestEffortTag()
            ? t(
                'imagekit.tags.autoTag',
                'On save, we will also tag this as: {tag}',
                { tag: bestEffortTag() }
              )
            : t('imagekit.tags.autoTagOff', 'Optional: keep assets discoverable with tags.'),
        }),
      ]),
      h('div', { class: 'stack is-field' }, [
        h('div', { class: 'field-label', text: t('imagekit.alt', 'ALT text (English)') }),
        altTa,
        altKey
          ? h('label', { class: 'row is-start is-gap-sm' }, [
              updateAltCheckbox,
              h('span', {
                class: 'help',
                text: t('imagekit.alt.updateCheckbox', 'Update ALT in ImageKit'),
              }),
            ])
          : h('div', {
              class: 'help',
              text: t('imagekit.alt.help.disabled', 'To persist ALT in ImageKit, configure IMAGEKIT_METADATA_FIELD_ALT_SEED on server.'),
            }),
      ]),
      h('div', { class: 'imagekit-detail-actions' }, [btnGenerateAlt, btnUse])
    );
  };

  const loadTags = async () => {
    try {
      const resp = await api('/api/media/imagekit/tags', { method: 'GET' });
      const tagPrefix = cleanStr(cfg?.tagPrefix) || '';
      // Filter out auto-generated document tags
      allTags = (Array.isArray(resp) ? resp : [])
        .filter(({ tag }) => !tagPrefix || !tag.toLowerCase().startsWith(tagPrefix.toLowerCase()))
        .slice(0, 50); // Limit to top 50 tags
    } catch {
      // Fallback: aggregate from loaded files if tags endpoint fails
      const tagPrefix = cleanStr(cfg?.tagPrefix) || '';
      allTags = aggregateTags(items, tagPrefix);
    }
  };

  const reload = async () => {
    try {
      setBusy(true);
      statusLine.textContent = t('common.loading', 'Loading…');
      // Fetch files and tags in parallel
      const [filesResp] = await Promise.all([
        api('/api/media/imagekit/files?limit=60', { method: 'GET' }),
        loadTags(),
      ]);
      items = Array.isArray(filesResp) ? filesResp : Array.isArray(filesResp?.files) ? filesResp.files : filesResp;
      // Some ImageKit responses return an array directly; keep it flexible.
      if (!Array.isArray(items)) items = Array.isArray(filesResp?.items) ? filesResp.items : [];
      statusLine.textContent = '';
    } catch (e) {
      statusLine.textContent = String(e?.message || e);
      items = [];
      allTags = [];
    } finally {
      setBusy(false);
      renderTagBar();
      renderGrid();
      renderDetail();
    }
  };

  const reloadWithQuery = async () => {
    try {
      setBusy(true);
      statusLine.textContent = t('common.loading', 'Loading…');
      const q = cleanStr(qInput.value);
      const searchQuery = cleanStr(advInput.value);
      const qs = new URLSearchParams();
      if (q) qs.set('q', q);
      if (searchQuery) qs.set('searchQuery', searchQuery);
      qs.set('limit', '60');
      const resp = await api(`/api/media/imagekit/files?${qs.toString()}`, { method: 'GET' });
      items = Array.isArray(resp) ? resp : Array.isArray(resp?.files) ? resp.files : resp;
      if (!Array.isArray(items)) items = [];
      statusLine.textContent = '';
    } catch (e) {
      statusLine.textContent = String(e?.message || e);
      items = [];
    } finally {
      setBusy(false);
      renderGrid();
      renderDetail();
    }
  };

  // Use reloadWithQuery for the Search button
  btnSearch.onclick = handleSearch;

  const layout = h('div', { class: 'imagekit-layout' }, [
    h('div', { class: 'imagekit-left-column' }, [
      topControls,
      h('div', { class: 'imagekit-grid-pane' }, [grid]),
    ]),
    h('div', { class: 'imagekit-detail-pane' }, [detail]),
  ]);

  modal.append(header, layout);
  backdrop.append(modal);

  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  root.append(backdrop);

  // Initial boot
  (async () => {
    try {
      setBusy(true);
      statusLine.textContent = t('common.loading', 'Loading…');
      cfg = await api('/api/media/imagekit/status', { method: 'GET' });
      if (!cfg?.configured) {
        const issues = Array.isArray(cfg?.issues) ? cfg.issues : [];
        statusLine.textContent = issues.length
          ? `ImageKit not configured: ${issues.join('; ')}`
          : t('imagekit.notConfigured', 'ImageKit is not configured.');
        // Disable actions; this dialog is informational until configured.
        qInput.disabled = true;
        advInput.disabled = true;
        btnSearch.disabled = true;
        items = [];
        renderGrid();
        renderDetail();
        return;
      }
      await reload();
      // Show warnings (if any) after successful load
      const warnings = Array.isArray(cfg?.warnings) ? cfg.warnings : [];
      if (warnings.length && !statusLine.textContent) {
        statusLine.textContent = warnings.join('; ');
      }
    } catch (e) {
      statusLine.textContent = String(e?.message || e);
      items = [];
      renderGrid();
      renderDetail();
    } finally {
      setBusy(false);
    }
  })();
}
