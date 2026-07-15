/**
 * Share actions - handlers for workspace sharing and private move.
 */

import { h } from '../../../lib/dom.js';
import { normalizeLang } from '../../../lib/i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { ifMatchRevision } from '../if-match-revision.js';
import { openWorkspaceShareModal } from './workspace-share-modal.js';

/**
 * Handle sharing to workspace.
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function handleShareToWorkspace({
  h,
  api,
  toast,
  pres,
  id,
  root,
  isDirty,
  requestSave,
  openDescriptionModal,
  openOverlayClosers,
  syncShareUi,
  editorState,
}) {
  if (String(pres?.scope || 'private') === 'workspace') {
    toast.info(t('editor.share.workspace.already', 'Already shared to workspace.'), {
      id: 'share-workspace',
      durationMs: 2400,
    });
    return;
  }

  if (isDirty?.()) {
    toast.info(t('common.savingFirst', 'Saving first...'), { id: 'share-workspace', durationMs: 5200 });
    await requestSave?.();
    if (isDirty?.()) {
      toast.error(t('common.saveFailedAborted', 'Could not save; aborted.'), { id: 'share-workspace' });
      return;
    }
  }

  // Require a deck description before sharing
  const hasDesc = typeof pres?.description === 'string' && pres.description.trim();
  if (!hasDesc) {
    const r = await openDescriptionModal({
      h,
      root,
      api,
      toast,
      pres,
      id,
      context: 'share',
      openOverlayClosers,
      requestSave,
    });
    if (!r?.ok) return;
  }

  // Show share options modal (full access, view only, or starter kit)
  const shareResult = await openWorkspaceShareModal({ h, pres, root });
  if (!shareResult) return;

  try {
    const updated = await api(`/api/presentations/${id}/scope`, {
      method: 'PATCH',
      headers: { 'If-Match': await ifMatchRevision({ api, id, pres }) },
      body: JSON.stringify({
        scope: 'workspace',
        isStarterKit: shareResult.isStarterKit,
        isViewOnly: shareResult.isViewOnly,
      }),
    });
    if (updated && typeof updated === 'object') {
      if (typeof updated.scope === 'string') pres.scope = updated.scope;
      if (typeof updated.isStarterKit === 'boolean') pres.isStarterKit = updated.isStarterKit;
      if (typeof updated.isViewOnly === 'boolean') pres.isViewOnly = updated.isViewOnly;
      if (typeof updated.revision === 'number') pres.revision = updated.revision;
      if (typeof updated.updatedBy === 'string') pres.updatedBy = updated.updatedBy;
    }
    let msg;
    if (shareResult.isStarterKit) {
      msg = t('editor.share.workspace.doneStarterKit', 'Shared as starter kit.');
    } else if (shareResult.isViewOnly) {
      msg = t('editor.share.workspace.doneViewOnly', 'Shared as view only.');
    } else {
      msg = t('editor.share.workspace.done', 'Shared to workspace.');
    }
    toast.success(msg, { id: 'share-workspace', durationMs: 2200 });
    syncShareUi();
    editorState.refreshAll();
  } catch (e) {
    toast.error(String(e?.message || e), { id: 'share-workspace' });
  }
}

/**
 * Handle moving presentation to private.
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function handleMoveToPrivate({
  api,
  toast,
  pres,
  id,
  isDirty,
  requestSave,
  syncShareUi,
  editorState,
}) {
  if (String(pres?.scope || 'private') === 'private') {
    toast.info(t('editor.share.private.already', 'Already private.'), {
      id: 'move-private',
      durationMs: 2400,
    });
    return;
  }

  if (isDirty?.()) {
    toast.info(t('common.savingFirst', 'Saving first...'), { id: 'move-private', durationMs: 5200 });
    await requestSave?.();
    if (isDirty?.()) {
      toast.error(t('common.saveFailedAborted', 'Could not save; aborted.'), { id: 'move-private' });
      return;
    }
  }

  const ok = await confirmModal(h, document.body, {
    title: t('editor.share.private', 'Move to private'),
    message: t(
      'editor.share.private.confirm',
      'Move "{title}" to private? It will no longer be visible to other workspace members.',
      { title: pres?.title || t('editor.share.thisPresentation', 'this presentation') }
    ),
    confirmLabel: t('editor.share.private', 'Move to private'),
  });
  if (!ok) return;

  try {
    const updated = await api(`/api/presentations/${id}/scope`, {
      method: 'PATCH',
      headers: { 'If-Match': await ifMatchRevision({ api, id, pres }) },
      body: JSON.stringify({ scope: 'private' }),
    });
    if (updated && typeof updated === 'object') {
      if (typeof updated.scope === 'string') pres.scope = updated.scope;
      if (typeof updated.revision === 'number') pres.revision = updated.revision;
      if (typeof updated.updatedBy === 'string') pres.updatedBy = updated.updatedBy;
    }
    toast.success(t('editor.share.private.done', 'Moved to private.'), { id: 'move-private', durationMs: 2200 });
    syncShareUi();
    editorState.refreshAll();
  } catch (e) {
    toast.error(String(e?.message || e), { id: 'move-private' });
  }
}

/**
 * Handle publishing to Notion.
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function handleNotionPublish({ api, toast, pres }) {
  const notionPageId = pres?.notionSourcePageId;
  const publishId = pres?.published?.id;
  const slug = pres?.published?.slug || '';

  if (!notionPageId || !publishId) {
    toast?.(t('editor.publish.notion.notAvailable', 'Notion publishing not available for this presentation.'));
    return;
  }

  const lang = normalizeLang(pres?.i18n?.active) || 'nl';
  const embedUrl = `${location.origin}/embed/${publishId}${slug ? `-${slug}` : ''}?lang=${encodeURIComponent(lang)}`;
  const title = pres?.title || '';

  const confirmed = await confirmModal(h, document.body, {
    title: t('editor.publish.notion', 'Add to Notion page'),
    message: t(
      'editor.publish.notion.confirm',
      'Add presentation embed to the source Notion page?'
    ),
  });
  if (!confirmed) return;

  try {
    const result = await api('/api/notion/publish', {
      method: 'POST',
      body: JSON.stringify({ pageId: notionPageId, embedUrl, title, lang }),
    });
    toast?.(result?.message || t('editor.publish.notion.success', 'Added to Notion page!'));
  } catch (e) {
    const msg = e?.message || String(e);
    toast?.(t('editor.publish.notion.failed', 'Failed to add to Notion: ') + msg);
  }
}
