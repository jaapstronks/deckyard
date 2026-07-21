import { t } from '../../../lib/ui-i18n.js';
import { trashIcon } from '../../../lib/dom/icons.js';
import { cryptoUuid } from '../../../../shared/slide-types/helpers.js';

/**
 * Freeform Canvas Editor
 *
 * Handles drag-and-drop positioning, resizing, snap-to-grid,
 * and layer controls for freeform slide elements.
 */

// Snap configuration
const SNAP_THRESHOLD = 1.5; // % - distance at which snapping kicks in
const GRID_SIZE = 2.5; // % - snap grid increment
const EDGE_PADDING = 4; // % - padding from slide edges
const CENTER_LINE = 50; // % - center snap point

// Minimum element size
const MIN_WIDTH = 5;
const MIN_HEIGHT = 5;

/**
 * Calculate snap points based on other elements and canvas guides
 */
function getSnapPoints(elements, excludeId) {
  const points = {
    x: [EDGE_PADDING, CENTER_LINE, 100 - EDGE_PADDING], // left, center, right
    y: [EDGE_PADDING, CENTER_LINE, 100 - EDGE_PADDING], // top, center, bottom
  };

  // Add snap points from other elements
  for (const el of elements) {
    if (el.id === excludeId) continue;
    const x = Number(el.x) || 0;
    const y = Number(el.y) || 0;
    const w = Number(el.width) || 0;
    const h = Number(el.height) || 0;

    // Element edges
    points.x.push(x, x + w / 2, x + w); // left, center, right
    points.y.push(y, y + h / 2, y + h); // top, center, bottom
  }

  return points;
}

/**
 * Find nearest snap point within threshold
 */
function findSnap(value, snapPoints, threshold = SNAP_THRESHOLD) {
  let nearest = null;
  let minDist = threshold;

  for (const point of snapPoints) {
    const dist = Math.abs(value - point);
    if (dist < minDist) {
      minDist = dist;
      nearest = point;
    }
  }

  return nearest;
}

/**
 * Snap a position to grid/guides
 */
function snapPosition(x, y, width, height, elements, elementId, snapEnabled) {
  if (!snapEnabled) {
    return { x, y, snappedX: null, snappedY: null };
  }

  const snapPoints = getSnapPoints(elements, elementId);

  // Check snapping for left edge, center, and right edge
  const leftSnap = findSnap(x, snapPoints.x);
  const centerXSnap = findSnap(x + width / 2, snapPoints.x);
  const rightSnap = findSnap(x + width, snapPoints.x);

  let snappedX = null;
  let finalX = x;

  if (leftSnap !== null) {
    finalX = leftSnap;
    snappedX = leftSnap;
  } else if (centerXSnap !== null) {
    finalX = centerXSnap - width / 2;
    snappedX = centerXSnap;
  } else if (rightSnap !== null) {
    finalX = rightSnap - width;
    snappedX = rightSnap;
  }

  // Check snapping for top edge, center, and bottom edge
  const topSnap = findSnap(y, snapPoints.y);
  const centerYSnap = findSnap(y + height / 2, snapPoints.y);
  const bottomSnap = findSnap(y + height, snapPoints.y);

  let snappedY = null;
  let finalY = y;

  if (topSnap !== null) {
    finalY = topSnap;
    snappedY = topSnap;
  } else if (centerYSnap !== null) {
    finalY = centerYSnap - height / 2;
    snappedY = centerYSnap;
  } else if (bottomSnap !== null) {
    finalY = bottomSnap - height;
    snappedY = bottomSnap;
  }

  return {
    x: Math.max(0, Math.min(100 - width, finalX)),
    y: Math.max(0, Math.min(100 - height, finalY)),
    snappedX,
    snappedY,
  };
}

/**
 * Create the freeform canvas editor overlay
 */
export function createFreeformCanvasEditor({
  h,
  slide,
  elements,
  selectedId,
  snapToGrid,
  onSelectElement,
  onUpdateElement,
  onDeleteElement,
  onBringToFront,
  onSendToBack,
  markDirty,
  scheduleUiRefresh,
} = {}) {
  const container = h('div', { class: 'freeform-editor-overlay' });

  // Track drag state
  let isDragging = false;
  let isResizing = false;
  let resizeHandle = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let elementStartX = 0;
  let elementStartY = 0;
  let elementStartWidth = 0;
  let elementStartHeight = 0;
  let currentSnapGuides = { x: null, y: null };

  // Canvas reference for coordinate conversion
  let canvasRect = null;

  function updateCanvasRect() {
    const preview = document.querySelector('.slide-preview .slide');
    if (preview) {
      canvasRect = preview.getBoundingClientRect();
    }
  }

  function pxToPercent(px, isX) {
    if (!canvasRect) return 0;
    const dimension = isX ? canvasRect.width : canvasRect.height;
    return (px / dimension) * 100;
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  // Render snap guide lines
  function renderSnapGuides() {
    // Clear existing guides
    const existingGuides = container.querySelectorAll('.freeform-snap-guide');
    for (const guide of existingGuides) {
      guide.remove();
    }

    if (currentSnapGuides.x !== null) {
      const vGuide = h('div', {
        class: 'freeform-snap-guide is-vertical',
        style: `left: ${currentSnapGuides.x}%;`,
      });
      container.append(vGuide);
    }

    if (currentSnapGuides.y !== null) {
      const hGuide = h('div', {
        class: 'freeform-snap-guide is-horizontal',
        style: `top: ${currentSnapGuides.y}%;`,
      });
      container.append(hGuide);
    }
  }

  function clearSnapGuides() {
    currentSnapGuides = { x: null, y: null };
    const existingGuides = container.querySelectorAll('.freeform-snap-guide');
    for (const guide of existingGuides) {
      guide.remove();
    }
  }

  // Handle pointer move during drag
  function handlePointerMove(e) {
    if (!isDragging && !isResizing) return;
    if (!canvasRect) return;

    const element = elements.find((el) => el.id === selectedId);
    if (!element) return;

    const deltaX = pxToPercent(e.clientX - dragStartX, true);
    const deltaY = pxToPercent(e.clientY - dragStartY, false);

    if (isDragging) {
      let newX = elementStartX + deltaX;
      let newY = elementStartY + deltaY;
      const width = Number(element.width) || 20;
      const height = Number(element.height) || 20;

      // Apply snapping
      const snapResult = snapPosition(
        newX,
        newY,
        width,
        height,
        elements,
        selectedId,
        snapToGrid
      );

      newX = snapResult.x;
      newY = snapResult.y;
      currentSnapGuides = { x: snapResult.snappedX, y: snapResult.snappedY };
      renderSnapGuides();

      onUpdateElement(selectedId, { x: newX, y: newY });
    } else if (isResizing && resizeHandle) {
      let newX = Number(element.x) || 0;
      let newY = Number(element.y) || 0;
      let newWidth = elementStartWidth;
      let newHeight = elementStartHeight;

      const handle = resizeHandle;

      // Handle horizontal resize
      if (handle.includes('e')) {
        newWidth = clamp(elementStartWidth + deltaX, MIN_WIDTH, 100 - newX);
      } else if (handle.includes('w')) {
        const widthChange = Math.min(deltaX, elementStartWidth - MIN_WIDTH);
        newX = clamp(elementStartX + widthChange, 0, elementStartX + elementStartWidth - MIN_WIDTH);
        newWidth = elementStartWidth - (newX - elementStartX);
      }

      // Handle vertical resize
      if (handle.includes('s')) {
        newHeight = clamp(elementStartHeight + deltaY, MIN_HEIGHT, 100 - newY);
      } else if (handle.includes('n')) {
        const heightChange = Math.min(deltaY, elementStartHeight - MIN_HEIGHT);
        newY = clamp(elementStartY + heightChange, 0, elementStartY + elementStartHeight - MIN_HEIGHT);
        newHeight = elementStartHeight - (newY - elementStartY);
      }

      onUpdateElement(selectedId, {
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      });
    }
  }

  // Handle pointer up
  function handlePointerUp() {
    if (isDragging || isResizing) {
      isDragging = false;
      isResizing = false;
      resizeHandle = null;
      clearSnapGuides();
      markDirty?.();
      scheduleUiRefresh?.();
    }
    document.removeEventListener('pointermove', handlePointerMove);
    document.removeEventListener('pointerup', handlePointerUp);
  }

  // Render element overlays
  function renderElementOverlays() {
    container.innerHTML = '';

    for (const element of elements) {
      const isSelected = element.id === selectedId;
      const x = Number(element.x) || 0;
      const y = Number(element.y) || 0;
      const width = Number(element.width) || 20;
      const height = Number(element.height) || 20;

      const overlay = h('div', {
        class: `freeform-element-overlay${isSelected ? ' is-selected' : ''}`,
        style: `left: ${x}%; top: ${y}%; width: ${width}%; height: ${height}%;`,
      });
      overlay.dataset.elementId = element.id;

      // Click to select
      overlay.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        updateCanvasRect();
        onSelectElement(element.id);

        // Start drag if not clicking on a resize handle
        if (!e.target.classList.contains('freeform-resize-handle')) {
          isDragging = true;
          dragStartX = e.clientX;
          dragStartY = e.clientY;
          elementStartX = x;
          elementStartY = y;
          elementStartWidth = width;
          elementStartHeight = height;

          document.addEventListener('pointermove', handlePointerMove);
          document.addEventListener('pointerup', handlePointerUp);
        }
      });

      // Add resize handles if selected
      if (isSelected) {
        const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
        for (const handle of handles) {
          const handleEl = h('div', {
            class: `freeform-resize-handle handle-${handle}`,
          });
          handleEl.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            updateCanvasRect();
            isResizing = true;
            resizeHandle = handle;
            dragStartX = e.clientX;
            dragStartY = e.clientY;
            elementStartX = x;
            elementStartY = y;
            elementStartWidth = width;
            elementStartHeight = height;

            document.addEventListener('pointermove', handlePointerMove);
            document.addEventListener('pointerup', handlePointerUp);
          });
          overlay.append(handleEl);
        }

        // Add element toolbar
        const toolbar = h('div', { class: 'freeform-element-toolbar' });

        // Bring to front button
        const btnFront = h('button', {
          type: 'button',
          title: t('editor.freeform.bringToFront', 'Bring to front'),
        });
        btnFront.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 15V5a2 2 0 0 1 2-2h10"/></svg>';
        btnFront.addEventListener('click', (e) => {
          e.stopPropagation();
          onBringToFront(element.id);
        });

        // Send to back button
        const btnBack = h('button', {
          type: 'button',
          title: t('editor.freeform.sendToBack', 'Send to back'),
        });
        btnBack.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="13" height="13" rx="2"/><path d="M21 9v10a2 2 0 0 1-2 2H9"/></svg>';
        btnBack.addEventListener('click', (e) => {
          e.stopPropagation();
          onSendToBack(element.id);
        });

        // Delete button
        const btnDelete = h('button', {
          type: 'button',
          title: t('editor.freeform.delete', 'Delete element'),
          class: 'is-danger',
        });
        btnDelete.appendChild(trashIcon({ size: 18 }));
        btnDelete.addEventListener('click', (e) => {
          e.stopPropagation();
          onDeleteElement(element.id);
        });

        toolbar.append(btnFront, btnBack, btnDelete);
        overlay.append(toolbar);
      }

      container.append(overlay);
    }
  }

  // Initial render
  renderElementOverlays();

  // Click on empty space to deselect
  container.addEventListener('pointerdown', (e) => {
    if (e.target === container) {
      onSelectElement(null);
    }
  });

  // Public API
  return {
    element: container,
    refresh: renderElementOverlays,
  };
}

/**
 * Create element add buttons
 */
export function createElementAddButtons({
  h,
  elements,
  maxElements,
  onAddElement,
} = {}) {
  const MAX_ELEMENTS = maxElements || 20;
  const count = Array.isArray(elements) ? elements.length : 0;
  const canAdd = count < MAX_ELEMENTS;

  const container = h('div', { class: 'freeform-add-buttons' });

  const addHeading = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('editor.freeform.addHeading', '+ Heading'),
    disabled: !canAdd,
    onclick: () => {
      onAddElement({
        id: cryptoUuid(),
        type: 'heading',
        x: 10,
        y: 10,
        width: 60,
        height: 15,
        zIndex: count,
        content: t('editor.freeform.newHeading', 'New heading'),
        fontSize: 'lg',
      });
    },
  });

  const addText = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('editor.freeform.addText', '+ Text'),
    disabled: !canAdd,
    onclick: () => {
      onAddElement({
        id: cryptoUuid(),
        type: 'text',
        x: 10,
        y: 30,
        width: 40,
        height: 30,
        zIndex: count,
        content: t('editor.freeform.newText', 'New text block'),
        fontSize: 'md',
      });
    },
  });

  const addImage = h('button', {
    type: 'button',
    class: 'btn btn-secondary',
    text: t('editor.freeform.addImage', '+ Image'),
    disabled: !canAdd,
    onclick: () => {
      onAddElement({
        id: cryptoUuid(),
        type: 'image',
        x: 55,
        y: 30,
        width: 35,
        height: 40,
        zIndex: count,
        src: '',
        alt: '',
        focusX: 50,
        focusY: 50,
      });
    },
  });

  const countLabel = h('span', {
    class: 'pill',
    text: `${count} / ${MAX_ELEMENTS}`,
  });

  container.append(addHeading, addText, addImage, countLabel);

  return container;
}
