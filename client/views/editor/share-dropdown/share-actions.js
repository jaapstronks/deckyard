/**
 * Share actions — handler for adding a published deck's embed to Notion.
 *
 * Workspace scope changes (share-to-workspace / move-to-private) now live inline
 * in the Share dialog's Workspace tab (`modals/share-modal/workspace-visibility-section.js`).
 */

import { h } from '../../../lib/dom.js';
import { normalizeLang } from '../../../lib/i18n.js';
import { confirmModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';

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
