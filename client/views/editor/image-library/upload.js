import { t } from '../../../lib/ui-i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { readFileAsDataUrl, getAllTags, installTagsAutocomplete, createFieldWrap } from './utils.js';

// Cache media status to avoid repeated API calls
let _mediaStatus = null;

async function getMediaStatus(api) {
  if (_mediaStatus) return _mediaStatus;
  try {
    _mediaStatus = await api('/api/media/status');
  } catch {
    _mediaStatus = { presignedSupported: false };
  }
  return _mediaStatus;
}

/**
 * Upload a file using the best available method.
 * Uses presigned URLs for Scaleway/S3, falls back to server-side upload for local storage.
 *
 * Exported so the inline WYSIWYG editor's drag & drop path reuses the exact same
 * upload plumbing as the image-library modal (single upload destination: the
 * built-in library). Returns `{ url }`.
 */
export async function uploadFile(api, file) {
  const status = await getMediaStatus(api);

  if (status.presignedSupported) {
    // Presigned upload flow (Scaleway)
    const presign = await api('/api/media/presign', {
      method: 'POST',
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        size: file.size,
      }),
    });

    // Upload directly to storage provider
    const uploadResp = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.headers || {},
      body: file,
    });

    if (!uploadResp.ok) {
      throw new Error(`Upload failed: ${uploadResp.status} ${uploadResp.statusText}`);
    }

    // Confirm the upload completed
    const confirm = await api('/api/media/confirm', {
      method: 'POST',
      body: JSON.stringify({ key: presign.key }),
    });

    if (!confirm.exists) {
      throw new Error('Upload confirmation failed');
    }

    return { url: confirm.publicUrl };
  }

  // Fallback: server-side upload (local storage)
  const dataUrl = await readFileAsDataUrl(file);
  const saved = await api('/api/uploads', {
    method: 'POST',
    body: JSON.stringify({ dataUrl, originalName: file.name }),
  });
  return { url: saved.url };
}

/**
 * Creates the image library upload component with improved UX
 * - Large drag-and-drop zone for easy uploads
 * - Metadata fields only shown after image is uploaded
 * @param {Object} options - Component options
 * @returns {Object} Upload component API
 */
export function createImageLibraryUpload({
  h,
  api,
  user,
  items,
  canAiAlt,
  context,
  uploadsDisabled,
  onPick,
  onClose,
  onItemCreated,
  onShowDetail,
  allowCaptionCredit,
  creditCb,
  setStatus,
  setBusy,
} = {}) {
  const addWrap = h('div', { class: 'stack image-lib-upload' });

  if (!user) {
    return { element: addWrap };
  }

  if (uploadsDisabled) {
    addWrap.append(
      h('div', { class: 'field-label', text: t('imageLibrary.addNew', 'Add new') }),
      h('div', {
        class: 'help',
        text: t('imageLibrary.readOnly', 'Uploads are disabled. The library is read-only.'),
      })
    );
    return { element: addWrap };
  }

  let newUrl = '';

  // Hidden file input
  const inputFile = h('input', {
    type: 'file',
    accept: 'image/*,.svg',
    style: 'display:none',
  });

  // Dropzone - the main upload area (SVG upload icon)
  const dropzoneIcon = h('div', { class: 'image-lib-dropzone-icon' });
  dropzoneIcon.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  const dropzoneText = h('div', {
    class: 'image-lib-dropzone-text',
    text: t('imageLibrary.dropzone.text', 'Drop image here or click to upload'),
  });
  const dropzoneHint = h('div', {
    class: 'image-lib-dropzone-hint help',
    text: t('imageLibrary.dropzone.hint', 'PNG, JPG, SVG supported'),
  });

  const dropzone = h('div', { class: 'image-lib-dropzone' }, [dropzoneIcon, dropzoneText, dropzoneHint]);

  // Preview section (hidden initially)
  const previewImg = h('img', { class: 'image-lib-preview-img', alt: '' });
  const previewWrap = h('div', { class: 'image-lib-preview', hidden: true }, [previewImg]);

  // Change image button (shown after upload)
  const btnChangeImage = h('button', {
    class: 'btn btn-secondary btn-sm',
    text: t('imageLibrary.changeImage', 'Change image'),
    onclick: () => inputFile.click(),
  });
  const changeImageRow = h('div', { class: 'image-lib-change-row', hidden: true }, [btnChangeImage]);

  // URL input as alternative (collapsible)
  const inputUrl = h('input', {
    class: 'form-input',
    placeholder: t('imageLibrary.urlPlaceholder', 'Paste URL (e.g. /uploads/image.jpg)'),
  });
  const urlToggle = h('button', {
    class: 'image-lib-url-toggle',
    text: t('imageLibrary.useUrl', 'Or use existing URL'),
    type: 'button',
  });
  const urlSection = h('div', { class: 'image-lib-url-section', hidden: true }, [
    createFieldWrap(h, t('imageLibrary.upload.url.label', 'Image URL'), inputUrl),
  ]);

  urlToggle.addEventListener('click', () => {
    urlSection.hidden = !urlSection.hidden;
    urlToggle.textContent = urlSection.hidden
      ? t('imageLibrary.useUrl', 'Or use existing URL')
      : t('imageLibrary.hideUrl', 'Hide URL field');
  });

  // Metadata section (hidden until image uploaded)
  const inDescription = h('input', {
    class: 'form-input',
    placeholder: t('imageLibrary.description', 'Brief description (optional)'),
  });
  const inTags = h('input', {
    class: 'form-input',
    placeholder: t('imageLibrary.tags', 'Tags, comma-separated (optional)'),
  });

  const tagsDatalistId = `image-lib-tags-${Math.random().toString(16).slice(2)}`;
  inTags.setAttribute('list', tagsDatalistId);
  const tagsDatalist = h('datalist', { id: tagsDatalistId });
  installTagsAutocomplete(inTags, tagsDatalist, () => getAllTags(items()));

  const inPhotographer = h('input', {
    class: 'form-input',
    placeholder: t('imageLibrary.photographerField', 'Photographer name (optional)'),
  });
  const inAltNl = h('input', {
    class: 'form-input',
    placeholder: t('imageLibrary.altNl', 'Alt text (NL)'),
  });
  const inAltEn = h('input', {
    class: 'form-input',
    placeholder: t('imageLibrary.altEn', 'Alt text (EN)'),
  });

  const getTagsArray = () =>
    String(inTags.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  // Generate alt button
  const btnGenerateAlt = canAiAlt
    ? h('button', {
        class: 'btn btn-secondary btn-sm',
        type: 'button',
        text: t('imageLibrary.alt.generate', 'Generate with AI'),
        onclick: async () => {
          if (!newUrl) return;
          try {
            setBusy(true);
            setStatus(t('imageLibrary.alt.generating', 'Generating alt text…'));
            const resp = await api('/api/image-library/generate-alts', {
              method: 'POST',
              body: JSON.stringify({
                url: newUrl,
                description: inDescription.value || '',
                tags: getTagsArray(),
                photographer: inPhotographer.value || '',
                context: context || null,
              }),
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

  // Alt text fields with optional generate button
  const altHeader = h('div', { class: 'row spread' }, [
    h('div', { class: 'field-label', text: t('imageLibrary.altText', 'Alt text (accessibility)') }),
    btnGenerateAlt,
  ]);

  const metadataSection = h('div', { class: 'image-lib-metadata', hidden: true }, [
    h('div', { class: 'field-label', text: t('imageLibrary.metadata', 'Image details (optional)') }),
    h('div', { class: 'image-lib-metadata-grid' }, [
      inDescription,
      inTags,
      inPhotographer,
    ]),
    tagsDatalist,
    altHeader,
    h('div', { class: 'image-lib-metadata-grid' }, [inAltNl, inAltEn]),
  ]);

  // Action buttons (hidden until image uploaded)
  const btnCreate = h('button', {
    class: 'btn btn-primary',
    text: t('imageLibrary.addButton', 'Save to library'),
    onclick: async () => {
      if (!newUrl) return;
      setBusy(true);
      setStatus(t('common.save', 'Save') + '…');
      try {
        const created = await api('/api/image-library', {
          method: 'POST',
          body: JSON.stringify({
            url: newUrl,
            description: inDescription.value || '',
            tags: getTagsArray(),
            photographer: inPhotographer.value || '',
            alts: { nl: inAltNl.value || '', 'en-GB': inAltEn.value || '' },
          }),
        });
        onItemCreated(created);
        setStatus(t('imageLibrary.added', 'Added.'));
        onShowDetail(created);
      } catch (e) {
        setStatus(String(e?.message || e));
      } finally {
        setBusy(false);
      }
    },
  });

  const btnUseOnly = h('button', {
    class: 'btn btn-secondary',
    text: t('imageLibrary.useWithoutSaving', 'Use without saving'),
    onclick: async () => {
      if (!newUrl) return;
      const altNl = String(inAltNl.value || '').trim();
      const altEn = String(inAltEn.value || '').trim();

      if (!altNl && !altEn) {
        if (canAiAlt) {
          const genOk = await confirmModal(h, document.body, {
            title: t('imageLibrary.alt.missingTitle', 'Alt text missing'),
            message: t('imageLibrary.alt.missingSuggestGenerate', 'Alt text is empty. Generate it with AI now? (Recommended)'),
          });
          if (genOk) {
            try {
              setBusy(true);
              setStatus(t('imageLibrary.alt.generating', 'Generating alt text…'));
              const resp = await api('/api/image-library/generate-alts', {
                method: 'POST',
                body: JSON.stringify({
                  url: newUrl,
                  description: inDescription.value || '',
                  tags: getTagsArray(),
                  photographer: inPhotographer.value || '',
                  context: context || null,
                }),
              });
              const a = resp?.alts && typeof resp.alts === 'object' ? resp.alts : {};
              inAltNl.value = String(a?.nl || '');
              inAltEn.value = String(a?.['en-GB'] || '');
              setStatus(t('imageLibrary.alt.generated', 'Generated.'));
            } catch (e) {
              setStatus(String(e?.message || e));
              return;
            } finally {
              setBusy(false);
            }
          } else {
            const ok = await confirmModal(h, document.body, {
              title: t('imageLibrary.alt.missingTitle', 'Alt text missing'),
              message: t('imageLibrary.alt.missingConfirmUse', 'Alt text is still empty. Use this image anyway?'),
            });
            if (!ok) return;
          }
        } else {
          const ok = await confirmModal(h, document.body, {
            title: t('imageLibrary.alt.missingTitle', 'Alt text missing'),
            message: t('imageLibrary.alt.missingConfirmUse', 'Alt text is still empty. Use this image anyway?'),
          });
          if (!ok) return;
        }
      }

      onPick?.(
        {
          url: newUrl,
          description: inDescription.value || '',
          tags: getTagsArray(),
          photographer: inPhotographer.value || '',
          alts: { nl: inAltNl.value || '', 'en-GB': inAltEn.value || '' },
        },
        { applyCaptionCredit: allowCaptionCredit && creditCb?.checked }
      );
      onClose();
    },
  });

  const actionsSection = h('div', { class: 'image-lib-actions', hidden: true }, [btnCreate, btnUseOnly]);

  // Show uploaded state
  const showUploadedState = (url) => {
    newUrl = url;
    previewImg.src = url;
    dropzone.hidden = true;
    urlToggle.hidden = true;
    urlSection.hidden = true;
    previewWrap.hidden = false;
    changeImageRow.hidden = false;
    metadataSection.hidden = false;
    actionsSection.hidden = false;
  };

  // Reset to initial state
  const resetState = () => {
    newUrl = '';
    previewImg.src = '';
    inputUrl.value = '';
    dropzone.hidden = false;
    urlToggle.hidden = false;
    previewWrap.hidden = true;
    changeImageRow.hidden = true;
    metadataSection.hidden = true;
    actionsSection.hidden = true;
  };

  // Handle file upload
  const handleFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(t('imageLibrary.uploading', 'Uploading…'));
    try {
      const result = await uploadFile(api, file);
      showUploadedState(result.url);
      setStatus(t('imageLibrary.uploaded', 'Uploaded.'));
    } catch (e) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // File input change
  inputFile.addEventListener('change', () => {
    const file = inputFile.files?.[0];
    if (file) handleFile(file);
  });

  // Dropzone click
  dropzone.addEventListener('click', () => inputFile.click());

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
    if (file && file.type.startsWith('image/')) {
      handleFile(file);
    }
  });

  // URL input - show preview when valid URL entered
  inputUrl.addEventListener('input', () => {
    const url = String(inputUrl.value || '').trim();
    if (url && (url.startsWith('/') || url.startsWith('http'))) {
      showUploadedState(url);
    }
  });

  // Assemble component
  addWrap.append(
    h('div', { class: 'field-label', text: t('imageLibrary.addNew', 'Add new image') }),
    inputFile,
    dropzone,
    urlToggle,
    urlSection,
    previewWrap,
    changeImageRow,
    metadataSection,
    actionsSection
  );

  return { element: addWrap };
}