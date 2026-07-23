import { t } from '../../../../lib/ui-i18n.js';
import { createTagEditor } from '../../../list/tag-editor.js';

/**
 * Tags editor. Saves changes straight to the server (not via requestSave).
 * Returns the tag-editor instance so the caller can detach() it on close.
 *
 * @param {object} ctx - { h, pres, api }
 * @returns {{ el: HTMLElement, instance: ?object }}
 */
export function buildTagsSection({ h, pres, api }) {
  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.tags.title', 'Tags'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.tags.help',
      'Add tags to organize and filter presentations. Press Enter or comma to add.'
    ),
  });

  // Always add the label first
  wrap.append(label);

  const initialTags = Array.isArray(pres.tags)
    ? pres.tags.map((tag) => (typeof tag === 'string' ? tag : tag.name))
    : [];

  let instance = null;
  if (api) {
    try {
      instance = createTagEditor({
        api,
        initialTags,
        onChange: async (newTags) => {
          try {
            await api(`/api/presentations/${pres.id}/tags`, {
              method: 'PUT',
              body: { tags: newTags },
            });
            pres.tags = newTags.map((name) => ({ name }));
          } catch (err) {
            console.error('Failed to save tags:', err);
          }
        },
      });
      wrap.append(instance.el, help);
    } catch (err) {
      console.error('Failed to create tag editor:', err);
      wrap.append(
        h('div', {
          class: 'help',
          text: t('editor.deckSettings.tags.error', 'Failed to load tag editor.'),
        })
      );
    }
  } else {
    wrap.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.deckSettings.tags.unavailable',
          'Tags are not available in this mode.'
        ),
      })
    );
  }

  return { el: wrap, instance };
}
