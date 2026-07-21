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

function prepareQuoteTypewriter(slideSectionEl) {
  if (!slideSectionEl?.querySelectorAll) return [];
  const quoteSlides = Array.from(
    slideSectionEl.querySelectorAll('.slide.slide-quote')
  );
  if (!quoteSlides.length) return [];

  const cleanups = [];

  for (const slideEl of quoteSlides) {
    const block = slideEl.querySelector('blockquote.quote-text');
    const p = block?.querySelector('p');
    if (!block || !p) continue;

    const fullText =
      p?.dataset?.fullText != null
        ? String(p.dataset.fullText)
        : String(p.textContent || '');
    if (p?.dataset) p.dataset.fullText = fullText;

    const cleanup = () => {
      try {
        if (p?.dataset?.fullText != null)
          p.textContent = String(p.dataset.fullText);
        p.style.minHeight = '';
        p.style.display = '';
      } catch {}
    };

    cleanups.push(cleanup);
  }

  return cleanups;
}

function runQuoteTypewriter(slideSectionEl, { registerCleanup, setRaf, setTimeoutSafe } = {}) {
  if (!slideSectionEl?.querySelectorAll) return;
  const block = slideSectionEl.querySelector(
    '.slide.slide-quote blockquote.quote-text'
  );
  const p = block?.querySelector('p');
  if (!block || !p) return;

  const fullText =
    p?.dataset?.fullText != null
      ? String(p.dataset.fullText)
      : String(p.textContent || '');
  if (p?.dataset) p.dataset.fullText = fullText;

  const cleanup = () => {
    try {
      if (p?.dataset?.fullText != null)
        p.textContent = String(p.dataset.fullText);
      p.style.minHeight = '';
      p.style.display = '';
    } catch {}
  };
  if (typeof registerCleanup === 'function') registerCleanup(cleanup);

  // Reserve final layout height so the quote doesn't "move" while we type.
  // We force block layout to get a stable height measurement.
  p.style.display = 'block';
  p.textContent = fullText;
  const measured = p.getBoundingClientRect?.().height;
  if (Number.isFinite(measured) && measured > 0) {
    p.style.minHeight = `${Math.ceil(measured)}px`;
  }

  // Reset + start typing (no caret/cursor UI)
  p.textContent = '';

  // Simple time-based typewriter (presenter-only).
  // Tuned for "feels like typing" without being too slow for ~400 chars.
  const msPerChar = 30;
  const len = fullText.length;
  const start = performance.now ? performance.now() : Date.now();

  const tick = () => {
    const now = performance.now ? performance.now() : Date.now();
    const elapsed = Math.max(0, now - start);
    const n = Math.min(len, Math.floor(elapsed / msPerChar));
    p.textContent = fullText.slice(0, n);
    if (n >= len) {
      // Restore normal layout (no reserved height).
      if (typeof setTimeoutSafe === 'function') {
        setTimeoutSafe(() => {
          try {
            p.style.minHeight = '';
            p.style.display = '';
          } catch {}
        }, 0);
      } else {
        try {
          p.style.minHeight = '';
          p.style.display = '';
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
  let cleanups = [];

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

    for (const fn of cleanups) {
      try {
        fn();
      } catch {}
    }
    cleanups = [];
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

  const registerCleanup = (fn) => {
    if (typeof fn === 'function') cleanups.push(fn);
  };

  const runSlideAnimations = (slideSectionEl) => {
    if (!slideSectionEl?.querySelectorAll) return;

    // Cancel any pending run; we only animate the currently shown slide.
    cancel();

    // Ensure quote text is always readable in reduced motion mode.
    // (This also initializes cleanup state for quotes.)
    const quoteCleanups = prepareQuoteTypewriter(slideSectionEl);
    for (const fn of quoteCleanups) registerCleanup(fn);

    if (prefersReducedMotion()) return;

    // Today we only have one explicit "presenter-only" animation:
    // payoff-slide logo zoom-in (CSS classes defined in slides CSS).
    const payoffLogos = Array.from(
      slideSectionEl.querySelectorAll('.payoff-logo')
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

    // Quote slide: typewriter-in (presenter-only; CSS caret + JS text reveal).
    runQuoteTypewriter(slideSectionEl, {
      registerCleanup,
      setRaf,
      setTimeoutSafe,
    });
  };

  return { runSlideAnimations, cancel };
}
