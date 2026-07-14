import { createPromiseModal, createBusyManager } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';

function countSentences(text) {
  const s = String(text || '').trim();
  if (!s) return 0;
  const matches = s.match(/[.!?]+/g);
  return matches ? matches.length : 1;
}

export function openDescriptionModal({
  h,
  root,
  api,
  toast,
  pres,
  id,
  context = 'publish',
  openOverlayClosers,
  requestSave,
} = {}) {
  const modal = createPromiseModal(h, {
    title:
      context === 'share'
        ? t('editor.descriptionModal.title.share', 'Add a description before sharing')
        : t('editor.descriptionModal.title.publish', 'Add a description before publishing'),
    hint: t(
      'editor.descriptionModal.hint',
      'This becomes the public meta description and is included in integrations. Keep it short: exactly two sentences.'
    ),
    closeOnBackdrop: true,
    onClose: (result) => result,
  });

  if (typeof pres.description !== 'string') pres.description = '';
  const ta = h('textarea', {
    class: 'form-input',
    style: 'min-height:120px;',
    value: String(pres.description || ''),
    placeholder: t('editor.descriptionModal.placeholder', 'Two-sentence description…'),
    autofocus: true,
  });

  const status = h('div', { class: 'help modal-status', text: '' });
  const sync = () => {
    const v = String(ta.value || '');
    const n = v.length;
    const max = 600;
    const sCount = countSentences(v);
    if (!v.trim()) {
      status.textContent = t('editor.descriptionModal.required', 'Please enter a description.');
      return;
    }
    if (n > max) {
      status.textContent = t('editor.descriptionModal.tooLong', 'Too long ({n}/{max}). Please shorten.', {
        n: String(n),
        max: String(max),
      });
      return;
    }
    if (sCount !== 2) {
      status.textContent = t('editor.descriptionModal.twoSentences', 'Aim for exactly two sentences.');
      return;
    }
    status.textContent = t('editor.descriptionModal.ok', 'Looks good.');
  };
  ta.addEventListener('input', sync);

  const btnRow = h('div', { class: 'row is-end is-mt-8' });
  const btnGenerate = h('button', {
    class: 'btn btn-secondary',
    text: t('editor.descriptionModal.generate', 'Generate with AI'),
    onclick: async () => {
      if (busyManager.isBusy()) return;
      busyManager.setBusy(true);
      try {
        const resp = await api(`/api/presentations/${id}/description/generate`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const d = typeof resp?.description === 'string' ? resp.description : '';
        if (!d.trim())
          throw new Error(t('editor.descriptionModal.generateFailed', 'Could not generate a description.'));
        ta.value = d.trim();
        sync();
      } catch (e) {
        toast?.error?.(String(e?.message || e), { id: 'desc-generate' });
      } finally {
        busyManager.setBusy(false);
      }
    },
  });

  const btnCancel = h('button', {
    class: 'btn btn-secondary',
    text: t('common.cancel', 'Cancel'),
    onclick: () => modal.close({ ok: false }),
  });

  const btnContinue = h('button', {
    class: 'btn btn-primary',
    text: t('common.continue', 'Continue'),
    onclick: async () => {
      if (busyManager.isBusy()) return;
      const v = String(ta.value || '').trim();
      if (!v) {
        sync();
        return;
      }
      if (v.length > 600) {
        sync();
        return;
      }
      pres.description = v;
      try {
        busyManager.setBusy(true);
        await requestSave?.();
      } catch {
        // ignore
      } finally {
        busyManager.setBusy(false);
      }
      modal.close({ ok: true });
    },
  });

  // Use busy manager to control all interactive elements
  const busyManager = createBusyManager([btnCancel, btnContinue, btnGenerate, ta]);

  btnRow.append(btnGenerate, btnCancel, btnContinue);

  modal.content.append(ta, status, btnRow);
  modal.show(root, openOverlayClosers);
  sync();

  try {
    ta.focus();
    ta.select();
  } catch {
    // ignore
  }

  return modal.promise;
}