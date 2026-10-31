/**
 * Share actions — handler for adding a published deck's embed to Notion.
 *
 * Organization scope changes (share with the organization / move to private)
 * live inline in the Share dialog's Team tab (`modals/share-modal/visibility-section.js`).
 */

import { normalizeLang } from '../../../lib/format/i18n.js';
import { confirmModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { DEFAULT_DECK_LANG } from '../../../../shared/i18n-utils.js';
import { isPublished } from '../publish-export/publish.js';

/**
 * Handle publishing to Notion.
 * @param {Object} options
 * @returns {Promise<void>}
 */
export async function handleNotionPublish({ api, toast, pres }) {
  const notionPageId = pres?.notionSourcePageId;

  if (!notionPageId || !isPublished(pres)) {
    toast?.(
      t(
        'editor.publish.notion.notAvailable',
        'Notion publishing not available for this presentation.',
      ),
    );
    return;
  }

  const lang = normalizeLang(pres?.i18n?.active) || DEFAULT_DECK_LANG;
  // The newest edition, frameable: the Notion page keeps showing this version.
  const { publicationId, version } = pres.published;
  const embedUrl = `${location.origin}/embed/${publicationId}/${version}?lang=${encodeURIComponent(lang)}`;
  const title = pres?.title || '';

  const confirmed = await confirmModal(document.body, {
    title: t('editor.publish.notion', 'Add to Notion page'),
    message: t(
      'editor.publish.notion.confirm',
      'Add presentation embed to the source Notion page?\n\nThis will add a divider, heading, and embedded presentation at the bottom of the Notion page.',
    ),
  });
  if (!confirmed) return;

  try {
    const result = await api('/api/notion/publish', {
      method: 'POST',
      body: { pageId: notionPageId, embedUrl, title, lang },
    });
    toast?.(
      result?.message ||
        t('editor.publish.notion.success', 'Added to Notion page!'),
    );
  } catch (e) {
    const msg = e?.message || String(e);
    toast?.(
      t(
        'editor.publish.notion.failedWithReason',
        'Failed to add to Notion: {reason}',
        { reason: msg },
      ),
    );
  }
}
