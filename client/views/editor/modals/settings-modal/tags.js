import { t } from '../../../../lib/ui-i18n.js';
import { createTagEditor } from '../../../list/tag-editor.js';
import { createInlineError } from '../../../../lib/dom/inline-error.js';
import { h } from '../../../../lib/dom.js';

/**
 * Tags editor. Saves changes straight to the server (not via requestSave).
 * Returns the tag-editor instance so the caller can detach() it on close.
 *
 * @param {object} ctx - { h, pres, api }
 * @returns {{ el: HTMLElement, instance: ?object }}
 */
export function buildTagsSection({ pres, api }) {
  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.tags.title', 'Tags'),
  });
  const help = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.tags.help',
      'Add tags to organize and filter presentations. Press Enter or comma to add.',
    ),
  });

  // Always add the label first
  wrap.append(label);

  const initialTags = Array.isArray(pres.tags)
    ? pres.tags.map((tag) => (typeof tag === 'string' ? tag : tag.name))
    : [];

  // Saving happens on every change, with no Save button to sit beside, so a
  // refusal belongs under the editor it is about — not in a toast
  // (docs/reference/feedback-surfaces.md).
  const saveError = createInlineError();

  let instance = null;
  if (api) {
    try {
      instance = createTagEditor({
        api,
        initialTags,
        onChange: async (newTags) => {
          saveError.clear();
          try {
            const saved = await api(`/api/presentations/${pres.id}/tags`, {
              method: 'PUT',
              body: { tags: newTags },
            });
            // The server's answer is what the deck carries: it resolves which
            // names are the same tag, and its fold is not the browser's
            // (shared/tag-name.js).
            pres.tags = saved;
            instance?.setTags(saved.map((tag) => tag.name));
          } catch (err) {
            saveError.show(
              err?.message ||
                t(
                  'editor.deckSettings.tags.saveFailed',
                  'The tags were not saved.',
                ),
              { focus: false },
            );
          }
        },
      });
      wrap.append(instance.el, saveError.el, help);
    } catch (err) {
      console.error('Failed to create tag editor:', err);
      wrap.append(
        h('div', {
          class: 'help',
          text: t(
            'editor.deckSettings.tags.error',
            'Failed to load tag editor.',
          ),
        }),
      );
    }
  } else {
    wrap.append(
      h('div', {
        class: 'help',
        text: t(
          'editor.deckSettings.tags.unavailable',
          'Tags are not available in this mode.',
        ),
      }),
    );
  }

  return { el: wrap, instance };
}
