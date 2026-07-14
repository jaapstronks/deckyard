/**
 * Content Morph Transitions
 *
 * FLIP-based morph engine that animates matched elements between slides
 * using `data-morph-role` attributes. Unmatched elements crossfade.
 */

import { prefersReducedMotion } from '../../lib/motion.js';

export const MORPH_DURATION = 560;

const MORPH_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
const FADE_DURATION = Math.round(MORPH_DURATION * 0.6);
const SAFETY_TIMEOUT = MORPH_DURATION + 100;

function parseStageScale(stageInner) {
  try {
    const raw = stageInner?.style?.transform || '';
    const m = raw.match(/scale\(\s*([\d.]+)\s*\)/);
    return m ? parseFloat(m[1]) || 1 : 1;
  } catch {
    return 1;
  }
}

function collectMorphElements(section) {
  const map = new Map();
  if (!section) return map;
  const els = section.querySelectorAll('[data-morph-role]');
  for (const el of els) {
    const role = el.dataset.morphRole;
    if (role && !map.has(role)) {
      map.set(role, el);
    }
  }
  return map;
}

function cleanupInlineStyles(el) {
  el.style.transform = '';
  el.style.transformOrigin = '';
  el.style.transition = '';
  el.style.opacity = '';
  el.style.willChange = '';
}

/**
 * Morph transition between two slide sections.
 *
 * @param {HTMLElement} fromSection - Outgoing slide section
 * @param {HTMLElement} toSection   - Incoming slide section
 * @param {HTMLElement} stageInner  - .deck-stage-inner element (has scale transform)
 * @param {object}      options
 * @param {Function}    options.onCancel - Returns true if transition should abort
 * @returns {Promise<void>}
 */
export function morphTransition(fromSection, toSection, stageInner, options = {}) {
  const { onCancel } = options;
  const cancelled = () => typeof onCancel === 'function' && onCancel();

  return new Promise((resolve) => {
    // Reduced motion: instant swap
    if (prefersReducedMotion()) {
      resolve();
      return;
    }

    if (cancelled()) { resolve(); return; }

    // ── FIRST: collect from-elements and measure rects ──
    const fromMap = collectMorphElements(fromSection);
    const fromRects = new Map();
    for (const [role, el] of fromMap) {
      fromRects.set(role, el.getBoundingClientRect());
    }

    // ── Collect to-elements ──
    const toMap = collectMorphElements(toSection);

    // ── MATCH: pair by role ──
    const matched = [];
    const unmatchedTo = [];
    for (const [role, toEl] of toMap) {
      if (fromRects.has(role)) {
        matched.push({ toEl, fromRect: fromRects.get(role) });
      } else {
        unmatchedTo.push(toEl);
      }
    }

    // ── LAST: make toSection visible and measure to-rects ──
    toSection.style.opacity = '1';
    toSection.style.visibility = 'visible';
    toSection.style.zIndex = '2';

    if (cancelled()) {
      toSection.style.opacity = '';
      toSection.style.visibility = '';
      toSection.style.zIndex = '';
      resolve();
      return;
    }

    const scale = parseStageScale(stageInner);
    const hasMatches = matched.length > 0;

    // Toggle .is-morphing on the stage wrapper for CSS will-change hints
    const stageWrap = stageInner?.closest?.('.deck-stage') || null;
    if (stageWrap) stageWrap.classList.add('is-morphing');

    // Track all elements we touched for cleanup
    const touchedEls = [];
    let done = false;
    let safetyTid = 0;

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(safetyTid);

      if (stageWrap) stageWrap.classList.remove('is-morphing');
      for (const el of touchedEls) cleanupInlineStyles(el);
      toSection.style.opacity = '';
      toSection.style.visibility = '';
      toSection.style.zIndex = '';
      toSection.style.transition = '';
      fromSection.style.transition = '';
      fromSection.style.opacity = '';

      resolve();
    };

    safetyTid = setTimeout(finish, SAFETY_TIMEOUT);

    if (!hasMatches) {
      // ── No matches: crossfade fallback ──
      toSection.style.opacity = '0';
      toSection.style.transition = `opacity ${MORPH_DURATION}ms ${MORPH_EASING}`;
      fromSection.style.transition = `opacity ${MORPH_DURATION}ms ${MORPH_EASING}`;

      // eslint-disable-next-line no-unused-expressions
      stageInner.offsetWidth;

      toSection.style.opacity = '1';
      fromSection.style.opacity = '0';

      const onEnd = (e) => {
        if (e.target !== toSection || e.propertyName !== 'opacity') return;
        toSection.removeEventListener('transitionend', onEnd);
        finish();
      };
      toSection.addEventListener('transitionend', onEnd);
      return;
    }

    // ── INVERT: apply inverse transforms to matched to-elements ──
    // Also dip opacity so even stationary elements get a visible "arrive" effect.
    for (const { toEl, fromRect } of matched) {
      const toRect = toEl.getBoundingClientRect();
      const dx = (fromRect.left - toRect.left) / scale;
      const dy = (fromRect.top - toRect.top) / scale;
      const sx = toRect.width ? fromRect.width / toRect.width : 1;
      const sy = toRect.height ? fromRect.height / toRect.height : 1;

      toEl.style.transformOrigin = 'top left';
      toEl.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
      toEl.style.opacity = '0.45';
      toEl.style.willChange = 'transform, opacity';
      touchedEls.push(toEl);
    }

    // Set unmatched to-elements invisible for fade-in
    for (const el of unmatchedTo) {
      el.style.opacity = '0';
      el.style.willChange = 'opacity';
      touchedEls.push(el);
    }

    // ── Force reflow ──
    // eslint-disable-next-line no-unused-expressions
    stageInner.offsetWidth;

    if (cancelled()) { finish(); return; }

    // ── PLAY: animate to identity ──
    const morphTrans = `transform ${MORPH_DURATION}ms ${MORPH_EASING}, opacity ${MORPH_DURATION}ms ${MORPH_EASING}`;
    for (const { toEl } of matched) {
      toEl.style.transition = morphTrans;
      toEl.style.transform = 'none';
      toEl.style.opacity = '1';
    }

    for (const el of unmatchedTo) {
      el.style.transition = `opacity ${MORPH_DURATION}ms ${MORPH_EASING}`;
      el.style.opacity = '1';
    }

    // Fade out from-section (shorter, so new slide "wins")
    fromSection.style.transition = `opacity ${FADE_DURATION}ms ${MORPH_EASING}`;
    fromSection.style.opacity = '0';

    // Listen for transitionend on a morphed element (events bubble to toSection).
    // Accept both transform and opacity — stationary elements only fire opacity.
    const onEnd = (e) => {
      if (e.propertyName !== 'transform' && e.propertyName !== 'opacity') return;
      // Any matched element finishing is sufficient (all start together)
      toSection.removeEventListener('transitionend', onEnd);
      finish();
    };
    toSection.addEventListener('transitionend', onEnd);
  });
}
