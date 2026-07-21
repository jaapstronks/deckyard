/**
 * Publish section for the unified Share dialog.
 *
 * The "hosted, public" surface: put the deck on the open web (/p/) and expose
 * the embed. Publishing produces the same standalone page you can also download
 * from Export → HTML, so a cross-reference points at that offline twin.
 *
 * Heavy management (social preview, slug, iframe/SDK snippets) still lives in
 * the dedicated publish modal; this section is the funnel that launches it.
 */

import { t } from '../../../../lib/ui-i18n.js';
import { confirmModal } from '../../../../lib/dom/modal.js';

/**
 * Create the publish section.
 * @param {Object} options
 * @param {Function} options.h - Hyperscript function
 * @param {Function} options.api - API call function
 * @param {Object} options.pres - Presentation object
 * @param {string} options.id - Presentation ID
 * @param {HTMLElement} options.modalRoot - Root element for nested modals
 * @param {Function} options.copyToClipboard - Clipboard copy function
 * @param {Object} options.toast - Toast notification service
 * @param {Function} options.doPublish - Runs the full publish flow
 * @param {Function} options.buildPublishModalData - Builds URLs from pres state
 * @param {Function} options.openPublishModal - Opens the publish management modal
 * @param {Function} options.handleNotionPublish - Adds the embed to Notion
 * @param {Function} options.notionAvailable - Returns true if Notion is enabled
 * @param {Function} options.syncShareUi - Refresh the topbar share button + dialog
 * @param {Function} options.openExport - Opens the Export modal (offline twin)
 * @param {Function} options.requestClose - Close the share dialog
 * @returns {{ element: HTMLElement, refresh: Function }}
 */
export function createPublishSection({
  h,
  api,
  pres,
  id,
  modalRoot,
  copyToClipboard,
  toast,
  doPublish,
  buildPublishModalData,
  openPublishModal,
  handleNotionPublish,
  notionAvailable,
  syncShareUi,
  openExport,
  requestClose,
}) {
  const section = h('div', { class: 'share-publish-section' });

  function isPublished() {
    return !!(typeof pres?.published?.id === 'string' && pres.published.id);
  }

  async function publishNow(button) {
    button.disabled = true;
    const original = button.textContent;
    button.textContent = t('share.publish.publishing', 'Publishing…');
    try {
      // Suppress the publish modal here: we render the result inline instead of
      // stacking a second modal on top of the share dialog.
      const pub = await doPublish({ openPublishModal: () => {} });
      if (pub) {
        syncShareUi?.();
        render();
      }
    } catch (e) {
      toast?.error?.(String(e?.message || e), { durationMs: 3000 });
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function openManage() {
    openPublishModal?.(buildPublishModalData({ pres }));
  }

  async function unpublish() {
    const ok = await confirmModal(
      h,
      modalRoot || document.body,
      {
        title: t('editor.publish.unpublish', 'Unpublish'),
        message: t(
          'editor.publish.unpublish.confirm',
          'Unpublish?\n\nThis will invalidate the public link and embed links.'
        ),
        confirmLabel: t('editor.publish.unpublish', 'Unpublish'),
        danger: true,
      }
    );
    if (!ok) return;
    try {
      await api(`/api/presentations/${id}/publish`, { method: 'DELETE' });
      delete pres.published;
      syncShareUi?.();
      render();
    } catch (e) {
      toast?.error?.(String(e?.message || e), { durationMs: 3000 });
    }
  }

  /** Cross-reference to the offline twin (Export → HTML). */
  function exportHint() {
    const link = h('button', {
      type: 'button',
      class: 'link-button',
      text: t('share.publish.exportLink', 'Export as a web page instead →'),
      onclick: () => {
        requestClose?.();
        openExport?.();
      },
    });
    return h('div', { class: 'share-xref-hint' }, [
      h('span', { text: t('share.publish.exportHint', 'Prefer an offline file to hand over? ') }),
      link,
    ]);
  }

  function render() {
    section.innerHTML = '';
    const title = h('div', {
      class: 'share-section-title',
      text: t('share.publish.title', 'Put it on the open web'),
    });
    const help = h('div', {
      class: 'help share-publish-help',
      text: t(
        'share.publish.help',
        'A public, findable page with a social preview. It stays current and you can unpublish it anytime.'
      ),
    });
    section.append(title, help);

    if (!isPublished()) {
      const publishBtn = h('button', {
        class: 'btn btn-primary',
        type: 'button',
        text: t('editor.publish.publish', 'Publish'),
        onclick: () => publishNow(publishBtn),
      });
      section.append(h('div', { class: 'share-publish-actions' }, [publishBtn]), exportHint());
      return;
    }

    // Published: show the public URL + management actions.
    const data = buildPublishModalData({ pres });
    const urlInput = h('input', {
      class: 'form-input share-publish-url',
      readonly: true,
      value: data.url || '',
      'aria-label': t('share.publish.urlLabel', 'Public link'),
    });
    urlInput.addEventListener('focus', () => urlInput.select());
    const copyBtn = h('button', {
      class: 'btn btn-primary btn-sm',
      type: 'button',
      text: t('common.copy', 'Copy'),
      onclick: async () => {
        const ok = await copyToClipboard(data.url);
        if (ok) toast?.success?.(t('common.copied', 'Copied!'), { durationMs: 1500 });
        urlInput.focus();
      },
    });
    section.append(h('div', { class: 'share-publish-url-row' }, [urlInput, copyBtn]));

    const actions = h('div', { class: 'share-publish-actions' });
    actions.append(
      h('button', {
        class: 'btn btn-secondary',
        type: 'button',
        text: t('editor.publish.manage', 'Manage published…'),
        title: t('share.publish.manageTitle', 'Social preview, slug, embed code'),
        onclick: openManage,
      })
    );
    if (notionAvailable?.() && typeof pres?.notionSourcePageId === 'string' && pres.notionSourcePageId) {
      actions.append(
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          text: t('editor.publish.notion', 'Add to Notion page'),
          onclick: () => handleNotionPublish?.(),
        })
      );
    }
    actions.append(
      h('button', {
        class: 'btn btn-danger',
        type: 'button',
        text: t('editor.publish.unpublish', 'Unpublish'),
        onclick: unpublish,
      })
    );
    section.append(actions, exportHint());
  }

  render();

  return { element: section, refresh: render };
}
