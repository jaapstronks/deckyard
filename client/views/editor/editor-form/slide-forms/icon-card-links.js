/**
 * The icon-card-grid slide's per-card icon + link controls.
 *
 * DOCUMENTED EXCEPTION (route 4 PR D, editor-per-type-behaviour brief). This
 * is real one-type UI, not a table a declaration could replace:
 *
 * 1. The selected-card / all-cards split is an editing-surface decision, not
 *    a field property: with a card selected only that card's controls render
 *    in the element tab; with none, every card renders in a collapsed "Card
 *    icons & links" group so the Slide tab still leads with the at-a-glance
 *    settings.
 * 2. The declarative form would be a generic per-item settings card driven by
 *    `itemFields` (the card-equivalent of image-element-card.js). That is a
 *    real concept, but it needs both the icon picker and the card-link field
 *    in the closed vocabulary — for exactly one declarant today. A vocabulary
 *    of one is more expensive than this exception; promote it when a second
 *    card-type appears.
 *
 * The card numbering ("1. Title") and the collapsible are deliberate UX and
 * stay as they are.
 */
import { t } from '../../../../lib/ui-i18n.js';
import { fieldCardLink } from '../../fields/card-link-field.js';
import { h } from '../../../../lib/dom.js';

/**
 * Collapsible group for a bulky widget block, styled like the
 * Background/Accessibility sections. Big blocks default closed so the pane
 * leads with the at-a-glance settings (chrome re-org stap 3).
 *
 * @param {string} title - Summary label
 * @param {{ open?: boolean }} [opts]
 * @returns {{ el: HTMLElement, body: HTMLElement }}
 */
function collapsibleGroup(title, { open = false } = {}) {
  const el = h('details', { class: 'editor-advanced' });
  if (open) el.open = true;
  el.append(h('summary', { class: 'editor-advanced-summary', text: title }));
  const body = h('div', { class: 'editor-advanced-body' });
  el.append(body);
  return { el, body };
}

/**
 * Per-card icon picker + link: settings the wysiwyg deliberately never
 * covers. Renders the layout field first, then the card controls — into the
 * element tab for the selected card, or all cards in a slide-tab collapsible.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderIconCardExtras(ctx) {
  const {
    form,
    elementForm,
    selectedElement,
    slide,
    add,
    fieldRenderers,
    deckSlides,
    markDirty,
    scheduleUiRefresh,
  } = ctx;

  add('layout');
  const items = Array.isArray(slide.content?.items) ? slide.content.items : [];
  if (!items.length) return;
  const { fieldIconPicker } = fieldRenderers || {};
  const renderCard = (item, idx, container) => {
    const group = h('div', { class: 'stack card-group' });
    group.append(
      h('div', {
        class: 'help',
        text: `${idx + 1}. ${String(item?.title || '').trim() || t('editor.inspector.cardUntitled', 'Untitled card')}`,
      }),
    );
    if (typeof fieldIconPicker === 'function') {
      group.append(
        fieldIconPicker(
          t('editor.cards.icon', 'Icon'),
          item.icon || '',
          (v) => {
            items[idx].icon = v;
            markDirty?.();
            scheduleUiRefresh?.();
          },
          {},
        ),
      );
    }
    group.append(
      fieldCardLink({
        value: item.link || '',
        slides: deckSlides,
        onChange: (v) => {
          items[idx].link = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        help: t(
          'editor.cards.linkHelp2',
          'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).',
        ),
      }),
    );
    container.append(group);
  };

  const cardIdx =
    selectedElement?.kind === 'card' && selectedElement.idx < items.length
      ? selectedElement.idx
      : null;
  if (cardIdx != null) {
    renderCard(items[cardIdx], cardIdx, elementForm);
  } else {
    const section = collapsibleGroup(
      t('editor.inspector.cardsConfig', 'Card icons & links'),
    );
    items.forEach((item, idx) => renderCard(item, idx, section.body));
    form.append(section.el);
  }
}
