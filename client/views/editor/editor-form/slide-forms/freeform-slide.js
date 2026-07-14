import { t } from '../../../../lib/ui-i18n.js';
import { createElementAddButtons } from '../freeform-canvas-editor.js';
import { renderFocusGridField } from '../focus-picker.js';
import { dragHandleIcon, chevronDownIcon } from '../../../../lib/icons.js';
import { createCollapsedState } from '../../../../lib/collapsed-state.js';
import { collapseAllToggle } from '../../fields/collapse-all-toggle.js';
import { cryptoUuid } from '../../../../../shared/slide-types/helpers.js';

const MAX_ELEMENTS = 20;

// Collapsed state manager for freeform elements
const freeformElementsState = createCollapsedState('freeform-element');

function ensureElementsArray(slide) {
  if (!slide?.content) slide.content = {};
  if (!Array.isArray(slide.content.elements)) {
    slide.content.elements = [];
  }
  return slide.content.elements;
}

function getMaxZIndex(elements) {
  if (!elements.length) return 0;
  return Math.max(...elements.map((el) => Number(el.zIndex) || 0));
}

function getMinZIndex(elements) {
  if (!elements.length) return 0;
  return Math.min(...elements.map((el) => Number(el.zIndex) || 0));
}

/**
 * Render the freeform slide form with element list and property editors
 */
export function renderFreeformSlideForm({
  h,
  form,
  slide,
  add,
  used,
  fieldByKey,
  renderField,
  fieldGrid,
  fieldText,
  fieldTextarea,
  fieldEnum,
  fieldImage,
  markDirty,
  rerenderEditor,
  scheduleUiRefresh,
} = {}) {
  const elements = ensureElementsArray(slide);

  // Mark fields as used (we render them custom)
  used.add('elements');
  used.add('background');
  used.add('bgCustomColor');
  used.add('snapToGrid');

  // Background and settings row
  const bgField = fieldByKey?.get('background');
  const bgCustomField = fieldByKey?.get('bgCustomColor');
  const snapField = fieldByKey?.get('snapToGrid');

  const settingsDetails = h('details', { class: 'editor-advanced' });
  const settingsSummary = h('summary', {
    class: 'editor-advanced-summary',
    text: t('editor.freeform.settings', 'Slide settings'),
  });
  const settingsBody = h('div', { class: 'editor-advanced-body' });
  settingsDetails.append(settingsSummary, settingsBody);

  // Background row
  if (bgField || bgCustomField) {
    const bgEl = bgField ? renderField(bgField) : null;
    const bgCustomEl = bgCustomField ? renderField(bgCustomField) : null;

    // Show custom color picker only when background is 'custom'
    if (bgCustomEl && slide.content.background !== 'custom') {
      bgCustomEl.style.display = 'none';
    }

    const bgRow = fieldGrid([bgEl, bgCustomEl].filter(Boolean), 2);
    if (bgRow) settingsBody.append(bgRow);
  }

  // Snap to grid
  if (snapField) {
    const snapEl = renderField(snapField);
    if (snapEl) settingsBody.append(snapEl);
  }

  form.append(settingsDetails);

  // Add element buttons
  const addButtonsContainer = h('div', { class: 'stack' });
  const elementsHeader = h('div', { class: 'row spread' });
  elementsHeader.append(
    h('div', { class: 'field-label', text: t('editor.freeform.elements', 'Elements') })
  );
  const bulkToggle = collapseAllToggle({
    state: freeformElementsState,
    keys: Array.from({ length: elements.length }, (_, idx) => freeformElementsState.getKey(slide.id, idx)),
    rerender: rerenderEditor,
  });
  if (bulkToggle) elementsHeader.append(bulkToggle);
  addButtonsContainer.append(elementsHeader);

  const addButtons = createElementAddButtons({
    h,
    elements,
    maxElements: MAX_ELEMENTS,
    onAddElement: (newElement) => {
      if (elements.length >= MAX_ELEMENTS) return;
      // Set zIndex to be on top
      newElement.zIndex = getMaxZIndex(elements) + 1;
      elements.push(newElement);
      markDirty?.();
      rerenderEditor?.();
      scheduleUiRefresh?.();
    },
  });
  addButtonsContainer.append(addButtons);
  form.append(addButtonsContainer);

  // Elements list
  const elementsList = h('div', { class: 'items-reorder-list freeform-elements-list' });

  // Drag state
  let draggingIndex = null;
  let dropTargetIndex = null;

  const clearDropIndicators = () => {
    for (const el of elementsList.querySelectorAll('.card-group.is-drop-before, .card-group.is-drop-after')) {
      el.classList.remove('is-drop-before', 'is-drop-after');
    }
    dropTargetIndex = null;
  };

  const moveElement = (fromIdx, toIdx) => {
    if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
    if (fromIdx >= elements.length) return;
    const moved = elements.splice(fromIdx, 1)[0];
    const insertIdx = toIdx > fromIdx ? toIdx - 1 : toIdx;
    elements.splice(insertIdx, 0, moved);
    markDirty?.();
    rerenderEditor?.();
    scheduleUiRefresh?.();
  };

  // Render each element
  for (let i = 0; i < elements.length; i += 1) {
    const element = elements[i] || {};
    const elementType = String(element.type || 'text');

    // Get collapsed state
    const elementKey = freeformElementsState.getKey(slide.id, i);
    const isCollapsed = freeformElementsState.isCollapsed(elementKey);

    const elementWrap = h('div', { class: 'stack card-group' });
    elementWrap.dataset.elementIndex = String(i);
    if (isCollapsed) {
      elementWrap.classList.add('is-collapsed');
    }

    // Header
    const header = h('div', { class: 'row spread card-group-header' });
    const headerLeft = h('div', { class: 'card-group-header-left' });

    // Drag handle
    const dragHandle = h('button', {
      type: 'button',
      class: 'item-drag-handle',
      title: t('editor.freeform.dragToReorder', 'Drag to reorder'),
    });
    dragHandle.appendChild(dragHandleIcon());
    headerLeft.append(dragHandle);

    // Collapse toggle
    const collapseBtn = h('button', {
      type: 'button',
      class: 'row-collapse-toggle',
      title: isCollapsed
        ? t('editor.freeform.expand', 'Expand')
        : t('editor.freeform.collapse', 'Collapse'),
    });
    collapseBtn.appendChild(chevronDownIcon());
    collapseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      freeformElementsState.toggle(elementKey);
      rerenderEditor?.();
    });
    headerLeft.append(collapseBtn);

    // Type label
    const typeLabel = elementType === 'heading'
      ? t('editor.freeform.typeHeading', 'Heading')
      : elementType === 'image'
        ? t('editor.freeform.typeImage', 'Image')
        : t('editor.freeform.typeText', 'Text');

    headerLeft.append(h('div', {
      class: 'card-group-title',
      text: `${typeLabel} ${i + 1}`,
    }));
    header.append(headerLeft);

    // Delete button
    header.append(
      h('button', {
        class: 'btn btn-secondary btn-icon card-remove-btn',
        type: 'button',
        text: '×',
        title: t('editor.items.remove', 'Remove item'),
        'aria-label': t('editor.items.remove', 'Remove item'),
        onclick: () => {
          elements.splice(i, 1);
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        },
      })
    );
    elementWrap.append(header);

    // Drag events
    elementWrap.setAttribute('draggable', 'true');
    elementWrap.addEventListener('dragstart', (e) => {
      draggingIndex = i;
      elementWrap.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
    });
    elementWrap.addEventListener('dragend', () => {
      draggingIndex = null;
      elementWrap.classList.remove('is-dragging');
      clearDropIndicators();
    });
    elementWrap.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (draggingIndex === null || draggingIndex === i) {
        clearDropIndicators();
        return;
      }
      const rect = elementWrap.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pos = e.clientY < midY ? 'before' : 'after';
      clearDropIndicators();
      elementWrap.classList.add(`is-drop-${pos}`);
      dropTargetIndex = pos === 'before' ? i : i + 1;
    });
    elementWrap.addEventListener('dragleave', (e) => {
      if (e.currentTarget?.contains?.(e.relatedTarget)) return;
      clearDropIndicators();
    });
    elementWrap.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = draggingIndex;
      const toIdx = dropTargetIndex;
      clearDropIndicators();
      draggingIndex = null;
      if (fromIdx !== null && toIdx !== null && fromIdx !== toIdx) {
        moveElement(fromIdx, toIdx);
      }
    });

    // Content area (collapsible)
    const content = h('div', { class: 'block-collapsible-content' });
    if (isCollapsed) {
      content.style.display = 'none';
    }

    // Type selector
    const typeSelect = fieldEnum(
      {
        key: 'type',
        label: t('editor.freeform.elementType', 'Type'),
        options: [
          { value: 'heading', label: t('editor.freeform.typeHeading', 'Heading') },
          { value: 'text', label: t('editor.freeform.typeText', 'Text') },
          { value: 'image', label: t('editor.freeform.typeImage', 'Image') },
        ],
      },
      element.type || 'text',
      (v) => {
        element.type = v;
        // Clear type-specific fields
        if (v === 'image') {
          element.content = '';
        } else {
          element.src = '';
          element.alt = '';
        }
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      }
    );
    content.append(typeSelect);

    // Type-specific content
    if (elementType === 'heading' || elementType === 'text') {
      // Content field
      const contentField = fieldTextarea(
        t('editor.freeform.content', 'Content'),
        element.content || '',
        elementType === 'text'
          ? t('editor.freeform.contentHelpText', 'Supports markdown: **bold**, *italic*, [links](url)')
          : '',
        (v) => {
          element.content = v;
          markDirty?.();
          scheduleUiRefresh?.();
        },
        { maxLength: 2000 }
      );
      content.append(contentField);

      // Font size
      const fontSizeField = fieldEnum(
        {
          key: 'fontSize',
          label: t('editor.freeform.fontSize', 'Font size'),
          options: [
            { value: 'sm', label: t('editor.freeform.sizeSm', 'Small') },
            { value: 'md', label: t('editor.freeform.sizeMd', 'Medium') },
            { value: 'lg', label: t('editor.freeform.sizeLg', 'Large') },
            { value: 'xl', label: t('editor.freeform.sizeXl', 'Extra large') },
          ],
        },
        element.fontSize || 'md',
        (v) => {
          element.fontSize = v;
          markDirty?.();
          scheduleUiRefresh?.();
        }
      );
      content.append(fontSizeField);
    } else if (elementType === 'image') {
      // Image picker - use proxy slide pattern
      const proxySlide = {
        type: slide.type,
        id: slide.id,
        content: new Proxy(element, {
          get(target, prop) {
            return target[prop];
          },
          set(target, prop, value) {
            target[prop] = value;
            return true;
          },
        }),
      };
      const imgField = fieldImage(
        proxySlide,
        { key: 'src', label: t('editor.freeform.image', 'Image'), type: 'image', hideHelp: true },
        (url) => {
          element.src = url;
          markDirty?.();
          rerenderEditor?.();
          scheduleUiRefresh?.();
        }
      );
      content.append(imgField);

      // Alt text
      const altField = fieldText(
        t('editor.freeform.altText', 'Alt text'),
        element.alt || '',
        (v) => {
          element.alt = v;
          markDirty?.();
          scheduleUiRefresh?.();
        }
      );
      content.append(altField);

      // Focus picker
      const focusEl = renderFocusGridField({
        h,
        label: t('editor.freeform.imageFocus', 'Image focus (crop)'),
        helpText: t('editor.freeform.imageFocusHelp', 'Pick what should stay visible when cropped.'),
        focusX: element.focusX,
        focusY: element.focusY,
        onChange: ({ focusX, focusY }) => {
          element.focusX = focusX;
          element.focusY = focusY;
          markDirty?.();
          scheduleUiRefresh?.();
        },
      });
      content.append(focusEl);
    }

    // Position fields (collapsible)
    const positionDetails = h('details', { class: 'editor-advanced' });
    const positionSummary = h('summary', {
      class: 'editor-advanced-summary',
      text: t('editor.freeform.position', 'Position & size'),
    });
    const positionBody = h('div', { class: 'editor-advanced-body' });
    positionDetails.append(positionSummary, positionBody);

    // Position X/Y
    const updatePosition = (key, value) => {
      const n = Number(value);
      if (Number.isNaN(n)) return;
      element[key] = Math.max(0, Math.min(100, n));
      markDirty?.();
      scheduleUiRefresh?.();
    };

    const posXField = h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: t('editor.freeform.posX', 'X position (%)') }),
      h('input', {
        class: 'form-input',
        type: 'number',
        min: '0',
        max: '100',
        step: '1',
        value: String(element.x || 0),
        oninput: (e) => updatePosition('x', e.target.value),
      }),
    ]);

    const posYField = h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: t('editor.freeform.posY', 'Y position (%)') }),
      h('input', {
        class: 'form-input',
        type: 'number',
        min: '0',
        max: '100',
        step: '1',
        value: String(element.y || 0),
        oninput: (e) => updatePosition('y', e.target.value),
      }),
    ]);

    positionBody.append(fieldGrid([posXField, posYField], 2));

    // Width/Height
    const widthField = h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: t('editor.freeform.width', 'Width (%)') }),
      h('input', {
        class: 'form-input',
        type: 'number',
        min: '5',
        max: '100',
        step: '1',
        value: String(element.width || 30),
        oninput: (e) => updatePosition('width', e.target.value),
      }),
    ]);

    const heightField = h('div', { class: 'stack is-field' }, [
      h('div', { class: 'field-label', text: t('editor.freeform.height', 'Height (%)') }),
      h('input', {
        class: 'form-input',
        type: 'number',
        min: '5',
        max: '100',
        step: '1',
        value: String(element.height || 20),
        oninput: (e) => updatePosition('height', e.target.value),
      }),
    ]);

    positionBody.append(fieldGrid([widthField, heightField], 2));

    // Layer (z-index)
    const zIndexRow = h('div', { class: 'row' });
    const zIndexLabel = h('span', {
      class: 'field-label',
      text: t('editor.freeform.layer', 'Layer'),
    });
    const zIndexValue = h('span', {
      class: 'pill',
      text: String(element.zIndex || 0),
    });

    const bringToFrontBtn = h('button', {
      type: 'button',
      class: 'btn btn-secondary is-compact-sm',
      text: t('editor.freeform.bringToFront', 'Front'),
      onclick: () => {
        element.zIndex = getMaxZIndex(elements) + 1;
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      },
    });

    const sendToBackBtn = h('button', {
      type: 'button',
      class: 'btn btn-secondary is-compact-sm',
      text: t('editor.freeform.sendToBack', 'Back'),
      onclick: () => {
        element.zIndex = getMinZIndex(elements) - 1;
        markDirty?.();
        rerenderEditor?.();
        scheduleUiRefresh?.();
      },
    });

    zIndexRow.append(zIndexLabel, zIndexValue, bringToFrontBtn, sendToBackBtn);
    positionBody.append(zIndexRow);

    content.append(positionDetails);
    elementWrap.append(content);
    elementsList.append(elementWrap);
  }

  form.append(elementsList);

  // Empty state
  if (elements.length === 0) {
    const emptyState = h('div', { class: 'freeform-empty-state' });
    emptyState.append(h('p', {
      text: t('editor.freeform.emptyState', 'No elements yet. Click the buttons above to add headings, text, or images.'),
    }));
    form.append(emptyState);
  }
}
