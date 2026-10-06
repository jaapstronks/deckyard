/**
 * The icon-card-grid slide's all-cards overview of icon + link.
 *
 * DOCUMENTED EXCEPTION (route 4 PR D, editor-per-type-behaviour brief), now
 * only half of one: the selected-card controls are the shared "This card"
 * card (item-element-card.js), driven by the `card` element tab's `fields`
 * since B450 gave that card a second and third declarant (text-blocks rows,
 * matrix cells). What stays here is an editing-surface decision rather than a
 * field property: with NO card selected, every card's controls render in a
 * collapsed "Card icons & links" group so the Slide tab still leads with the
 * at-a-glance settings. The card numbering ("1. Title") and the collapsible
 * are deliberate UX.
 */
import { t } from '../../../../lib/ui-i18n.js';
import { renderItemElementCard } from '../item-element-card.js';
import { h } from '../../../../lib/dom/index.js';

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
 * The all-cards overview of the per-card icon + link: with no card selected,
 * every card's "This card" controls render in a collapsed "Card icons & links"
 * group on the Slide tab, numbered by card. A selected card gets the same
 * controls in its own tab through the shared item card (the `card` element
 * tab's `fields`), so this module renders only the overview.
 *
 * @param {Object} ctx - Same context shape as renderSlideFormByType
 */
export function renderIconCardExtras(ctx) {
  const { form, selectedElement, slide, add } = ctx;

  add('layout');
  const items = Array.isArray(slide.content?.items) ? slide.content.items : [];
  if (!items.length || selectedElement?.kind === 'card') return;
  const section = collapsibleGroup(
    t('editor.inspector.cardsConfig', 'Card icons & links'),
  );
  items.forEach((item, idx) => {
    const group = h('div', { class: 'stack card-group' });
    group.append(
      h('div', {
        class: 'help',
        text: `${idx + 1}. ${String(item?.title || '').trim() || t('editor.inspector.cardUntitled', 'Untitled card')}`,
      }),
    );
    renderItemElementCard({ ...ctx, container: group, idx });
    section.body.append(group);
  });
  form.append(section.el);
}
