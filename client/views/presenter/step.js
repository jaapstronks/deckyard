// Presenter step-through helpers (body paragraphs/lists or card grids).

const getBodyEl = (section) =>
  section?.querySelector?.(
    '.slide-content .body, .slide-image-text .copy .body'
  ) || null;

// Zoom step presets: each position is { x, y } as percentages (0-100)
const ZOOM_PRESETS = {
  corners: [
    { x: 25, y: 25 }, // top-left
    { x: 75, y: 25 }, // top-right
    { x: 25, y: 75 }, // bottom-left
    { x: 75, y: 75 }, // bottom-right
  ],
  horizontal: [
    { x: 25, y: 50 }, // left
    { x: 75, y: 50 }, // right
  ],
  vertical: [
    { x: 50, y: 25 }, // top
    { x: 50, y: 75 }, // bottom
  ],
  quadrants: [
    { x: 25, y: 25 }, // top-left
    { x: 75, y: 25 }, // top-right
    { x: 25, y: 75 }, // bottom-left
    { x: 75, y: 75 }, // bottom-right
  ],
};

/**
 * Get the zoom positions for an image slide based on its configuration.
 */
export const getImageZoomConfig = (section) => {
  const slide = section?.querySelector?.('.slide-image[data-zoom-steps]');
  if (!slide) return null;

  const preset = slide.dataset.zoomSteps || '';
  if (!preset) return null;

  const zoomLevel = parseFloat(slide.dataset.zoomLevel) || 2;
  let positions = [];

  if (preset === 'custom') {
    try {
      const customStr = slide.dataset.zoomPositions || '[]';
      positions = JSON.parse(customStr);
      if (!Array.isArray(positions)) positions = [];
    } catch {
      positions = [];
    }
  } else if (ZOOM_PRESETS[preset]) {
    positions = ZOOM_PRESETS[preset];
  }

  if (!positions.length) return null;

  return { positions, zoomLevel, preset };
};

/**
 * Collect zoom step count for an image slide.
 */
export const collectImageZoomSteps = (section) => {
  const config = getImageZoomConfig(section);
  if (!config) return [];
  // Return an array of indices representing steps (starting with step 0 = zoomed out)
  return config.positions.map((_, i) => i);
};

/**
 * Apply zoom transform to the image based on the current step.
 * Step 0 = zoomed out (full view), steps 1+ = zoom positions.
 */
export const applyImageZoomStep = (section, stepIndex) => {
  const slide = section?.querySelector?.('.slide-image[data-zoom-steps]');
  if (!slide) return;

  const config = getImageZoomConfig(section);
  if (!config) return;

  const img = slide.querySelector('.frame .image');
  if (!img) return;

  const { positions, zoomLevel } = config;

  // stepIndex 0 means show full image (no zoom)
  // stepIndex 1+ corresponds to positions[stepIndex - 1]
  if (stepIndex <= 0) {
    // Reset to full view
    img.style.transform = '';
    img.style.transformOrigin = 'center center';
    slide.classList.remove('is-zoomed');
    slide.dataset.zoomStep = '0';
    return;
  }

  const posIndex = stepIndex - 1;
  if (posIndex >= positions.length) {
    // Beyond available positions, stay at last
    return;
  }

  const pos = positions[posIndex];
  const x = typeof pos.x === 'number' ? pos.x : 50;
  const y = typeof pos.y === 'number' ? pos.y : 50;

  // Set transform origin to the zoom position and apply scale
  img.style.transformOrigin = `${x}% ${y}%`;
  img.style.transform = `scale(${zoomLevel})`;
  slide.classList.add('is-zoomed');
  slide.dataset.zoomStep = String(stepIndex);
};

export const collectCardsForSlide = (section) => {
  if (!section?.querySelectorAll) return [];
  const stack = Array.from(
    section.querySelectorAll(
      '.slide-card-stack .card-stack-row'
    )
  );
  if (stack.length) return stack;
  const kpis = Array.from(
    section.querySelectorAll(
      '.slide-kpi-metrics .kpi-metric:not(.is-empty)'
    )
  );
  if (kpis.length) return kpis;
  const iconCards = Array.from(
    section.querySelectorAll(
      '.slide-icon-card-grid .icon-card:not(.is-empty)'
    )
  );
  if (iconCards.length) return iconCards;
  // Treat the “Lijstje” slide items as step-able cards so they use the same
  // presenter/follow stepping system as card-stack and icon-card slides.
  const lijstItems = Array.from(
    section.querySelectorAll('.slide-lijstje .lijst-item')
  );
  if (lijstItems.length) return lijstItems;
  const timelineItems = Array.from(
    section.querySelectorAll(
      '.slide-timeline .timeline-item'
    )
  );
  if (timelineItems.length) return timelineItems;
  // Text-blocks slide: step through blocks, arrows, and row titles in DOM order.
  const textBlocksSteps = Array.from(
    section.querySelectorAll(
      '.slide-text-blocks .text-blocks-step'
    )
  );
  if (textBlocksSteps.length) return textBlocksSteps;
  // Table slide: step through rows (default) or cells (if animateByCell is enabled).
  // Check for row-based stepping first (default behavior).
  const tableRows = Array.from(
    section.querySelectorAll('.slide-table .table-step-row')
  );
  if (tableRows.length) return tableRows;
  // Fall back to cell-based stepping (animateByCell: 'on').
  const tableCells = Array.from(
    section.querySelectorAll('.slide-table .table-step-cell')
  );
  if (tableCells.length) return tableCells;
  return [];
};

export const applyCardsVisibility = (
  section,
  shownCount
) => {
  const cards = collectCardsForSlide(section);
  for (let i = 0; i < cards.length; i += 1) {
    cards[i].classList.toggle(
      'sb-step-hidden',
      i >= shownCount
    );
  }
};

export const collectChartFragmentsForSlide = (section) => {
  if (!section?.querySelectorAll) return [];
  return Array.from(
    section.querySelectorAll('.slide-chart .chart-frag')
  );
};

export const applyChartVisibility = (
  section,
  shownCount
) => {
  const frags = collectChartFragmentsForSlide(section);
  for (let i = 0; i < frags.length; i += 1) {
    frags[i].classList.toggle(
      'sb-step-hidden',
      i >= shownCount
    );
  }
};

export const getStepMode = (section) => {
  // Check for image zoom steps first (dedicated image slides with zoom enabled)
  const imageZoomSteps = collectImageZoomSteps(section);
  if (imageZoomSteps.length) return 'image-zoom';
  // Prefer card stepping for card-based slides; otherwise step the body.
  const cards = collectCardsForSlide(section);
  if (cards.length) return 'cards';
  const chartFrags = collectChartFragmentsForSlide(section);
  if (chartFrags.length) return 'chart';
  const body = getBodyEl(section);
  if (body) return 'body';
  return null;
};

export const collectFragmentsForSlide = (section) => {
  const body = getBodyEl(section);
  if (!body) return [];

  const lis = Array.from(body.querySelectorAll('li'));
  const ps = Array.from(body.querySelectorAll('p')).filter(
    (p) => !p.closest('li')
  );
  // Order fragments as they appear in the DOM (important for mixed content).
  const all = [...lis, ...ps].sort((a, b) => {
    if (a === b) return 0;
    const pos = a.compareDocumentPosition(b);
    if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });
  return all.filter(
    (el) => (el.textContent || '').trim().length > 0
  );
};

export const applyFragmentsVisibility = (
  section,
  shownCount
) => {
  const body = getBodyEl(section);
  if (!body) return;
  const frags = collectFragmentsForSlide(section);

  for (let i = 0; i < frags.length; i++) {
    frags[i].style.display = i < shownCount ? '' : 'none';
  }

  // Avoid blank space from empty lists when all items are hidden.
  const lists = Array.from(body.querySelectorAll('ul, ol'));
  for (const list of lists) {
    const anyVisible = Array.from(
      list.querySelectorAll('li')
    ).some((li) => li.style.display !== 'none');
    list.style.display = anyVisible ? '' : 'none';
  }
};

/**
 * Apply step visibility to a slide element based on step mode and index.
 * This consolidates the step application logic used by both presenter and follow views.
 * @param {Element} el - The slide element
 * @param {boolean} stepParagraphs - Whether step mode is enabled
 * @param {number} stepIdx - Current step index (0-based)
 */
export const applyStepVisibilityForMode = (el, stepParagraphs, stepIdx) => {
  if (!stepParagraphs) {
    // Step mode disabled - show everything
    applyFragmentsVisibility(el, Number.POSITIVE_INFINITY);
    applyCardsVisibility(el, Number.POSITIVE_INFINITY);
    applyChartVisibility(el, Number.POSITIVE_INFINITY);
    applyImageZoomStep(el, 0);
    return;
  }

  const mode = getStepMode(el);
  const idx = Math.max(0, Number(stepIdx || 0) || 0);

  if (!mode) {
    // No stepping content - show everything
    applyFragmentsVisibility(el, Number.POSITIVE_INFINITY);
    applyCardsVisibility(el, Number.POSITIVE_INFINITY);
    applyChartVisibility(el, Number.POSITIVE_INFINITY);
    applyImageZoomStep(el, 0);
  } else if (mode === 'image-zoom') {
    applyFragmentsVisibility(el, Number.POSITIVE_INFINITY);
    applyCardsVisibility(el, Number.POSITIVE_INFINITY);
    applyChartVisibility(el, Number.POSITIVE_INFINITY);
    applyImageZoomStep(el, idx);
  } else if (mode === 'body') {
    applyCardsVisibility(el, Number.POSITIVE_INFINITY);
    applyChartVisibility(el, Number.POSITIVE_INFINITY);
    applyImageZoomStep(el, 0);
    applyFragmentsVisibility(el, idx);
  } else if (mode === 'cards') {
    applyFragmentsVisibility(el, Number.POSITIVE_INFINITY);
    applyChartVisibility(el, Number.POSITIVE_INFINITY);
    applyImageZoomStep(el, 0);
    applyCardsVisibility(el, idx);
  } else if (mode === 'chart') {
    applyFragmentsVisibility(el, Number.POSITIVE_INFINITY);
    applyCardsVisibility(el, Number.POSITIVE_INFINITY);
    applyImageZoomStep(el, 0);
    applyChartVisibility(el, idx);
  }
};
/**
 * The step helpers the presenter deck-controller consumes, bundled so callers
 * (the presenter and the projector window) don't re-list all nine by hand.
 * @see createPresenterDeckController
 */
export const STEP_DEPS = {
  applyCardsVisibility,
  applyChartVisibility,
  applyFragmentsVisibility,
  applyImageZoomStep,
  collectCardsForSlide,
  collectChartFragmentsForSlide,
  collectFragmentsForSlide,
  collectImageZoomSteps,
  getStepMode,
};
