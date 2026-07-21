import { t } from '../../../../lib/ui-i18n.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/dom/icons.js';
import { createCollapsedState } from '../../../../lib/slide-authoring/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';
import { createItemSwapper } from '../../../../lib/slide-authoring/item-swap.js';

// Collapsed state manager for cards
const cardsState = createCollapsedState('card');

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

  used.add('cardCount');
  for (let i = 1; i <= 4; i += 1) {
    used.add(`card${i}Label`);
    used.add(`card${i}Body`);
  }

  const count = Math.max(
    1,
    Math.min(4, Number(slide.content?.cardCount || 4) || 4)
  );

  // Create swapper for card items
  const swapCards = createItemSwapper({
    getSlide: () => slide,
    getPrefix: (cardNum) => `card${cardNum}`,
    fields: ['Label', 'Body'],
    callbacks: { markDirty, rerenderEditor, scheduleUiRefresh },
  });

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

  const setCount = (n) => {
    const next = Math.max(1, Math.min(4, Number(n) || 1));
    slide.content.cardCount = String(next);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };
  const addCard = () => {
    if (count >= 4) return;
    setCount(count + 1);
  };

  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.cards.add', '+ Add card'),
      disabled: count >= 4,
      onclick: () => addCard(),
    }),
    h('div', { class: 'pill', text: `${count} / 4` })
  );
  const bulkToggle = collapseAllToggle({
    state: cardsState,
    keys: Array.from({ length: count }, (_, idx) => cardsState.getKey(slide.id, idx + 1)),
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

    const labelKey = `card${i}Label`;
    const bodyKey = `card${i}Body`;

    const labelInput = fieldText(
      t('editor.cards.label', 'Label'),
      slide.content?.[labelKey] || '',
      (v) => {
        slide.content[labelKey] = v;
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );

    const ta = h('textarea', {
      class: 'form-input form-textarea-md',
    });
    ta.value = slide.content?.[bodyKey] || '';
    ta.addEventListener('input', () => {
      slide.content[bodyKey] = ta.value;
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

    used.add(labelKey);
    used.add(bodyKey);
  }

  form.append(cardsContainer);
}
