import { hasLangVersion, normalizeLang, otherLang } from '../../lib/i18n.js';
import { lockDocumentScroll } from './editor-utils.js';
import { copyToClipboard } from './publish-export/clipboard.js';
import { openPublishModal } from './publish-export/publish-modal.js';
import { doPublish } from './publish-export/publish.js';
import { createExportButtons, createExportHeader, createOtherLangExportSection } from './publish-export/export-buttons.js';
import { openShareModal } from './modals/share-modal.js';
import { createDropdown } from '../../lib/dropdown.js';
import { t } from '../../lib/ui-i18n.js';
import { confirmModal } from '../../lib/modal.js';
import { withLoadingModal } from '../../lib/loading-modal.js';

export function setupPublishExportDropdown({
  h,
  api,
  toast,
  pres,
  id,
  requestSave,
  onError,
  root,
  openOverlayClosers,
} = {}) {
  // Will be assigned after the publish dropdown is created.
  // Kept as a function reference so the publish modal can update the topbar.
  let syncPublishUi = () => {};

  const doPublishWithModal = async () =>
    doPublish({
      h,
      root,
      api,
      toast,
      pres,
      id,
      requestSave,
      openPublishModal: (data) =>
        openPublishModal({
          ...data,
          h,
          api,
          pres,
          id,
          root,
          openOverlayClosers,
          lockDocumentScroll,
          copyToClipboard,
          syncPublishUi,
        }),
      openOverlayClosers,
    });

  const summaryLabel = h('span', { text: t('editor.publish.publish', 'Publish') });
  const { details: publishDetails, summary: publishSummary, menu, close, detach } = createDropdown({
    h,
    triggerClass: 'btn btn-secondary',
    triggerContent: [
      summaryLabel,
      h('span', {
        class: 'dropdown-caret',
        text: '▾',
        'aria-hidden': 'true',
      }),
    ],
    title: t('editor.publish.publish.title', 'Publish (make public via a link)'),
  });

  const publishItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.publish.publish', 'Publish'),
    onclick: async () => {
      close();
      try {
        // If already published, just open the modal again (no republish needed).
        if (pres?.published?.id) {
          await doPublishWithModal();
          syncPublishUi();
          return;
        }
        const pub = await doPublishWithModal();
        if (!pub) return;
        syncPublishUi();
      } catch (e) {
        onError?.(e);
      }
    },
  });

  const depublishItem = h('button', {
    class: 'dropdown-item is-danger',
    type: 'button',
    text: t('editor.publish.unpublish', 'Unpublish'),
    onclick: async () => {
      close();
      const publishId =
        typeof pres?.published?.id === 'string' ? pres.published.id : '';
      if (!publishId) return;
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
        syncPublishUi();
      } catch (e) {
        onError?.(e);
      }
    },
  });

  // "Publish to Notion" button - only shown when presentation came from Notion and is published
  const notionPublishItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.publish.notion', 'Add to Notion page'),
    onclick: async () => {
      close();
      const notionPageId = pres?.notionSourcePageId;
      const publishId = pres?.published?.id;
      const slug = pres?.published?.slug || '';

      if (!notionPageId || !publishId) {
        toast?.(t('editor.publish.notion.notAvailable', 'Notion publishing not available for this presentation.'));
        return;
      }

      // Build embed URL
      const lang = normalizeLang(pres?.i18n?.active) || 'nl';
      const embedUrl = `${location.origin}/embed/${publishId}${slug ? `-${slug}` : ''}?lang=${encodeURIComponent(lang)}`;
      const title = pres?.title || '';

      const confirmed = await confirmModal(h, root, {
        title: t('editor.publish.notion', 'Add to Notion page'),
        message: t(
          'editor.publish.notion.confirm',
          'Add presentation embed to the source Notion page?\n\nThis will add a divider, heading, and embedded presentation at the bottom of the Notion page.'
        ),
        confirmLabel: t('editor.publish.notion.add', 'Add'),
      });
      if (!confirmed) return;

      // Guard against a double-trigger while the (potentially slow) Notion
      // request is in flight, and show a loading modal for visible feedback.
      if (notionPublishItem.dataset.busy === '1') return;
      notionPublishItem.dataset.busy = '1';
      notionPublishItem.disabled = true;
      try {
        const result = await withLoadingModal({
          h,
          root,
          title: t('editor.publish.notion', 'Add to Notion page'),
          initialMessage: t('editor.publish.notion.adding', 'Adding to Notion…'),
          successMessage: t('editor.publish.notion.success', 'Added to Notion page!'),
          promise: api('/api/notion/publish', {
            method: 'POST',
            body: JSON.stringify({
              pageId: notionPageId,
              embedUrl,
              title,
              lang,
            }),
          }),
        });
        toast?.(result?.message || t('editor.publish.notion.success', 'Added to Notion page!'));
      } catch (e) {
        const msg = e?.message || String(e);
        toast?.(t('editor.publish.notion.failed', 'Failed to add to Notion: ') + msg);
      } finally {
        notionPublishItem.dataset.busy = '';
        notionPublishItem.disabled = false;
      }
    },
  });
  // Initially hidden; shown by syncPublishUi when conditions are met
  notionPublishItem.style.display = 'none';

  // Share links button
  const shareLinksItem = h('button', {
    class: 'dropdown-item',
    type: 'button',
    text: t('editor.more.shareLinks', 'Share links…'),
    title: t('editor.more.shareLinks.title', 'Create shareable links for external users (no account required).'),
    onclick: () => {
      close();
      openShareModal({
        h,
        api,
        pres,
        id,
        root,
        openOverlayClosers,
        lockDocumentScroll,
        copyToClipboard,
        toast,
      });
    },
  });

  // Check if Notion is available
  let notionAvailable = false;
  api('/api/notion/status')
    .then((resp) => {
      notionAvailable = !!resp?.enabled;
      syncPublishUi();
    })
    .catch(() => {
      notionAvailable = false;
    });

  // Export buttons factory helpers
  const primaryLang = normalizeLang(pres?.i18n?.active) || 'nl';

  const exportHeader = createExportHeader({ h, lang: primaryLang });
  const exportButtons = createExportButtons({ h, id, lang: primaryLang, closeDropdown: close });

  const maybeOtherLangExports = (() => {
    const other = otherLang(primaryLang);
    const hasOther = hasLangVersion(pres, other);
    if (!hasOther) return null;
    return createOtherLangExportSection({ h, id, otherLang: other, closeDropdown: close });
  })();

  menu.append(
    publishItem,
    depublishItem,
    notionPublishItem,
    shareLinksItem,
    h('div', { class: 'dropdown-sep' }),
    exportHeader,
    ...exportButtons
  );
  if (maybeOtherLangExports) menu.append(maybeOtherLangExports);

  syncPublishUi = () => {
    const isPublished = !!(
      typeof pres?.published?.id === 'string' && pres.published.id
    );
    depublishItem.disabled = !isPublished;
    publishItem.textContent = isPublished
      ? t('editor.publish.manage', 'Published (manage…)')
      : t('editor.publish.publish', 'Publish');

    // Show "Add to Notion page" only if:
    // - Notion is available (NOTION_SECRET configured)
    // - Presentation has a notionSourcePageId (came from Notion)
    // - Presentation is published (has an embed URL)
    const hasNotionSource = !!(
      typeof pres?.notionSourcePageId === 'string' && pres.notionSourcePageId
    );
    const showNotionPublish = notionAvailable && hasNotionSource && isPublished;
    notionPublishItem.style.display = showNotionPublish ? '' : 'none';

    // Summary label: keep short for toolbar; show live dot when published.
    summaryLabel.textContent = isPublished
      ? t('editor.publish.published', 'Published')
      : t('editor.publish.publish', 'Publish');
    publishSummary.title = isPublished
      ? t(
          'editor.publish.published.title',
          'Published (manage links and settings)'
        )
      : t('editor.publish.publish.title', 'Publish (make public via a link)');
    publishSummary.classList.toggle('btn-published', isPublished);
    // Optional visual dot for published state
    try {
      const existingDot = publishSummary.querySelector('.live-dot');
      if (isPublished && !existingDot) {
        publishSummary.insertBefore(
          h('span', { class: 'live-dot', 'aria-hidden': 'true', text: '●' }),
          summaryLabel
        );
      } else if (!isPublished && existingDot) {
        existingDot.remove();
      }
    } catch {
      // ignore
    }
  };
  syncPublishUi();

  return { publishEl: publishDetails, syncPublishUi, detach };
}
