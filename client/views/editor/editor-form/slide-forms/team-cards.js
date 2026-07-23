import { t } from '../../../../lib/ui-i18n.js';
import { renderFocusGridField } from '../focus-picker.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/dom/icons.js';
import { createCollapsedState } from '../../../../lib/slide-authoring/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';

// Collapsed state manager for team card blocks
const teamBlocksState = createCollapsedState('card');

/**
 * Sync members[] back to numbered fields for backward compatibility.
 * This ensures older code paths and the renderer can use either format.
 */
function syncToNumbered(slide) {
  const members = slide.content.members || [];
  slide.content.cardCount = String(members.length);
  for (let i = 0; i < 25; i++) {
    const m = members[i] || {};
    slide.content[`card${i + 1}Image`] = m.image || '';
    slide.content[`card${i + 1}Alt`] = m.alt || '';
    slide.content[`card${i + 1}ImageFocusX`] = m.imageFocusX ?? 50;
    slide.content[`card${i + 1}ImageFocusY`] = m.imageFocusY ?? 50;
    slide.content[`card${i + 1}Name`] = m.name || '';
    slide.content[`card${i + 1}Byline`] = m.byline || '';
    slide.content[`card${i + 1}Linkedin`] = m.linkedin || '';
  }
}

export function renderTeamCardsForm({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  fieldText,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  // Render title and subheading side-by-side on wide viewports
  const titleField = fieldByKey?.get('title');
  const subheadingField = fieldByKey?.get('subheading');
  const bottomSubheadingField = fieldByKey?.get('bottomSubheading');
  if (titleField || subheadingField) {
    used.add('title');
    used.add('subheading');
    const titleEl = titleField ? renderField(titleField) : null;
    const subheadingEl = subheadingField ? renderField(subheadingField) : null;
    const titleRow = fieldGrid([titleEl, subheadingEl].filter(Boolean), 2);
    if (titleRow) {
      titleRow.classList.add('editor-title-row');
      form.append(titleRow);
    }
  }
  if (bottomSubheadingField) {
    used.add('bottomSubheading');
    form.append(renderField(bottomSubheadingField));
  }

  // Render slide options in a collapsible section
  const bgField = fieldByKey?.get('background');
  const textPosField = fieldByKey?.get('textPosition');
  const shapeField = fieldByKey?.get('imageShape');
  const aspectField = fieldByKey?.get('imageAspect');
  const photoFrameField = fieldByKey?.get('showPhotoFrame');
  const columnSplitField = fieldByKey?.get('columnSplit');
  const subheading2Field = fieldByKey?.get('subheading2');

  used.add('background');
  used.add('textPosition');
  used.add('imageShape');
  used.add('imageAspect');
  used.add('showPhotoFrame');
  used.add('columnSplit');
  used.add('subheading2');

  // Collapsible layout settings
  const layoutDetails = h('details', { class: 'editor-advanced' });
  const layoutSummary = h('summary', {
    class: 'editor-advanced-summary',
    text: t('editor.slide.layoutSettings', 'Layout settings'),
  });
  const layoutBody = h('div', { class: 'editor-advanced-body' });
  layoutDetails.append(layoutSummary, layoutBody);

  // Row 1: Background and Text position
  if (bgField || textPosField) {
    const bgEl = bgField ? renderField(bgField) : null;
    const textPosEl = textPosField ? renderField(textPosField) : null;
    const row1 = fieldGrid([bgEl, textPosEl].filter(Boolean), 2);
    if (row1) layoutBody.append(row1);
  }

  // Row 2: Image shape and image aspect (aspect is forced square for circles,
  // which the renderer handles — the control stays visible for clarity)
  if (shapeField || aspectField) {
    const shapeEl = shapeField ? renderField(shapeField) : null;
    const aspectEl = aspectField ? renderField(aspectField) : null;
    const row2 = fieldGrid([shapeEl, aspectEl].filter(Boolean), 2);
    if (row2) layoutBody.append(row2);
  }

  // Row 2b: Photo frame
  if (photoFrameField) {
    const row2b = fieldGrid([renderField(photoFrameField)], 2);
    if (row2b) layoutBody.append(row2b);
  }

  // Row 3: Column split and right group subheading
  if (columnSplitField) {
    const splitEl = renderField(columnSplitField);
    const subheading2El = subheading2Field ? renderField(subheading2Field) : null;
    const row3 = fieldGrid([splitEl, subheading2El].filter(Boolean), 2);
    if (row3) layoutBody.append(row3);
  }

  form.append(layoutDetails);

  const MAX = 25;

  // Mark all member-related fields as used (hide from generic renderer)
  used.add('members');
  used.add('cardCount');
  for (let i = 1; i <= MAX; i += 1) {
    used.add(`card${i}Image`);
    used.add(`card${i}Alt`);
    used.add(`card${i}ImageFocusX`);
    used.add(`card${i}ImageFocusY`);
    used.add(`card${i}Name`);
    used.add(`card${i}Byline`);
    used.add(`card${i}Linkedin`);
  }

  // Normalize: if no members[] but numbered fields exist, build members on the fly
  if (!Array.isArray(slide.content.members) || slide.content.members.length === 0) {
    const count = Math.max(1, Math.min(MAX, Number(slide.content.cardCount || 1)));
    const members = [];
    for (let i = 1; i <= count; i++) {
      if (slide.content[`card${i}Name`] || slide.content[`card${i}Image`]) {
        members.push({
          image: slide.content[`card${i}Image`] || '',
          alt: slide.content[`card${i}Alt`] || '',
          imageFocusX: slide.content[`card${i}ImageFocusX`] ?? 50,
          imageFocusY: slide.content[`card${i}ImageFocusY`] ?? 50,
          name: slide.content[`card${i}Name`] || '',
          byline: slide.content[`card${i}Byline`] || '',
          linkedin: slide.content[`card${i}Linkedin`] || '',
        });
      }
    }
    slide.content.members = members.length > 0 ? members : [{ image: '', alt: '', imageFocusX: 50, imageFocusY: 50, name: '', byline: '', linkedin: '' }];
  }

  const members = slide.content.members;
  const count = members.length;

  // Swap two members in members[]
  function swapMembers(fromIdx, toIdx) {
    // Convert 1-based indices to 0-based
    const from = fromIdx - 1;
    const to = toIdx - 1;
    const [moved] = members.splice(from, 1);
    members.splice(to, 0, moved);
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  }

  const cardControls = h('div', { class: 'stack' });
  cardControls.append(h('div', { class: 'field-label', text: t('editor.teamCards.blocks', 'Blocks') }));
  const controlsRow = h('div', { class: 'row is-wrap' });

  const addMember = () => {
    if (count >= MAX) return;
    members.push({
      image: '',
      alt: '',
      imageFocusX: 50,
      imageFocusY: 50,
      name: t('editor.teamCards.placeholderName', 'Title'),
      byline: t('editor.teamCards.placeholderByline', 'Caption'),
      linkedin: '',
    });
    syncToNumbered(slide);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  controlsRow.append(
    h('button', {
      class: 'btn btn-secondary',
      text: t('editor.teamCards.addBlock', '+ Add block'),
      disabled: count >= MAX,
      onclick: () => addMember(),
    }),
    h('div', { class: 'pill', text: `${count} / ${MAX}` })
  );
  const bulkToggle = collapseAllToggle({
    state: teamBlocksState,
    keys: Array.from({ length: count }, (_, idx) => teamBlocksState.getKey(slide.id, idx + 1)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) controlsRow.append(bulkToggle);
  cardControls.append(controlsRow);
  form.append(cardControls);

  // Cards container for drag and drop
  const cardsContainer = h('div', { class: 'items-reorder-list image-blocks-list' });

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
    // Get collapsed state for this block
    const blockKey = teamBlocksState.getKey(slide.id, i);
    const isCollapsed = teamBlocksState.isCollapsed(blockKey);

    const cardWrap = h('div', { class: 'stack card-group' });
    cardWrap.dataset.cardIndex = String(i);
    if (isCollapsed) {
      cardWrap.classList.add('is-collapsed');
    }

    // Card header with drag handle, collapse toggle, title, and remove button
    const cardHeader = h('div', { class: 'row spread card-group-header' });

    // Left side: drag handle + collapse toggle + title
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Drag handle
    const dragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.imageBlocks.dragToReorder', 'Drag to reorder'),
      draggable: 'true',
    });
    dragHandle.appendChild(dragHandleIcon());

    // Drag events on the handle
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

    // Collapse/expand toggle button
    const collapseBtn = h('button', {
      type: 'button',
      class: 'row-collapse-toggle',
      title: isCollapsed
        ? t('editor.imageBlocks.expand', 'Expand')
        : t('editor.imageBlocks.collapse', 'Collapse'),
    });
    collapseBtn.appendChild(chevronDownIcon());
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      teamBlocksState.toggle(blockKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    // Show member name as header (falls back to placeholder)
    const memberName = members[i - 1]?.name || '';
    const titlePreview = h('div', {
      class: `card-group-title item-title-preview${memberName ? '' : ' is-placeholder'}`,
      text: memberName || t('editor.teamCards.untitledMember', 'Untitled member'),
    });
    headerLeft.append(titlePreview);

    cardHeader.append(headerLeft);

    // Remove button (right side)
    if (count > 1) {
      cardHeader.append(
        h('button', {
          class: 'btn btn-secondary btn-icon card-remove-btn',
          type: 'button',
          text: '×',
          title: t('editor.teamCards.removeBlockN', 'Remove block {n}', { n: i }),
          'aria-label': t('editor.teamCards.removeBlockN', 'Remove block {n}', { n: i }),
          onclick: () => {
            if (members.length <= 1) return;
            members.splice(i - 1, 1);
            syncToNumbered(slide);
            markDirty?.();
            rerenderEditor?.();
            scheduleUiRefresh?.();
          },
        })
      );
    }
    cardWrap.append(cardHeader);

    // Collapsible content container
    const cardContent = h('div', { class: 'block-collapsible-content' });
    if (isCollapsed) {
      cardContent.style.display = 'none';
    }

    // Use 0-based index into members[]
    const idx = i - 1;
    const member = members[idx] || {};

    const imgField = fieldImage(
      slide,
      { key: `card${i}Image`, label: t('editor.teamCards.photo', 'Photo'), type: 'image' },
      (url) => {
        member.image = url;
        syncToNumbered(slide);
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      }
    );
    const nameField = fieldText(t('editor.teamCards.title', 'Title'), member.name || '', (v) => {
      member.name = v;
      syncToNumbered(slide);
      markDirty?.();
      scheduleUiRefresh?.();
    });
    const bylineField = fieldText(
      t('editor.teamCards.caption', 'Caption'),
      member.byline || '',
      (v) => {
        member.byline = v;
        syncToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );

    cardContent.append(imgField);

    // Focus picker - only show when image is set and the photo is cropped to a
    // square. Circles always crop square regardless of the aspect control.
    const hasImage = !!member.image;
    const effectiveAspect =
      slide.content?.imageShape === 'circle'
        ? 'square'
        : slide.content?.imageAspect || 'square';
    if (hasImage && effectiveAspect === 'square') {
      const focusEl = renderFocusGridField({
        h,
        label: t('editor.teamCards.imageFocus', 'Image focus (crop)'),
        helpText: t('editor.teamCards.imageFocusHelp', 'Pick what should stay visible when the image is cropped.'),
        focusX: member.imageFocusX ?? 50,
        focusY: member.imageFocusY ?? 50,
        onChange: ({ focusX, focusY }) => {
          member.imageFocusX = focusX;
          member.imageFocusY = focusY;
          syncToNumbered(slide);
          markDirty?.();
          scheduleUiRefresh?.();
        },
      });
      cardContent.append(focusEl);
    }

    const altField =
      typeof renderField === 'function'
        ? (() => {
            // Create a custom alt field that writes to the member object
            const altWrap = h('div', { class: 'stack' });
            altWrap.append(
              h('div', {
                class: 'field-label',
                text: t('editor.teamCards.altText', 'Alt text (optional)'),
              })
            );
            const altInput = h('input', {
              type: 'text',
              class: 'form-input',
              maxlength: 180,
              value: member.alt || '',
            });
            altInput.addEventListener('input', () => {
              member.alt = altInput.value;
              syncToNumbered(slide);
              markDirty?.();
              scheduleUiRefresh?.();
            });
            altWrap.append(altInput);
            return altWrap;
          })()
        : null;
    cardContent.append(fieldGrid([nameField, bylineField], 2));

    const linkedinField = fieldText(
      t('editor.teamCards.linkedin', 'LinkedIn URL (optional)'),
      member.linkedin || '',
      (v) => {
        member.linkedin = v;
        syncToNumbered(slide);
        markDirty?.();
        scheduleUiRefresh?.();
      }
    );
    cardContent.append(linkedinField);

    if (altField) cardContent.append(altField);

    cardWrap.append(cardContent);

    // Drag over handling on the card wrapper (works in collapsed mode too)
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
        swapMembers(fromIndex, toIndex);
      }

      draggingCardIndex = null;
      clearDropIndicators();
    });

    cardsContainer.append(cardWrap);
  }

  form.append(cardsContainer);
}
