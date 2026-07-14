/**
 * Nested slides helper functions for the slide list.
 * Manages parent-child relationships, collapsed state, and hierarchy navigation.
 */

// ========================================
// PARENT-CHILD RELATIONSHIP HELPERS
// ========================================

/**
 * Build a map of parent slides to their children
 * @param {Array} slides - All slides in the presentation
 * @returns {Map<string, Array>} Map of parentId -> array of child slides
 */
export function buildChildrenMap(slides) {
  const childrenMap = new Map();
  for (const s of slides) {
    if (s.parentId) {
      if (!childrenMap.has(s.parentId)) {
        childrenMap.set(s.parentId, []);
      }
      childrenMap.get(s.parentId).push(s);
    }
  }
  return childrenMap;
}

/**
 * Get all children of a parent slide (recursively collects children)
 * @param {string} parentId - The parent slide ID
 * @param {Array} slides - All slides
 * @returns {Array} Array of child slides
 */
export function getChildSlides(parentId, slides) {
  return slides.filter((s) => s.parentId === parentId);
}

/**
 * Direct child slide IDs of a parent (one level).
 * @param {string} parentId
 * @param {Array} slides
 * @returns {string[]}
 */
export function getChildIds(parentId, slides) {
  return (slides || [])
    .filter((s) => s.parentId === parentId)
    .map((s) => s.id);
}

/**
 * Get all descendant slide IDs (for group moves)
 * @param {string} parentId - The parent slide ID
 * @param {Array} slides - All slides
 * @returns {Array<string>} Array of child slide IDs
 */
export function getDescendantIds(parentId, slides) {
  const children = getChildSlides(parentId, slides);
  return children.map((c) => c.id);
}

/**
 * Check if a slide is a child (has parentId)
 * @param {Object} slide - The slide to check
 * @returns {boolean} True if slide is a child
 */
export function isChildSlide(slide) {
  return !!slide?.parentId;
}

/**
 * Check if a slide is a parent (has children)
 * @param {string} slideId - The slide ID
 * @param {Map} childrenMap - Map of parentId -> children
 * @returns {boolean} True if slide has children
 */
export function isParentSlide(slideId, childrenMap) {
  const children = childrenMap.get(slideId);
  return children && children.length > 0;
}

// ========================================
// COLLAPSED STATE PERSISTENCE
// ========================================

/**
 * Get collapsed state from localStorage
 * @param {string} presentationId - The presentation ID
 * @returns {Set<string>} Set of collapsed parent slide IDs
 */
export function getCollapsedState(presentationId) {
  try {
    const key = `slides-collapsed-${presentationId}`;
    const stored = localStorage.getItem(key);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Save collapsed state to localStorage
 * @param {string} presentationId - The presentation ID
 * @param {Set<string>} collapsedSet - Set of collapsed parent slide IDs
 */
export function saveCollapsedState(presentationId, collapsedSet) {
  try {
    const key = `slides-collapsed-${presentationId}`;
    localStorage.setItem(key, JSON.stringify(Array.from(collapsedSet)));
  } catch {
    // ignore
  }
}

// ========================================
// UI HELPERS
// ========================================

/**
 * Create chevron SVG for collapse/expand toggle
 * @returns {SVGElement} The chevron SVG element
 */
export function createChevronSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M9 18l6-6-6-6');
  svg.appendChild(path);
  return svg;
}
