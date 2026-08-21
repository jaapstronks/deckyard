/**
 * Workspace visibility section for the unified Share dialog.
 *
 * Merges what used to be three separate menu items ("Share to workspace",
 * "Move to private", and the workspace-share options modal) into one control:
 * a two-way visibility radio (only invited ↔ everyone in the workspace) with a
 * view/full access sub-choice. Changing the radio applies the visibility change
 * immediately via the same `/visibility` PATCH the old handlers used.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { confirmModal } from '../../../../lib/dom/modal.js';
import { ifMatchRevision } from '../../if-match-revision.js';

/**
 * Create the visibility section (private vs organization-wide; the UI says "Workspace").
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {Function} options.api - API call function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {Object} options.toast - Toast notification service
 * @param {Function} options.isDirty - Returns true if there are unsaved edits
 * @param {Function} options.requestSave - Persist pending edits
 * @param {Object} options.editorState - Editor state (refreshAll)
 * @param {Function} options.syncShareUi - Refresh the topbar share button + dialog
 * @param {boolean} options.isAdmin - Whether the current user is an admin
 * @param {HTMLElement} options.modalRoot - Root element for nested confirm modals
 * @param {Function} options.openDescriptionModal - Opens the description modal
 * @param {Set} [options.openOverlayClosers] - Overlay closers set
 * @returns {{ element: HTMLElement, refresh: Function }}
 */
export function createVisibilitySection({
  h,
  api,
  pres,
  id,
  toast,
  isDirty,
  requestSave,
  editorState,
  syncShareUi,
  isAdmin,
  modalRoot,
  openDescriptionModal,
  openOverlayClosers,
}) {
  const section = h('div', { class: 'share-visibility-section' });
  const title = h('div', {
    class: 'share-section-title',
    text: t('share.visibility.title', 'Who can find this in your workspace?'),
  });
  const optionsWrap = h('div', { class: 'share-options' });
  section.append(title, optionsWrap);

  let busy = false;

  /** Persist pending edits before a visibility change; returns false if save failed. */
  async function ensureSaved(toastId) {
    if (!isDirty?.()) return true;
    toast?.info?.(t('common.savingFirst', 'Saving first…'), {
      id: toastId,
      durationMs: 5200,
    });
    await requestSave?.();
    if (isDirty?.()) {
      toast?.error?.(
        t('common.saveFailedAborted', 'Could not save; aborted.'),
        { id: toastId },
      );
      return false;
    }
    return true;
  }

  /** Apply a visibility change and refresh. */
  async function applyVisibility({ visibility, isViewOnly }) {
    if (busy) return;
    busy = true;
    try {
      const updated = await api(`/api/presentations/${id}/visibility`, {
        method: 'PATCH',
        headers: { 'If-Match': await ifMatchRevision({ api, id, pres }) },
        body: JSON.stringify(
          visibility === 'organization'
            ? { visibility, isViewOnly }
            : { visibility },
        ),
      });
      if (updated && typeof updated === 'object') {
        if (typeof updated.visibility === 'string')
          pres.visibility = updated.visibility;
        if (typeof updated.isViewOnly === 'boolean')
          pres.isViewOnly = updated.isViewOnly;
        if (typeof updated.revision === 'number')
          pres.revision = updated.revision;
        if (updated.updatedBy !== undefined) pres.updatedBy = updated.updatedBy;
      } else if (visibility === 'organization') {
        // Fallback for an unexpectedly empty response: reflect the requested
        // value so the pills stay in sync until the next refresh. The /visibility
        // endpoint and the presentation GET now both echo isViewOnly, so the
        // branch above is normally what keeps the state correct across reloads.
        pres.isViewOnly = isViewOnly;
      }
      let msg;
      if (visibility === 'private')
        msg = t('editor.share.private.done', 'Moved to private.');
      else if (isViewOnly)
        msg = t('editor.share.visibility.doneViewOnly', 'Shared as view only.');
      else msg = t('editor.share.visibility.done', 'Shared to workspace.');
      toast?.success?.(msg, { id: 'share-visibility', durationMs: 2200 });
      syncShareUi?.();
      editorState?.refreshAll?.();
    } catch (e) {
      toast?.error?.(e, { id: 'share-visibility' });
    } finally {
      busy = false;
      render();
    }
  }

  /** Switch to organization visibility (requires a description first). */
  async function shareToOrganization(isViewOnly) {
    if (!(await ensureSaved('share-visibility'))) {
      render();
      return;
    }
    const hasDesc =
      typeof pres?.description === 'string' && pres.description.trim();
    if (!hasDesc) {
      const r = await openDescriptionModal?.({
        h,
        root: modalRoot,
        api,
        toast,
        pres,
        id,
        context: 'share',
        openOverlayClosers,
        requestSave,
      });
      if (!r?.ok) {
        render();
        return;
      }
    }
    await applyVisibility({ visibility: 'organization', isViewOnly });
  }

  /** Switch back to private (with confirmation). */
  async function moveToPrivate() {
    if (!(await ensureSaved('share-visibility'))) {
      render();
      return;
    }
    const ok = await confirmModal(
      modalRoot || document.body,
      {
        title: t('editor.share.private', 'Move to private'),
        message: t(
          'editor.share.private.confirm',
          'Move "{title}" to private? It will no longer be visible to other workspace members.',
          {
            title:
              pres?.title ||
              t('editor.share.thisPresentation', 'this presentation'),
          },
        ),
        confirmLabel: t('editor.share.private', 'Move to private'),
      },
      openOverlayClosers,
    );
    if (!ok) {
      render();
      return;
    }
    await applyVisibility({ visibility: 'private' });
  }

  /** Build one visibility radio row. */
  function radioRow({
    value,
    checked,
    titleText,
    descText,
    disabled,
    onSelect,
  }) {
    const label = h('label', {
      class: `share-option${disabled ? ' is-disabled' : ''}`,
    });
    const radio = h('input', {
      type: 'radio',
      name: 'share-visibility',
      value,
      checked,
      ...(disabled ? { disabled: true } : {}),
      onchange: () => {
        if (radio.checked) onSelect();
      },
    });
    const content = h('div', { class: 'share-option-content' }, [
      h('span', { class: 'share-option-title', text: titleText }),
      h('span', { class: 'share-option-desc', text: descText }),
    ]);
    label.append(radio, content);
    return label;
  }

  function render() {
    optionsWrap.innerHTML = '';
    const visibility = String(pres?.visibility || 'private');
    const isOrganization = visibility === 'organization';
    const isViewOnly = pres?.isViewOnly !== false; // default to view-only when unset
    // Preserve the old gating: only admins could move an organization-visible deck back to private.
    const lockPrivate = isOrganization && !isAdmin;

    optionsWrap.append(
      radioRow({
        value: 'private',
        checked: !isOrganization,
        disabled: lockPrivate,
        titleText: t('share.visibility.privateTitle', 'Only people you invite'),
        descText: lockPrivate
          ? t(
              'share.visibility.privateLocked',
              'Only an admin can move this out of the workspace.',
            )
          : t(
              'share.visibility.privateDesc',
              'Stays private; only you and the people you invite below can see it.',
            ),
        onSelect: moveToPrivate,
      }),
    );

    const organizationRow = radioRow({
      value: 'organization',
      checked: isOrganization,
      titleText: t(
        'share.visibility.everyoneTitle',
        'Everyone in your workspace',
      ),
      descText: t(
        'share.visibility.everyoneDesc',
        'Appears in the shared workspace for all members.',
      ),
      onSelect: () => shareToOrganization(isViewOnly),
    });
    optionsWrap.append(organizationRow);

    // Access sub-choice, only meaningful once the deck is organization-visible.
    if (isOrganization) {
      const sub = h('div', { class: 'share-visibility-access' });
      const mkPill = (viewOnly, labelText) => {
        const active = isViewOnly === viewOnly;
        return h('button', {
          type: 'button',
          class: `share-access-pill${active ? ' is-active' : ''}`,
          'aria-pressed': String(active),
          text: labelText,
          onclick: () => {
            if (active || busy) return;
            applyVisibility({
              visibility: 'organization',
              isViewOnly: viewOnly,
            });
          },
        });
      };
      sub.append(
        mkPill(true, t('editor.share.visibility.viewOnly', 'View & comment')),
        mkPill(false, t('editor.share.visibility.regular', 'Full access')),
      );
      optionsWrap.append(sub);
    }
  }

  render();

  return { element: section, refresh: render };
}
