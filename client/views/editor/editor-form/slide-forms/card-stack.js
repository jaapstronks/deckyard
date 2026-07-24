import { t } from '../../../../lib/ui-i18n.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/dom/icons.js';
import { createCollapsedState } from '../../../../lib/slide-authoring/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';

// Collapsed state manager for cards
const cardsState = createCollapsedState('card');

const MAX_CARDS = 6;

/**
 * Sync items[] back to the numbered mirror for backward compatibility. The
 * canonical shape is items[]; the numbered fields survive as a hidden legacy
 * mirror (old code paths + decks predating the migration keep loading). Card
 * titles write the canonical `card{n}Title` (getCardTitle reads it first).
 */
export function syncCardStackToNumbered(slide) {
  const items = slide.content.items || [];
  slide.content.cardCount = String(items.length);
  for (let i = 0; i < MAX_CARDS; i += 1) {
    const item = items[i] || {};
    slide.content[`card${i + 1}Title`] = item.title || '';
    slide.content[`card${i + 1}Body`] = item.body || '';
  }
}

export function renderCardStackForm({
  h,
  form,
  slide,
  add,
  used,
  fieldGrid,
  fieldText,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
  removeCardAtIndex,
} = {}) {
  add('title');
  add('subheading');

  // Mark every card-related field as used so the generic renderer skips them.
  used.add('items');
  used.add('cardCount');
  for (let i = 1; i <= MAX_CARDS; i += 1) {
    used.add(`card${i}Title`);
    used.add(`card${i}Label`);
    used.add(`card${i}Body`);
  }

  // Normalize: materialize items[] from the numbered mirror when absent, so the
  // form always edits one shape (the read funnel already does this server-side;
  // this guards decks opened before the migration ran).
  if (!Array.isArray(slide.content.items) || slide.content.items.length === 0) {
    const legacyCount = Math.max(1, Math.min(MAX_CARDS, Number(slide.content.cardCount || 4) || 4));
    slide.content.items = [];
    for (let i = 1; i <= legacyCount; i += 1) {
      slide.content.items.push({
        title: slide.content[`card${i}Title`] || slide.content[`card${i}Label`] || '',
        body: slide.content[`card${i}Body`] || '',
      });
    }
  }

  const items = slide.content.items;
  const count = items.length;

  // Swap two cards in items[]
  const swapCards = (fromIdx, toIdx) => {
    const from = fromIdx - 1;
    const to = toIdx - 1;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    syncCardStackToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  const cardControls = h('div', { class: 'stack' });
  cardControls.append(
    h('div', {
      class: 'field-label',
      text: t('editor.cards.title', 'Cards'),
    })
  );
  const controlsRow = h('div', {
    class: 'row is-wrap',
  });

  const addCard = () => {
    if (count >= MAX_CARDS) return;
    items.push({ title: '', body: '' });
    syncCardStackToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.cards.add', '+ Add card'),
      disabled: count >= MAX_CARDS,
      onclick: () => addCard(),
    }),
    h('div', { class: 'pill', text: `${count} / ${MAX_CARDS}` })
  );
  const bulkToggle = collapseAllToggle({
    state: cardsState,
    keys: items.map((_, idx) => cardsState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) controlsRow.append(bulkToggle);
  cardControls.append(controlsRow);
  form.append(cardControls);

  // Cards container for drag and drop
  const cardsContainer = h('div', { class: 'items-reorder-list four-cards-list' });

  // Drag state tracking
  let draggingCardIndex = null;
  let dropTargetIndex = null;

  const clearDropIndicators = () => {
    for (const el of cardsContainer.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    }
    dropTargetIndex = null;
  };

  for (let i = 1; i <= count; i += 1) {
    const idx = i - 1;
    const item = items[idx] || {};

    // Get collapsed state for this card
    const cardKey = cardsState.getKey(slide.id, i);
    const isCollapsed = cardsState.isCollapsed(cardKey);

    const cardWrap = h('div', { class: 'stack card-group' });
    cardWrap.dataset.cardIndex = String(i);
    if (isCollapsed) {
      cardWrap.classList.add('is-collapsed');
    }

    const cardHeader = h('div', {
      class: 'row spread card-group-header',
    });

    // Left side: drag handle + collapse toggle + title
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Drag handle
    const dragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.cards.dragToReorder', 'Drag to reorder'),
      draggable: 'true',
    });
    dragHandle.appendChild(dragHandleIcon());

    dragHandle.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', String(i));
      e.dataTransfer.effectAllowed = 'move';
      draggingCardIndex = i;
      cardWrap.classList.add('is-dragging');
    });

    dragHandle.addEventListener('dragend', () => {
      draggingCardIndex = null;
      cardWrap.classList.remove('is-dragging');
      clearDropIndicators();
    });

    headerLeft.append(dragHandle);

    // Collapse/expand toggle
    const collapseBtn = h('button', {
      type: 'button',
      class: 'row-collapse-toggle',
      title: isCollapsed
        ? t('editor.cards.expand', 'Expand')
        : t('editor.cards.collapse', 'Collapse'),
    });
    collapseBtn.appendChild(chevronDownIcon());
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      cardsState.toggle(cardKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    headerLeft.append(
      h('div', {
        class: 'card-group-title',
        text: t('editor.cards.cardN', 'Card {n}', { n: i }),
      })
    );

    cardHeader.append(headerLeft);

    if (count > 1) {
      cardHeader.append(
        h('button', {
          class: 'btn btn-secondary btn-icon card-remove-btn',
          type: 'button',
          text: '×',
          title: t('editor.cards.deleteTitle', 'Delete card {n}', { n: i }),
          'aria-label': t('editor.cards.deleteTitle', 'Delete card {n}', { n: i }),
          onclick: () => {
            const ok = removeCardAtIndex?.(slide, i);
            if (!ok) return;
            markDirty?.();
            rerenderEditor?.();
            scheduleUiRefresh?.();
          },
        })
      );
    }
    cardWrap.append(cardHeader);

    // Collapsible content
    const cardContent = h('div', { class: 'block-collapsible-content' });
    if (isCollapsed) {
      cardContent.style.display = 'none';
    }

    const labelInput = fieldText(
      t('editor.cards.label', 'Label'),
      item.title || '',
      (v) => {
        items[idx].title = v;
        syncCardStackToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );

    const ta = h('textarea', {
      class: 'form-input form-textarea-md',
    });
    ta.value = item.body || '';
    ta.addEventListener('input', () => {
      items[idx].body = ta.value;
      syncCardStackToNumbered(slide);
      markDirty?.();
      scheduleUiRefresh?.();
    });
    const bodyInput = h('div', { class: 'stack' }, [
      h('div', {
        class: 'field-label',
        text: t('editor.cards.bodyMarkdown', 'Body (Markdown)'),
      }),
      ta,
    ]);

    cardContent.append(fieldGrid([labelInput, bodyInput], 2));
    cardWrap.append(cardContent);

    // Drag over handling
    cardWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingCardIndex === null || draggingCardIndex === i) {
        clearDropIndicators();
        return;
      }

      const rect = cardWrap.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';

      clearDropIndicators();
      cardWrap.classList.add(`is-drop-${pos}`);
      dropTargetIndex = i;
    });

    cardWrap.addEventListener('dragleave', (e) => {
      if (e.currentTarget?.contains?.(e.relatedTarget)) return;
      if (dropTargetIndex === i) clearDropIndicators();
    });

    cardWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIndex = draggingCardIndex;
      const toIndex = i;

      if (fromIndex && fromIndex !== toIndex) {
        swapCards(fromIndex, toIndex);
      }

      draggingCardIndex = null;
      clearDropIndicators();
    });

    cardsContainer.append(cardWrap);
  }

  form.append(cardsContainer);
}
