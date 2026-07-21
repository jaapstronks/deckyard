import { fmtDate } from '../../../lib/format/format.js';
import { displayNameFromEmail } from '../../../lib/user/user-format.js';
import {
  createModal,
  createPromiseModal,
  createTextInput,
  createModalActions,
  confirmModal,
} from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';
import { ifMatchRevision } from '../if-match-revision.js';
import { openVersionPreviewModal } from './versions-preview.js';
import { openVersionCompareModal } from './versions-compare.js';

/**
 * Opens a modal to prompt for an optional save point label.
 * @returns {Promise<{ok: boolean, label?: string}>}
 */
function openLabelModal({ h, root, openOverlayClosers } = {}) {
  const modal = createPromiseModal(h, {
    title: t('editor.versions.labelModalTitle', 'Create save point'),
    hint: t('editor.versions.labelModalHint', 'Optionally add a label to help identify this save point later.'),
    closeOnBackdrop: true,
    onClose: (result) => result || { ok: false },
  });

  const labelInput = createTextInput(h, {
    placeholder: t('editor.versions.labelPlaceholder', 'E.g. Before major changes'),
    autoFocus: true,
  });

  const actions = createModalActions(h, {
    cancelText: t('common.cancel', 'Cancel'),
    actionText: t('editor.versions.createSavePoint', 'Create save point'),
    onCancel: () => modal.close({ ok: false }),
    onAction: () => modal.close({ ok: true, label: labelInput.getValue() }),
  });

  modal.content.append(labelInput.wrap, actions.wrap);
  modal.show(root, openOverlayClosers);
  labelInput.focus();

  return modal.promise;
}

export function openVersionsModal({
  h,
  api,
  root,
  pres,
  id,
  requestSave,
  isDirty,
  openOverlayClosers,
  onRestored,
  theme,
} = {}) {
  const modal = createModal(h, {
    title: t('editor.versions.title', 'Versions'),
    hint: t(
      'editor.versions.hint',
      'Versions are "save points" and automatic snapshots. Restore first creates a backup snapshot.'
    ),
  });

  const status = h('div', { class: 'small modal-status', text: '' });
  const backupBanner = h('div', { class: 'editor-callout editor-callout-info is-mb-sm' }, [
    h('img', { class: 'callout-icon', src: iconUrl('shield-check'), alt: '', 'aria-hidden': 'true' }),
    h('span', {
      text: t(
        'editor.versions.backupNotice',
        'Safe to explore: Restoring always creates a backup of your current version first.'
      ),
    }),
  ]);
  const listEl = h('div', { class: 'stack is-gap-sm' });

  const setStatus = (text) => {
    status.textContent = String(text || '');
  };

  const load = async () => {
    setStatus(t('common.loading', 'Loading…'));
    listEl.innerHTML = '';
    try {
      const versions = await api(`/api/presentations/${id}/versions`);
      const arr = Array.isArray(versions) ? versions : [];
      if (!arr.length) {
        listEl.append(
          h('div', {
            class: 'help',
            text: t('editor.versions.empty', 'No versions yet.'),
          })
        );
        setStatus('');
        return;
      }
      for (const v of arr) {
        const who = displayNameFromEmail(v?.createdBy);
        const when = fmtDate(v?.created);
        const reason = String(v?.reason || '').trim() || 'snapshot';
        const label = String(v?.label || '').trim();
        const slideCount = typeof v?.slideCount === 'number' ? v.slideCount : null;
        const row = h('div', { class: 'row spread editor-callout' });
        const metaParts = [who, when];
        if (slideCount !== null) {
          metaParts.push(
            t('editor.versions.slideCount', '{count} slides', { count: slideCount })
          );
        }
        const left = h('div', { class: 'stack is-gap-xs' }, [
          h('div', {
            class: 'field-label',
            text: label
              ? `${label}`
              : reason === 'manual'
              ? 'Save point'
              : reason === 'pre_restore'
              ? 'Backup (pre-restore)'
              : reason === 'restore'
              ? 'Restore'
              : 'Autosave snapshot',
          }),
          h('div', {
            class: 'help',
            text: metaParts.join(' · '),
          }),
        ]);

        // Preview button
        const previewBtn = h('button', {
          class: 'btn btn-ghost btn-sm',
          text: t('editor.versions.preview', 'Preview'),
          onclick: () => {
            openVersionPreviewModal({
              h,
              root,
              api,
              presentationId: id,
              version: v,
              theme,
              openOverlayClosers,
            });
          },
        });

        // Compare button
        const compareBtn = h('button', {
          class: 'btn btn-ghost btn-sm',
          text: t('editor.versions.compare', 'Compare'),
          onclick: () => {
            openVersionCompareModal({
              h,
              root,
              api,
              presentationId: id,
              currentPres: pres,
              version: v,
              theme,
              openOverlayClosers,
            });
          },
        });

        // Export button
        const exportBtn = h('button', {
          class: 'btn btn-ghost btn-sm',
          text: t('editor.versions.export', 'Export'),
          onclick: () => {
            // Trigger download via hidden link
            const link = document.createElement('a');
            link.href = `/api/presentations/${id}/versions/${v.id}/export/json`;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          },
        });

        const restoreBtn = h('button', {
          class: 'btn btn-secondary btn-sm',
          text: t('editor.versions.restore', 'Restore'),
          onclick: async () => {
            if (isDirty?.()) {
              setStatus(t('common.savingFirst', 'Saving first…'));
              await requestSave?.();
              if (isDirty?.()) {
                setStatus(
                  t('editor.versions.restoreAborted', 'Could not save; restore aborted.')
                );
                return;
              }
            }
            const ok = await confirmModal(h, root, {
              title: t('editor.versions.restore', 'Restore'),
              message: t(
                'editor.versions.confirmRestore',
                'Restore this version? The current state will first be saved as a backup.'
              ),
              confirmLabel: t('editor.versions.restore', 'Restore'),
            });
            if (!ok) return;
            setStatus(t('editor.versions.restoring', 'Restoring…'));
            try {
              const resp = await api(
                `/api/presentations/${id}/versions/${v.id}/restore`,
                {
                  method: 'POST',
                  headers: {
                    'If-Match': await ifMatchRevision({ api, id, pres }),
                  },
                }
              );
              const updated = resp?.presentation;
              if (updated && typeof updated === 'object') {
                pres.revision = updated.revision ?? pres.revision;
                pres.modified = updated.modified ?? pres.modified;
                pres.updatedBy = updated.updatedBy ?? pres.updatedBy;
              }
              setStatus(t('editor.versions.restored', 'Restored. Reloading…'));
              onRestored?.(resp);
              location.reload();
            } catch (e) {
              setStatus(String(e?.message || e));
            }
          },
        });

        const buttons = h('div', { class: 'row is-gap-xs' }, [previewBtn, compareBtn, exportBtn, restoreBtn]);
        row.append(left, buttons);
        listEl.append(row);
      }
      setStatus('');
    } catch (e) {
      setStatus(String(e?.message || e));
    }
  };

  const savePointBtn = h('button', {
    class: 'btn btn-primary',
    text: t('editor.versions.createSavePoint', 'Create save point'),
    onclick: async () => {
      if (isDirty?.()) {
        setStatus(t('common.savingFirst', 'Saving first…'));
        await requestSave?.();
        if (isDirty?.()) {
          setStatus(t('common.saveFailedAborted', 'Could not save; aborted.'));
          return;
        }
      }
      const result = await openLabelModal({ h, root, openOverlayClosers });
      if (!result?.ok) return;
      const label = result.label || '';
      setStatus(t('editor.versions.creatingSavePoint', 'Creating save point…'));
      try {
        await api(`/api/presentations/${id}/versions`, {
          method: 'POST',
          body: JSON.stringify({ label: label.trim() || undefined }),
        });
        await load();
        setStatus(t('editor.versions.savePointCreated', 'Save point created.'));
        setTimeout(() => setStatus(''), 1600);
      } catch (e) {
        setStatus(String(e?.message || e));
      }
    },
  });

  modal.content.append(
    h('div', { class: 'row' }, [savePointBtn]),
    status,
    backupBanner,
    listEl
  );
  modal.show(root, openOverlayClosers);
  load();
}