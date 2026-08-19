import { prefersReducedMotion } from '../../lib/dom/motion.js';

function retriggerCssAnimation(el, { preClass, animClass } = {}) {
  if (!el || !el.classList) return;
  const pre = String(preClass || '').trim();
  const anim = String(animClass || '').trim();
  if (!pre || !anim) return;

  // Reset
  el.classList.remove(anim);
  el.classList.add(pre);

  // Force a reflow so the browser acknowledges the class change.
  // eslint-disable-next-line no-unused-expressions
  el.offsetWidth;

  // Trigger animation class
  el.classList.remove(pre);
  el.classList.add(anim);
}

/**
 * Type an element's text content in char-by-char, reserving its final height so
 * the layout doesn't jump. Generalized from the quote typewriter so per-bullet
 * builds can reuse it. Callers pass the animator's raf/timeout/cleanup plumbing
 * so a slide change (or the next bullet) can snap it back to the full text.
 * @param {Element} el
 * @param {Object} deps
 */
function typeTextInElement(
  el,
  { registerCleanup, setRaf, setTimeoutSafe, msPerChar = 28 } = {},
) {
  if (!el) return;
  const fullText =
    el.dataset?.fullText != null
      ? String(el.dataset.fullText)
      : String(el.textContent || '');
  if (el.dataset) el.dataset.fullText = fullText;

  const cleanup = () => {
    try {
      if (el.dataset?.fullText != null)
        el.textContent = String(el.dataset.fullText);
      el.style.minHeight = '';
    } catch {}
  };
  if (typeof registerCleanup === 'function') registerCleanup(cleanup);

  // Reserve the final height so surrounding content doesn't shift while typing.
  const measured = el.getBoundingClientRect?.().height;
  if (Number.isFinite(measured) && measured > 0) {
    el.style.minHeight = `${Math.ceil(measured)}px`;
  }

  el.textContent = '';
  const len = fullText.length;
  const start = performance.now ? performance.now() : Date.now();

  const tick = () => {
    const now = performance.now ? performance.now() : Date.now();
    const n = Math.min(len, Math.floor(Math.max(0, now - start) / msPerChar));
    el.textContent = fullText.slice(0, n);
    if (n >= len) {
      if (typeof setTimeoutSafe === 'function') {
        setTimeoutSafe(() => {
          try {
            el.style.minHeight = '';
          } catch {}
        }, 0);
      } else {
        try {
          el.style.minHeight = '';
        } catch {}
      }
      return;
    }
    if (typeof setRaf === 'function') setRaf(requestAnimationFrame(tick));
  };

  if (typeof setRaf === 'function') setRaf(requestAnimationFrame(tick));
}

export function createPresenterAnimator() {
  let raf = null;
  const timeouts = new Set();
  // Per-bullet typewriter runs on step-advance, independent of slide-change
  // animations, so it gets its own cleanup channel — snapping an in-progress
  // bullet to its full text before the next one starts (or on slide change).
  let typeCleanups = [];

  const runTypeCleanups = () => {
    if (raf) {
      try {
        cancelAnimationFrame(raf);
      } catch {}
      raf = null;
    }
    for (const fn of typeCleanups) {
      try {
        fn();
      } catch {}
    }
    typeCleanups = [];
  };

  const cancel = () => {
    if (raf) {
      try {
        cancelAnimationFrame(raf);
      } catch {}
    }
    raf = null;

    for (const t of timeouts) {
      try {
        clearTimeout(t);
      } catch {}
    }
    timeouts.clear();

    runTypeCleanups();
  };

  const setRaf = (id) => {
    raf = id;
  };

  const setTimeoutSafe = (fn, ms) => {
    const id = setTimeout(() => {
      timeouts.delete(id);
      try {
        fn();
      } catch {}
    }, ms);
    timeouts.add(id);
    return id;
  };

  const runSlideAnimations = (slideSectionEl) => {
    if (!slideSectionEl?.querySelectorAll) return;

    // Cancel any pending run; we only animate the currently shown slide.
    cancel();

    if (prefersReducedMotion()) return;

    // Today we only have one explicit "presenter-only" animation:
    // payoff-slide logo zoom-in (CSS classes defined in slides CSS).
    const payoffLogos = Array.from(
      slideSectionEl.querySelectorAll('.payoff-logo'),
    );
    if (payoffLogos.length) {
      raf = requestAnimationFrame(() => {
        raf = null;
        for (const el of payoffLogos) {
          retriggerCssAnimation(el, {
            preClass: 'is-payoff-pre',
            animClass: 'is-payoff-anim',
          });
        }
      });
    }
  };

  /**
   * Typewriter-reveal a single just-shown body fragment (a bullet or paragraph).
   * Snaps any prior in-progress bullet to its full text first, so rapid
   * advancing stays coherent. No-ops under reduced motion, and reveals rich
   * fragments (links, bold, nested lists) instantly rather than flattening
   * their markup. The fragment is assumed already visible (display handled by
   * the step reveal); this only animates its text in.
   * @param {Element} el
   */
  const typewrite = (el) => {
    // Snap any bullet still typing to its full text before starting the next.
    runTypeCleanups();
    if (!el || !el.classList) return;
    if (prefersReducedMotion()) return;
    // Char-by-char typing works on plain text only; anything with child
    // elements (inline links/bold, sub-lists) is revealed as-is.
    if (el.children && el.children.length > 0) return;
    if (!String(el.textContent || '').trim()) return;

    typeTextInElement(el, {
      registerCleanup: (fn) => {
        if (typeof fn === 'function') typeCleanups.push(fn);
      },
      setRaf,
      setTimeoutSafe,
    });
  };

  return { runSlideAnimations, cancel, typewrite };
}
