import { t } from '../../../../lib/ui-i18n.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/dom/icons.js';
import { createCollapsedState } from '../../../../lib/slide-authoring/collapsed-state.js';
import { fieldCardLink } from '../../fields/card-link-field.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';

// Collapsed state manager for icon cards
const iconCardsState = createCollapsedState('iconcard');

/**
 * Sync items[] back to numbered fields for backward compatibility.
 * This ensures older code paths and the renderer can use either format.
 * Exported for the phase-3 inspector, whose per-card icon/link controls
 * write items[] and must keep the numbered mirror in sync like the form.
 */
export function syncIconCardsToNumbered(slide) {
  syncToNumbered(slide);
}

function syncToNumbered(slide) {
  const items = slide.content.items || [];
  slide.content.cardCount = String(items.length);
  for (let i = 0; i < 6; i++) {
    const item = items[i] || {};
    slide.content[`card${i + 1}Icon`] = item.icon || '';
    slide.content[`card${i + 1}Title`] = item.title || '';
    slide.content[`card${i + 1}Body`] = item.body || '';
    slide.content[`card${i + 1}Link`] = item.link || '';
  }
}

export function renderIconCardGridForm({
  h,
  form,
  slide,
  add,
  used,
  fieldText,
  fieldIconPicker,
  deckSlides = [],
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
  removeIconGridCardAtIndex,
  placeTextSection,
} = {}) {
  add('title');
  add('subheading');
  // Keep the text fields grouped together above the cards in the edit column.
  // (bottomSubheading still renders as a caption *under* the cards on the slide;
  // this only affects its position in the editor form.)
  add('bottomSubheading');
  // Position the collapsed "Text" section above the cards, not below them.
  placeTextSection?.();
  add('layout');

  // Tiles layout is a single row of up to 4 cards; cards layout allows up to 6.
  const layout = slide.content?.layout === 'tiles' ? 'tiles' : 'cards';
  const maxCards = layout === 'tiles' ? 4 : 6;

  // Mark all card-related fields as used (hide from generic renderer)
  used.add('items');
  used.add('cardCount');
  for (let i = 1; i <= 6; i += 1) {
    used.add(`card${i}Icon`);
    used.add(`card${i}Title`);
    used.add(`card${i}Body`);
    used.add(`card${i}Link`);
  }

  // Normalize: if no items[] but numbered fields exist, build items on the fly
  if (!Array.isArray(slide.content.items) || slide.content.items.length === 0) {
    const legacyCount = Math.max(1, Math.min(6, Number(slide.content.cardCount || 6) || 6));
    slide.content.items = [];
    for (let i = 1; i <= legacyCount; i++) {
      slide.content.items.push({
        icon: slide.content[`card${i}Icon`] || '',
        title: slide.content[`card${i}Title`] || '',
        body: slide.content[`card${i}Body`] || '',
        link: slide.content[`card${i}Link`] || '',
      });
    }
  }

  const items = slide.content.items;
  const count = items.length;

  // Swap two cards in items[]
  function swapCards(fromIdx, toIdx) {
    // Convert 1-based indices to 0-based
    const from = fromIdx - 1;
    const to = toIdx - 1;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  }

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
    if (count >= maxCards) return;
    items.push({ icon: 'lightbulb', title: '', body: '', link: '' });
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.cards.add', '+ Add card'),
      disabled: count >= maxCards,
      onclick: () => addCard(),
    }),
    h('div', { class: 'pill', text: `${count} / ${maxCards}` })
  );
  const bulkToggle = collapseAllToggle({
    state: iconCardsState,
    keys: items.map((_, idx) => iconCardsState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) controlsRow.append(bulkToggle);
  cardControls.append(controlsRow);
  form.append(cardControls);

  // Cards container for drag and drop
  const cardsContainer = h('div', { class: 'items-reorder-list icon-cards-list' });

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
    const cardKey = iconCardsState.getKey(slide.id, i);
    const isCollapsed = iconCardsState.isCollapsed(cardKey);

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

    // Subtle index badge on drag handle
    const indexBadge = h('span', { class: 'item-index-badge' });
    indexBadge.textContent = String(i);
    dragHandle.appendChild(indexBadge);

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
      iconCardsState.toggle(cardKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    // Show card title as header (falls back to placeholder when empty)
    const cardTitle = items[i - 1]?.title || '';
    const titlePreview = h('div', {
      class: `card-group-title item-title-preview${cardTitle ? '' : ' is-placeholder'}`,
      text: cardTitle || t('editor.cards.untitledCard', 'Untitled card'),
    });
    headerLeft.append(titlePreview);

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
            const ok = removeIconGridCardAtIndex?.(slide, i);
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

    // Use 0-based index into items[]
    const idx = i - 1;
    const item = items[idx] || {};

    const iconInput = fieldIconPicker(
      t('editor.cards.icon', 'Icon'),
      item.icon || '',
      (v) => {
        items[idx].icon = v;
        syncToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      },
      {
        helpText: t(
          'editor.cards.iconHelp',
          'Search (EN), e.g. lightbulb / gear / users.'
        ),
      }
    );

    const titleInput = fieldText(
      t('editor.cards.titleField', 'Title'),
      item.title || '',
      (v) => {
        items[idx].title = v;
        syncToNumbered(slide);
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
      syncToNumbered(slide);
      markDirty?.();
      scheduleUiRefresh?.();
    });
    const bodyInput = h('div', { class: 'stack' }, [
      h('div', { class: 'field-label', text: t('editor.cards.text', 'Text') }),
      ta,
    ]);

    const linkInput = fieldCardLink({
      value: item.link || '',
      slides: deckSlides,
      onChange: (v) => {
        items[idx].link = v;
        syncToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      },
      help: t(
        'editor.cards.linkHelp2',
        'Makes the card clickable. Pick a slide to jump to, or type an https:// / mailto: link (opens in a new tab).'
      ),
    });

    cardContent.append(iconInput, titleInput);
    cardContent.append(bodyInput);
    cardContent.append(linkInput);
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
