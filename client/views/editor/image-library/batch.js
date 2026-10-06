import { h } from '../../../lib/dom/index.js';
import { createModal, confirmModal } from '../../../lib/dom/modal.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { t } from '../../../lib/ui-i18n.js';
import { getSupportedLangs } from '../../../lib/format/i18n.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import { debugLog } from '../../../lib/util/debug.js';
import {
  IMAGE_UPLOAD_MIME_TO_EXT,
  imageUploadAccept,
} from '../../../../shared/constants/image-uploads.js';
import { uploadFile } from './upload.js';
import { runBatchTasks } from '../media/batch-runner.js';

let nextRowId = 0;

/** Choose several images in one OS dialog; cancellation has no effect. */
export function chooseImageFiles(onFiles) {
  const input = h('input', {
    type: 'file',
    accept: imageUploadAccept(),
    multiple: true,
  });
  input.addEventListener(
    'change',
    () => {
      const files = Array.from(input.files || []);
      if (files.length) onFiles(files);
    },
    { once: true },
  );
  input.click();
}

/**
 * Open the shared batch editor for a collection or library-only upload.
 * `onPickMany` is called once, after the user explicitly accepts the successful rows.
 */
export function openImageBatch({
  api,
  files = [],
  capacity = () => 30,
  spec = null,
  onPickMany = null,
  onItemsCreated = null,
  validateDestination = () => true,
} = {}) {
  const langs = getSupportedLangs();
  const rows = [];
  const previews = new Set();
  let closed = false;
  let phaseBusy = false;
  let applied = false;
  let stopped = false;
  let mediaStatus;
  const modal = createModal({
    title: t('imageLibrary.batch.title', 'Upload images'),
    modalClass: 'image-batch-modal',
    fill: true,
    onClose: () => {
      stopped = true;
      closed = true;
      for (const url of previews) URL.revokeObjectURL(url);
      previews.clear();
    },
  });
  const message = h('p', { class: 'help', role: 'status' });
  const error = createInlineError({ callout: true });
  const notice = h('p', {
    class: 'help',
    text: onPickMany
      ? t(
          'imageLibrary.batch.sharedAndUse',
          'Saved images are added to this organization’s shared image library before they are placed on the slide.',
        )
      : t(
          'imageLibrary.batch.shared',
          'Saved images are added to this organization’s shared image library.',
        ),
  });
  const list = h('div', { class: 'image-batch-list' });
  const add = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('imageLibrary.batch.addFiles', 'Choose more images'),
    onclick: () => chooseImageFiles(addFiles),
  });
  const drop = h('button', {
    class: 'image-batch-drop',
    type: 'button',
    text: t('imageLibrary.batch.drop', 'Drop images here, or choose files'),
    onclick: () => chooseImageFiles(addFiles),
  });
  drop.addEventListener('dragover', (event) => {
    event.preventDefault();
    drop.classList.add('is-dragover');
  });
  drop.addEventListener('dragleave', () =>
    drop.classList.remove('is-dragover'),
  );
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('is-dragover');
    addFiles(Array.from(event.dataTransfer?.files || []));
  });

  const sharedPhotographer = h('input', {
    class: 'form-input',
    'aria-label': t('imageLibrary.photographer.label', 'Photographer'),
  });
  const sharedTags = h('input', {
    class: 'form-input',
    'aria-label': t('imageLibrary.tags', 'Tags, comma-separated (optional)'),
  });
  const applyDetails = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('imageLibrary.batch.applyDetails', 'Apply to all selected rows'),
    onclick: () => {
      for (const row of rows) {
        if (row.saveAttempted) continue;
        row.photographer.value = sharedPhotographer.value;
        row.tags.value = sharedTags.value;
      }
    },
  });
  const details = h('details', { class: 'image-lib-more' }, [
    h('summary', { text: t('imageLibrary.moreDetails', 'More details') }),
    h('div', { class: 'image-batch-shared' }, [
      h('label', {}, [
        t('imageLibrary.photographer.label', 'Photographer'),
        sharedPhotographer,
      ]),
      h('label', {}, [
        t('imageLibrary.tags', 'Tags, comma-separated (optional)'),
        sharedTags,
      ]),
      applyDetails,
    ]),
  ]);
  const save = h('button', { type: 'button', class: 'btn btn-primary' });
  const useOnly = onPickMany
    ? h('button', { type: 'button', class: 'btn btn-secondary' })
    : null;
  const retry = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    hidden: true,
    text: t('imageLibrary.batch.retryFailed', 'Retry failed'),
    onclick: retryFailed,
  });
  const continueButton = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    hidden: true,
    onclick: () => applySuccessful(rows.filter((row) => row.libraryItem)),
  });
  function cancelFlow() {
    if (stopped && !phaseBusy) {
      modal.close();
      return;
    }
    if (!phaseBusy) {
      modal.close();
      return;
    }
    stopped = true;
    cancel.disabled = true;
    message.textContent = t(
      'imageLibrary.batch.stopping',
      'Stopping after current requests…',
    );
  }
  const cancel = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: cancelFlow,
  });
  if (modal.closeBtn) modal.closeBtn.onclick = cancelFlow;
  const actions = h('div', { class: 'image-lib-actions image-batch-actions' }, [
    save,
    useOnly,
    retry,
    continueButton,
    cancel,
  ]);
  modal.append(notice, message, error.el, drop, add, list, details, actions);

  const showError = (value) => {
    if (value) error.show(value);
    else error.clear();
  };
  const countStored = () => rows.filter((row) => row.libraryItem).length;
  const setBusy = (busy) => {
    phaseBusy = busy;
    if (!closed) {
      modal.setBusy(busy);
      updateActions();
      if (!busy && stopped) {
        message.textContent = t(
          'imageLibrary.batch.stopped',
          '{count} images were saved to the shared library and remain there. The slide was not changed.',
          { count: countStored() },
        );
        cancel.textContent = t('common.close', 'Close');
        cancel.disabled = false;
      }
    }
  };
  function updateActions() {
    const failedUploads = rows.filter((row) => row.uploadStatus === 'failed');
    const failedSaves = rows.filter(
      (row) => row.saveStatus === 'failed' || row.saveStatus === 'uncertain',
    );
    const successful = rows.filter((row) => row.libraryItem);
    const active = rows.filter(
      (row) =>
        row.uploadStatus === 'uploading' || row.uploadStatus === 'pending',
    );
    const n = rows.length;
    message.textContent = stopped
      ? t('imageLibrary.batch.stopping', 'Stopping after current requests…')
      : t(
          'imageLibrary.batch.count',
          '{count} images selected; {free} places available',
          { count: n, free: capacity() },
        );
    save.textContent = onPickMany
      ? t('imageLibrary.batch.saveAndAdd', 'Save and add {count} images', {
          count: n,
        })
      : t('imageLibrary.batch.save', 'Save {count} images', { count: n });
    if (useOnly)
      useOnly.textContent = t(
        'imageLibrary.batch.useOnly',
        'Use {count} images without library saving',
        { count: n },
      );
    continueButton.hidden =
      !failedSaves.length || !successful.length || !onPickMany;
    continueButton.textContent = t(
      'imageLibrary.batch.continue',
      'Continue with {count} saved images',
      { count: successful.length },
    );
    save.disabled =
      phaseBusy ||
      !n ||
      !!active.length ||
      !!failedUploads.length ||
      !!failedSaves.length ||
      applied;
    if (useOnly)
      useOnly.disabled =
        phaseBusy ||
        !n ||
        !!active.length ||
        !!failedUploads.length ||
        rows.some((row) => row.saveAttempted);
    retry.hidden =
      !failedUploads.length && !rows.some((row) => row.saveStatus === 'failed');
    retry.disabled = phaseBusy || stopped;
    add.disabled = phaseBusy || stopped;
    drop.disabled = phaseBusy || stopped;
    applyDetails.disabled = phaseBusy || stopped;
    if (stopped) {
      save.disabled = true;
      if (useOnly) useOnly.disabled = true;
      continueButton.disabled = true;
    }
    cancel.textContent = phaseBusy
      ? t(
          'imageLibrary.batch.stop',
          'Stop after current requests ({count} saved)',
          { count: countStored() },
        )
      : t('common.cancel', 'Cancel');
  }

  function rowStatus(row) {
    if (closed) return;
    const failure =
      row.saveStatus === 'failed' || row.saveStatus === 'uncertain'
        ? row.saveError
        : row.uploadStatus === 'failed'
          ? row.uploadError
          : '';
    if (failure) row.error.show(failure, { focus: false });
    else row.error.clear();
    row.status.textContent = failure
      ? ''
      : row.libraryItem
        ? t('imageLibrary.batch.saved', 'Saved')
        : row.uploadStatus === 'uploaded'
          ? t('imageLibrary.batch.uploaded', 'Uploaded')
          : t('imageLibrary.uploading', 'Uploading…');
    updateActions();
  }

  function makeRow(file) {
    const id = ++nextRowId;
    const preview = URL.createObjectURL(file);
    previews.add(preview);
    const row = {
      id,
      file,
      url: '',
      uploadStatus: 'pending',
      saveStatus: 'idle',
      saveAttempted: false,
      libraryItem: null,
      uploadError: '',
      saveError: '',
      alts: {},
    };
    row.status = h('p', {
      class: 'help',
      role: 'status',
      text: t('imageLibrary.uploading', 'Uploading…'),
    });
    row.error = createInlineError();
    row.photographer = h('input', {
      class: 'form-input',
      'aria-label': t('imageLibrary.photographer.label', 'Photographer'),
    });
    row.tags = h('input', {
      class: 'form-input',
      'aria-label': t('imageLibrary.tags', 'Tags, comma-separated (optional)'),
    });
    const fields = h('div', { class: 'image-batch-fields' });
    if (spec?.nameKey) {
      row.name = h('input', {
        class: 'form-input',
        ...(spec.nameMaxLength ? { maxlength: spec.nameMaxLength } : {}),
        'aria-label': t('imageLibrary.batch.name', 'Name'),
      });
      fields.append(
        h('label', {}, [t('imageLibrary.batch.name', 'Name'), row.name]),
      );
    }
    row.altInputs = {};
    for (const lang of langs) {
      const input = h('input', {
        class: 'form-input',
        ...(spec?.altMaxLength ? { maxlength: spec.altMaxLength } : {}),
      });
      row.altInputs[lang] = input;
      fields.append(
        h('label', {}, [
          t('imageLibrary.alt.langLabel', 'Alt text ({lang})', {
            lang: getLangDisplayName(lang),
          }),
          input,
        ]),
      );
    }
    row.el = h(
      'article',
      { class: 'image-batch-row', 'data-batch-id': String(id) },
      [
        h('img', { src: preview, alt: '', class: 'image-batch-thumb' }),
        h('div', { class: 'image-batch-row-body' }, [
          h('div', { class: 'row is-between' }, [
            h('strong', { text: file.name }),
            h('button', {
              type: 'button',
              class: 'btn btn-secondary btn-sm',
              text: t('common.remove', 'Remove'),
              onclick: () => {
                if (phaseBusy) return;
                const index = rows.indexOf(row);
                if (index >= 0) rows.splice(index, 1);
                row.el.remove();
                URL.revokeObjectURL(preview);
                previews.delete(preview);
                updateActions();
              },
            }),
          ]),
          row.status,
          row.error.el,
          fields,
          h('details', { class: 'image-lib-more' }, [
            h('summary', {
              text: t('imageLibrary.moreDetails', 'More details'),
            }),
            h('div', { class: 'image-batch-shared' }, [
              h('label', {}, [
                t('imageLibrary.photographer.label', 'Photographer'),
                row.photographer,
              ]),
              h('label', {}, [
                t('imageLibrary.tags', 'Tags, comma-separated (optional)'),
                row.tags,
              ]),
            ]),
          ]),
        ]),
      ],
    );
    return row;
  }

  async function uploadRows(selected) {
    if (!selected.length || closed) return;
    setBusy(true);
    try {
      mediaStatus ||= await api('/api/media/status').catch(() => ({
        presignedSupported: false,
      }));
      const maxBytes = mediaStatus.presignedSupported
        ? 20 * 1024 * 1024
        : 10 * 1024 * 1024;
      await runBatchTasks(
        selected,
        async (row) => {
          if (closed) return;
          if (!IMAGE_UPLOAD_MIME_TO_EXT[row.file.type]) {
            row.uploadStatus = 'failed';
            row.uploadError = t(
              'imageLibrary.batch.invalidFormat',
              'Unsupported image format',
            );
            rowStatus(row);
            return;
          }
          if (row.file.size > maxBytes) {
            row.uploadStatus = 'failed';
            row.uploadError = t(
              'imageLibrary.batch.tooLarge',
              'This image exceeds the upload size limit',
            );
            rowStatus(row);
            return;
          }
          row.uploadStatus = 'uploading';
          rowStatus(row);
          try {
            const result = await uploadFile(api, row.file);
            row.url = result.url;
            row.uploadStatus = 'uploaded';
          } catch (err) {
            row.uploadStatus = 'failed';
            row.uploadError = String(err?.message || err);
          }
          rowStatus(row);
        },
        { concurrency: 3, shouldContinue: () => !stopped && !closed },
      );
    } finally {
      setBusy(false);
    }
  }

  function addFiles(incoming) {
    if (closed || stopped || phaseBusy || !incoming.length) return;
    if (!validateDestination()) {
      showError(
        t(
          'imageLibrary.batch.stale',
          'The slide or its image places changed. Keep this form open and choose the destination again.',
        ),
      );
      return;
    }
    const free = capacity();
    if (rows.length + incoming.length > free) {
      showError(
        t(
          'imageLibrary.batch.capacity',
          '{selected} images selected, but only {free} places are free. Choose again.',
          { selected: rows.length + incoming.length, free },
        ),
      );
      return;
    }
    showError('');
    const selected = incoming.map(makeRow);
    rows.push(...selected);
    list.append(...selected.map((row) => row.el));
    updateActions();
    uploadRows(selected).catch((err) => {
      debugLog('[image-batch] upload coordinator failed', err);
      if (!closed) showError(String(err?.message || err));
    });
  }

  function rowForm(row) {
    return {
      url: row.url,
      description: '',
      tags: row.tags.value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      photographer: row.photographer.value.trim(),
      alts: Object.fromEntries(
        langs.map((lang) => [lang, row.altInputs[lang].value.trim()]),
      ),
    };
  }

  async function ensureReady() {
    if (!validateDestination()) {
      showError(
        t(
          'imageLibrary.batch.stale',
          'The slide or its image places changed. Keep this form open and choose the destination again.',
        ),
      );
      return false;
    }
    for (const row of rows) {
      if (
        (row.name &&
          spec?.nameMaxLength &&
          row.name.value.length > spec.nameMaxLength) ||
        (spec?.altMaxLength &&
          Object.values(row.altInputs).some(
            (input) => input.value.length > spec.altMaxLength,
          ))
      ) {
        row.error.show(
          t('imageLibrary.batch.tooLong', 'Text is too long in this row.'),
          { focus: row.name || Object.values(row.altInputs)[0] },
        );
        row.el.scrollIntoView({ block: 'nearest' });
        return false;
      }
    }
    const missing = langs
      .map((lang) => ({
        lang,
        count: rows.filter((row) => !row.altInputs[lang].value.trim()).length,
      }))
      .filter((entry) => entry.count);
    if (!missing.length) return true;
    return confirmModal(document.body, {
      title: t('imageLibrary.alt.missingTitle', 'Alt text missing'),
      message: t(
        'imageLibrary.batch.missingAlt',
        'Alt text is missing for {count} image-language fields ({langs}). Use these images as drafts anyway?',
        {
          count: missing.reduce((sum, entry) => sum + entry.count, 0),
          langs: missing
            .map((entry) => `${getLangDisplayName(entry.lang)}: ${entry.count}`)
            .join(', '),
        },
      ),
    });
  }

  function picksFor(selected) {
    return selected.map(
      (row) =>
        row.confirmedPick || {
          ...rowForm(row),
          name: row.name?.value.trim() || '',
          id: row.libraryItem?.id,
        },
    );
  }

  function applySuccessful(selected = rows) {
    if (closed || stopped || applied || !selected.length) return;
    if (!validateDestination()) {
      showError(
        t(
          'imageLibrary.batch.stale',
          'The slide or its image places changed. Keep this form open and choose the destination again.',
        ),
      );
      return;
    }
    if (onPickMany?.(picksFor(selected)) === false) {
      showError(
        t(
          'imageLibrary.batch.stale',
          'The slide or its image places changed. Keep this form open and choose the destination again.',
        ),
      );
      return;
    }
    applied = true;
    modal.close();
  }

  async function saveRows(selected) {
    if (closed || stopped || phaseBusy || applied || !selected.length) return;
    setBusy(true);
    showError('');
    if (!(await ensureReady()) || closed || stopped) {
      setBusy(false);
      return;
    }
    try {
      for (const row of selected) {
        if (stopped || closed) break;
        if (row.libraryItem || row.saveStatus === 'uncertain') continue;
        row.saveAttempted = true;
        row.saveStatus = 'saving';
        const form = rowForm(row);
        const name = row.name?.value.trim() || '';
        for (const control of [
          row.name,
          row.photographer,
          row.tags,
          ...Object.values(row.altInputs),
        ]) {
          if (control) control.disabled = true;
        }
        rowStatus(row);
        try {
          const created = await api('/api/image-library', {
            method: 'POST',
            body: form,
          });
          row.libraryItem = created;
          row.confirmedPick = { ...form, name, id: created?.id };
          row.saveStatus = 'saved';
          if (!closed) onItemsCreated?.(created);
        } catch (err) {
          row.saveStatus = err?.code ? 'failed' : 'uncertain';
          if (row.saveStatus === 'failed') {
            for (const control of [
              row.name,
              row.photographer,
              row.tags,
              ...Object.values(row.altInputs),
            ]) {
              if (control) control.disabled = false;
            }
          }
          row.saveError = err?.code
            ? String(err.message || err)
            : t(
                'imageLibrary.batch.uncertain',
                'Saving may have succeeded. Check the library before trying again.',
              );
        }
        rowStatus(row);
      }
    } finally {
      setBusy(false);
    }
    if (closed || stopped) return;
    const failures = rows.filter(
      (row) => row.saveStatus === 'failed' || row.saveStatus === 'uncertain',
    );
    if (failures.length) {
      showError(
        t(
          'imageLibrary.batch.partial',
          '{count} images could not be confirmed. Retry failed rows or continue with saved images.',
          { count: failures.length },
        ),
      );
      return;
    }
    if (rows.every((row) => row.libraryItem) && !closed) {
      if (onPickMany) applySuccessful();
      else modal.close();
    }
  }

  async function retryFailed() {
    if (phaseBusy || closed || stopped) return;
    const uploads = rows.filter((row) => row.uploadStatus === 'failed');
    if (uploads.length) {
      await uploadRows(uploads);
      return;
    }
    const saves = rows.filter((row) => row.saveStatus === 'failed');
    if (saves.length) await saveRows(saves);
  }

  save.onclick = () => saveRows(rows);
  if (useOnly)
    useOnly.onclick = async () => {
      if (phaseBusy || closed || stopped) return;
      setBusy(true);
      const ready = await ensureReady();
      setBusy(false);
      if (!ready || closed || stopped) return;
      applySuccessful();
    };
  // The collection action can start inside the All text overlay. Mount on the
  // document so this new dialog is above that overlay and receives focus.
  modal.show(document.body);
  updateActions();
  if (files.length) addFiles(files);
  return { close: () => modal.close(), addFiles };
}
