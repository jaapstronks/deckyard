import { icon } from '../../../lib/dom/icons.js';
import { t } from '../../../lib/ui-i18n.js';
import { getFeatures } from '../../../lib/state/features.js';
import {
  readFileAsDataUrl,
  getAllTags,
  installTagsAutocomplete,
  createAltLangInputs,
  createAltBlock,
  confirmMissingAlt,
  createMoreDetails,
} from './utils.js';
import { h } from '../../../lib/dom/index.js';
import { createFieldWrap } from '../../../lib/dom/field-wrap.js';
import {
  imageUploadAccept,
  imageUploadFormatList,
} from '../../../../shared/constants/image-uploads.js';

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
 * Uses presigned URLs for S3-compatible object storage, falls back to server-side upload for local storage.
 *
 * Exported so the inline WYSIWYG editor's drag & drop path reuses the exact same
 * upload plumbing as the image-library modal (single upload destination: the
 * built-in library). Returns `{ url }`.
 */
export async function uploadFile(api, file) {
  const status = await getMediaStatus(api);

  if (status.presignedSupported) {
    // Presigned upload flow (S3-compatible object storage)
    const presign = await api('/api/media/presign', {
      method: 'POST',
      body: {
        filename: file.name,
        contentType: file.type,
        size: file.size,
      },
    });

    // Upload directly to storage provider
    // Presigned upload straight to external storage: not our /api/*
    // surface, and must not carry our credentials/JSON headers.
    // eslint-disable-next-line no-restricted-syntax
    const uploadResp = await fetch(presign.uploadUrl, {
      method: 'PUT',
      headers: presign.headers || {},
      body: file,
    });

    if (!uploadResp.ok) {
      throw new Error(
        `Upload failed: ${uploadResp.status} ${uploadResp.statusText}`,
      );
    }

    // Confirm the upload completed
    const confirm = await api('/api/media/confirm', {
      method: 'POST',
      body: { key: presign.key },
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
    body: { dataUrl, originalName: file.name },
  });
  return { url: saved.url };
}

/**
 * Open the OS file dialog for one image, restricted to what the server takes.
 * Calls `onFile` with the chosen file; a cancelled dialog calls nothing.
 *
 * The direct upload route from an image field (B579) starts here, before any
 * modal exists, so the file input cannot live inside the upload component.
 *
 * @param {(file: File) => void} onFile
 */
export function chooseImageFile(onFile) {
  const input = h('input', { type: 'file', accept: imageUploadAccept() });
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) onFile(file);
  });
  input.click();
}

/**
 * Creates the image library upload component.
 *
 * - Drag-and-drop zone and URL field side by side, both visible from the start
 * - Once an image is picked: preview beside the form, alt text up front, the
 *   rarely needed fields behind "More details", and an action bar that stays
 *   in view (B579)
 *
 * The picker mounts this at the *top* of the library view (B210): uploading is
 * the common way into the modal, so it must not cost a scroll past the grid.
 *
 * @param {Object} options - Component options
 * @returns {{el: HTMLElement, uploadFile: (file: File) => Promise<void>}} Upload component API
 */
export function createImageLibraryUpload({
  api,
  user,
  items,
  canAiAlt,
  context,
  uploadsEnabled,
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
  const inert = { el: addWrap, uploadFile: async () => {} };

  if (!user) {
    return inert;
  }

  // D295: an installation without uploads builds no upload entry at all; only
  // the sandbox, which withholds a production feature, greys it out (D181).
  if (!uploadsEnabled) {
    if (!getFeatures()?.sandboxMode) return inert;
    addWrap.append(
      h('div', {
        class: 'field-label',
        text: t('imageLibrary.addNew', 'Add new'),
      }),
      h('div', {
        class: 'help',
        text: t(
          'imageLibrary.readOnlySandbox',
          'Uploads are off in the sandbox. Use Unsplash or Giphy to add images.',
        ),
      }),
    );
    return inert;
  }

  let newUrl = '';

  // Hidden file input
  const inputFile = h('input', {
    type: 'file',
    // Exactly what the server takes (B366): `image/*` also offered AVIF and
    // BMP, which the upload policy then refused after the pick.
    accept: imageUploadAccept(),
    style: 'display:none',
  });

  // Dropzone - the main upload area
  const dropzoneIcon = h('div', { class: 'image-lib-dropzone-icon' }, [
    icon('upload', { size: 24 }),
  ]);
  const dropzoneText = h('div', {
    class: 'image-lib-dropzone-text',
    text: t('imageLibrary.dropzone.text', 'Drop image here or click to upload'),
  });
  const dropzoneHint = h('div', {
    class: 'image-lib-dropzone-hint help',
    text: t('imageLibrary.dropzone.hint', '{formats} supported', {
      formats: imageUploadFormatList(),
    }),
  });

  const dropzone = h('div', { class: 'image-lib-dropzone' }, [
    dropzoneIcon,
    h('div', { class: 'image-lib-dropzone-copy' }, [
      dropzoneText,
      dropzoneHint,
    ]),
  ]);

  // URL input as the alternative source. It sits beside the dropzone rather
  // than behind a toggle: a toggle that opens a field below the fold reads as
  // a broken button (B210).
  const inputUrl = h('input', {
    class: 'form-input',
    placeholder: t(
      'imageLibrary.urlPlaceholder',
      'Paste URL (e.g. /uploads/image.jpg)',
    ),
  });

  // Both ways in, on one row. Hidden as a unit once a *file* is uploaded.
  const entryRow = h('div', { class: 'image-lib-entry' }, [
    dropzone,
    createFieldWrap(t('imageLibrary.upload.url.label', 'Image URL'), inputUrl),
  ]);

  // Preview, beside the form rather than above it (B579): a preview on top
  // pushed the alt text and the buttons below the fold.
  const previewImg = h('img', { class: 'image-lib-preview-img', alt: '' });
  const btnChangeImage = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    text: t('imageLibrary.changeImage', 'Change image'),
    onclick: () => inputFile.click(),
  });

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
    placeholder: t(
      'imageLibrary.photographerField',
      'Photographer name (optional)',
    ),
  });
  const altInputs = createAltLangInputs({ asPlaceholder: true });

  const getTagsArray = () =>
    String(inTags.value || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  /** @returns {Promise<boolean>} true when the alt inputs were filled */
  const generateAlt = async () => {
    if (!newUrl) return false;
    try {
      setBusy(true);
      setStatus(t('imageLibrary.alt.generating', 'Generating alt text…'));
      const resp = await api('/api/image-library/generate-alts', {
        method: 'POST',
        body: {
          url: newUrl,
          description: inDescription.value || '',
          tags: getTagsArray(),
          photographer: inPhotographer.value || '',
          langs: altInputs.langs,
          context: context || null,
        },
      });
      altInputs.write(resp?.alts);
      setStatus(t('imageLibrary.alt.generated', 'Generated.'));
      return true;
    } catch (e) {
      setStatus(String(e?.message || e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const altBlock = createAltBlock({
    altInputs,
    onGenerate: canAiAlt ? generateAlt : null,
    withAutoToggle: true,
  });

  const pickedSection = h('div', { class: 'image-lib-picked', hidden: true }, [
    h('div', { class: 'stack is-gap-2 image-lib-preview' }, [
      previewImg,
      btnChangeImage,
    ]),
    h('div', { class: 'stack is-gap-3 image-lib-metadata' }, [
      altBlock.el,
      createFieldWrap(
        t('imageLibrary.photographer.label', 'Photographer'),
        inPhotographer,
      ),
      createMoreDetails([inDescription, inTags, tagsDatalist]),
    ]),
  ]);

  const readForm = () => ({
    url: newUrl,
    description: inDescription.value || '',
    tags: getTagsArray(),
    photographer: inPhotographer.value || '',
    alts: altInputs.read(),
  });

  /** @returns {Promise<boolean>} false when the user backed out */
  const ensureAlt = () =>
    altInputs.isEmpty()
      ? confirmMissingAlt({ canAiAlt, generate: generateAlt })
      : Promise.resolve(true);

  const pickAndClose = (picked) => {
    onPick?.(picked, {
      applyCaptionCredit: allowCaptionCredit && creditCb?.checked,
    });
    onClose();
  };

  // One primary action (B579): opened from an image field it saves to the
  // library *and* uses the image; without a field to fill it only saves.
  const btnSave = h('button', {
    class: 'btn btn-primary',
    type: 'button',
    text: onPick
      ? t('imageLibrary.useThis', 'Use this image')
      : t('imageLibrary.addButton', 'Save to library'),
    onclick: async () => {
      if (!newUrl) return;
      if (onPick && !(await ensureAlt())) return;
      setBusy(true);
      setStatus(t('common.saving', 'Saving…'));
      let created;
      try {
        created = await api('/api/image-library', {
          method: 'POST',
          body: readForm(),
        });
        onItemCreated(created);
        setStatus(t('imageLibrary.added', 'Added.'));
      } catch (e) {
        setStatus(String(e?.message || e));
        return;
      } finally {
        setBusy(false);
      }
      if (onPick) pickAndClose(created);
      else onShowDetail(created);
    },
  });

  const btnUseOnly = onPick
    ? h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('imageLibrary.useWithoutSaving', 'Use without saving'),
        onclick: async () => {
          if (!newUrl) return;
          if (!(await ensureAlt())) return;
          pickAndClose(readForm());
        },
      })
    : null;

  // Sticky at the bottom of the scroll area (B579): the buttons stay in view
  // whatever the form's height, which retires the old scrollIntoView.
  const actionsSection = h(
    'div',
    { class: 'image-lib-actions', hidden: true },
    [btnSave, btnUseOnly],
  );

  /**
   * Show the picked-image state.
   *
   * `fromUrl` decides whether the entry row collapses. A file upload replaces
   * it with a preview plus "Change image"; a pasted URL must not, because the
   * caret is in that very field and every keystroke lands here — pulling the
   * input out from under the user mid-typing is how the old toggle-less path
   * would have broken.
   *
   * @param {string} url - The picked image URL
   * @param {{fromUrl?: boolean}} [opts] - Source of the URL
   */
  const showUploadedState = (url, { fromUrl = false } = {}) => {
    newUrl = url;
    previewImg.src = url;
    entryRow.hidden = !fromUrl;
    btnChangeImage.hidden = fromUrl;
    pickedSection.hidden = false;
    actionsSection.hidden = false;
  };

  /** Back to "nothing picked yet" — only the URL path can undo a pick. */
  const clearUploadedState = () => {
    newUrl = '';
    previewImg.removeAttribute('src');
    entryRow.hidden = false;
    pickedSection.hidden = true;
    actionsSection.hidden = true;
  };

  // Handle file upload
  const uploadPicked = async (file) => {
    if (!file) return;
    setBusy(true);
    setStatus(t('imageLibrary.uploading', 'Uploading…'));
    let uploaded = false;
    try {
      const result = await uploadFile(api, file);
      showUploadedState(result.url);
      setStatus(t('imageLibrary.uploaded', 'Uploaded.'));
      uploaded = true;
    } catch (e) {
      setStatus(String(e?.message || e));
    } finally {
      setBusy(false);
    }
    // The remembered "generate on upload" choice: the alt is there before the
    // user reaches for "Use", so the empty-alt question rarely comes up.
    if (uploaded && altBlock.autoAlt() && altInputs.isEmpty()) {
      await generateAlt();
    }
  };

  // File input change
  inputFile.addEventListener('change', () => {
    const file = inputFile.files?.[0];
    if (file) uploadPicked(file);
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
      uploadPicked(file);
    }
  });

  // URL input - show preview when valid URL entered, and take it back when the
  // field is emptied again (the field stays on screen now, so clearing it is a
  // move the user can actually make).
  inputUrl.addEventListener('input', () => {
    const url = String(inputUrl.value || '').trim();
    if (url && (url.startsWith('/') || url.startsWith('http'))) {
      showUploadedState(url, { fromUrl: true });
    } else if (newUrl) {
      clearUploadedState();
    }
  });

  // Assemble component. No "Add new" heading here: this block is the first
  // thing in the modal below its own title, and the dropzone says what it is.
  addWrap.append(inputFile, entryRow, pickedSection, actionsSection);

  return { el: addWrap, uploadFile: uploadPicked };
}
