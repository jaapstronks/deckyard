/**
 * Inline SVG icon utilities (Lucide Icons)
 *
 * Creates SVG icon elements without external dependencies.
 * For Lucide icons loaded from files, use shared/icon-names.js instead.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an SVG element with standard attributes
 * @param {Object} options
 * @param {number} [options.size=16] - Icon size in pixels
 * @param {string} [options.viewBox='0 0 24 24'] - SVG viewBox
 * @param {string} options.innerHTML - SVG path content
 * @returns {SVGSVGElement}
 */
function createSvgIcon({ size = 16, viewBox = '0 0 24 24', innerHTML }) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', viewBox);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = innerHTML;
  return svg;
}

/**
 * Copy icon (two overlapping rectangles)
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function copyIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  });
}

/**
 * Trash icon (bin with lid and lines)
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function trashIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>',
  });
}

/**
 * Star icon (five-pointed star)
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @param {boolean} [options.filled=false]
 * @returns {SVGSVGElement}
 */
export function starIcon({ size = 16, filled = false } = {}) {
  const svg = createSvgIcon({
    size,
    innerHTML: '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
  });
  if (filled) {
    svg.setAttribute('fill', 'currentColor');
  }
  return svg;
}

/**
 * Close/X icon
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function closeIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  });
}

/**
 * Chevron right icon
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function chevronRightIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<path d="m9 18 6-6-6-6"/>',
  });
}

/**
 * Chevron left icon
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function chevronLeftIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<path d="m15 18-6-6 6-6"/>',
  });
}

/**
 * More/ellipsis icon (horizontal three dots)
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function moreIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  });
}

/**
 * Drag handle icon (6-dot grip pattern for reordering)
 * @param {Object} [options]
 * @param {number} [options.size=12]
 * @returns {SVGSVGElement}
 */
export function dragHandleIcon({ size = 12 } = {}) {
  return createSvgIcon({
    size,
    viewBox: '0 0 24 24',
    innerHTML: '<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>',
  });
}

/**
 * Lock icon (closed padlock)
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function lockIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  });
}

/**
 * Unlock icon (open padlock)
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function unlockIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>',
  });
}

/**
 * Chevron down icon (for collapse/expand indicators)
 * @param {Object} [options]
 * @param {number} [options.size=12]
 * @returns {SVGSVGElement}
 */
export function chevronDownIcon({ size = 12 } = {}) {
  return createSvgIcon({
    size,
    viewBox: '0 0 24 24',
    innerHTML: '<path d="m6 9 6 6 6-6"/>',
  });
}

/**
 * Zoom-in icon (magnifier with a plus - "enlarge", where a bare magnifier
 * would read as "search")
 * @param {Object} [options]
 * @param {number} [options.size=16]
 * @returns {SVGSVGElement}
 */
export function zoomInIcon({ size = 16 } = {}) {
  return createSvgIcon({
    size,
    innerHTML: '<circle cx="11" cy="11" r="8"/><line x1="21" x2="16.65" y1="21" y2="16.65"/><line x1="11" x2="11" y1="8" y2="14"/><line x1="8" x2="14" y1="11" y2="11"/>',
  });
}

/**
 * The caret for labeled dropdown triggers (Export, Share): one shared
 * chevron so every menu button announces itself the same way.
 * @returns {SVGSVGElement}
 */
export function makeDropdownCaret() {
  const svg = chevronDownIcon({ size: 14 });
  svg.classList.add('dropdown-caret');
  return svg;
}
