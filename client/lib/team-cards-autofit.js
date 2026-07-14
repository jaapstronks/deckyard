/**
 * Team-cards (image-blocks) auto-fit runtime.
 *
 * The team-cards grid uses fixed per-count photo sizes and doesn't account for
 * names / bylines wrapping to two lines. With enough cards and multi-line text
 * (e.g. 9 people with two-line roles) the grid overflows the bottom of the
 * slide. This runtime measures that overflow and uniformly scales the grid down
 * with a transform so the photos AND text shrink just enough to fit — the grid
 * box is flex:1 (already the available height), so scaling its content to fit
 * the box keeps everything inside the slide.
 *
 * Skipped in thumbnail mode (tiny render sizes make measurement noisy). Re-runs
 * on resize / content changes (e.g. while typing in the editor preview).
 */

const SELECTOR = '.slide-team-cards';

// Never shrink below this — past it the content is genuinely too much and a
// clean, slightly-clipped layout beats microscopic text.
const MIN_SCALE = 0.5;

const isMeasurable = (el) =>
  !!el && el.clientHeight > 0 && el.clientWidth > 0;

// The flexible content area that should scale: the split-container when the
// slide uses the two-group column split, otherwise the single cards grid.
const findFitTarget = (slide) =>
  slide.querySelector(':scope > .slide-inner > .team-cards-split-container') ||
  slide.querySelector(':scope > .slide-inner > .team-cards-grid') ||
  null;

// Content height of the flexible area, measured from the cards themselves.
// offsetTop/offsetHeight are layout metrics (unaffected by our transform), and
// spanning min-top → max-bottom captures overflow in BOTH directions — which
// scrollHeight misses when align-content:center pushes rows above the box top.
const contentSpan = (target) => {
  const cards = target.querySelectorAll('.team-card');
  if (!cards.length) return target.scrollHeight;
  let minTop = Infinity;
  let maxBottom = -Infinity;
  for (const c of cards) {
    const top = c.offsetTop;
    const bottom = top + c.offsetHeight;
    if (top < minTop) minTop = top;
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom - minTop;
};

const measureSlide = (slide) => {
  if (!isMeasurable(slide)) return;
  const target = findFitTarget(slide);
  if (!target) return;

  // Measure unscaled. Transforms don't affect layout metrics, so the result is
  // stable regardless of the current scale — no reset, no oscillation.
  const avail = target.clientHeight;
  const needed = contentSpan(target);
  if (avail <= 0) return;

  let scale = 1;
  if (needed > avail + 1) {
    scale = Math.max(MIN_SCALE, avail / needed);
  }

  if (scale >= 0.999) {
    // Clear any previous scaling.
    if (target.style.transform) target.style.transform = '';
    return;
  }

  // transform-origin is set in CSS so it matches the grid's alignment (left for
  // filled grids, center for small centered groups) — scaling then keeps the
  // grid anchored to the title edge instead of drifting inward.
  target.style.transform = `scale(${scale.toFixed(4)})`;
};

/**
 * Initialize team-cards auto-fit on a root element. Returns a cleanup function.
 * @param {HTMLElement} rootEl
 * @returns {() => void}
 */
export function initTeamCardsAutoFit(rootEl) {
  if (!rootEl) return () => {};
  const slides = rootEl.matches?.(SELECTOR)
    ? [rootEl]
    : Array.from(rootEl.querySelectorAll?.(SELECTOR) || []);
  if (!slides.length) return () => {};

  const observers = [];

  for (const slide of slides) {
    const target = findFitTarget(slide);
    if (!target) continue;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measureSlide(slide);
      });
    };

    // Initial measurement — wait one frame so layout has settled (widths in
    // preview/thumb containers are set by JS).
    schedule();

    try {
      const ro = new ResizeObserver(schedule);
      ro.observe(slide);
      ro.observe(target);
      observers.push({ ro, cancel: () => raf && cancelAnimationFrame(raf) });
    } catch {
      // ResizeObserver unavailable — the one-shot measurement still helps.
    }
  }

  return () => {
    for (const entry of observers) {
      try {
        entry.ro.disconnect();
      } catch {
        // ignore
      }
      try {
        entry.cancel?.();
      } catch {
        // ignore
      }
    }
    observers.length = 0;
  };
}
