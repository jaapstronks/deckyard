export const $ = (sel, el = document) =>
  el.querySelector(sel);
export const $$ = (sel, el = document) =>
  Array.from(el.querySelectorAll(sel));

export function h(tag, attrs = {}, children = []) {
  const t = String(tag || '');
  const tn = t.toLowerCase();
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SVG_TAGS = new Set([
    'svg',
    'path',
    'g',
    'circle',
    'rect',
    'line',
    'polyline',
    'polygon',
    'defs',
    'mask',
    'clipPath',
    'linearGradient',
    'radialGradient',
    'stop',
    'pattern',
    'text',
    'tspan',
    'use',
    'symbol',
    'title',
    'desc',
  ]);

  const el = SVG_TAGS.has(tn)
    ? document.createElementNS(SVG_NS, tn)
    : document.createElement(t);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') {
      // SVG elements use an animated className; setAttribute is more robust.
      if (typeof SVGElement !== 'undefined' && el instanceof SVGElement)
        el.setAttribute('class', String(v));
      else el.className = v;
    }
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === false || v == null) {
      // Skip boolean false/null/undefined attributes entirely.
      // Important for boolean attributes like "disabled"/"checked":
      // presence means true, even if the value is "false".
      continue;
    } else if (v === true) {
      // Boolean attribute presence
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    // Skip empty children (common in conditional render patterns).
    // IMPORTANT: keep 0 and '' as valid children.
    if (c == null || c === false) continue;
    el.append(c);
  }
  return el;
}

/**
 * Create a focus trap within a container element.
 * Keeps focus inside the container when Tab/Shift+Tab is pressed.
 * @param {HTMLElement} container - The element to trap focus within
 * @returns {Function} Cleanup function to remove the focus trap
 */
export function createFocusTrap(container) {
  if (!container) return () => {};

  const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  function getFocusableElements() {
    return Array.from(container.querySelectorAll(FOCUSABLE_SELECTORS))
      .filter((el) => el.offsetParent !== null); // visible elements only
  }

  function handleKeyDown(e) {
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements();
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      // Shift+Tab: if on first element, wrap to last
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: if on last element, wrap to first
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener('keydown', handleKeyDown);

  // Focus the first focusable element
  requestAnimationFrame(() => {
    const focusable = getFocusableElements();
    if (focusable.length > 0) {
      focusable[0].focus();
    }
  });

  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

// Install a robust "dismiss on outside click + Escape" handler.
// Uses capture-phase pointerdown so it still works even if other handlers call
// stopPropagation() on click events.
export function installDismissOnOutside({
  rootEl,
  isOpen = () => false,
  close = () => {},
  returnFocusEl = null,
} = {}) {
  if (!rootEl || typeof rootEl.contains !== 'function') return () => {};

  const onDocPointerDown = (ev) => {
    try {
      if (!isOpen()) return;
      const t = ev?.target;
      if (t && rootEl.contains(t)) return;
      close();
    } catch {
      // ignore
    }
  };

  const onDocKeyDown = (ev) => {
    try {
      if (ev?.key !== 'Escape') return;
      if (!isOpen()) return;
      close();
      try {
        returnFocusEl?.focus?.();
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  document.addEventListener('pointerdown', onDocPointerDown, true);
  document.addEventListener('keydown', onDocKeyDown, true);

  return () => {
    document.removeEventListener('pointerdown', onDocPointerDown, true);
    document.removeEventListener('keydown', onDocKeyDown, true);
  };
}