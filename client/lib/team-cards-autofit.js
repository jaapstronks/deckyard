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
 * For `imageAspect: original` (uncropped, non-split) slides it additionally
 * runs a justified-rows pass first (see justifyOriginal below) that sizes each
 * image so its row fills the slide width, then applies the same overflow scale.
 *
 * Skipped in thumbnail mode (tiny render sizes make measurement noisy). Re-runs
 * on resize / content changes (e.g. while typing in the editor preview) and
 * once images decode (the justify pass needs their intrinsic aspect ratios).
 */

const SELECTOR = '.slide-team-cards';

// Never shrink below this — past it the content is genuinely too much and a
// clean, slightly-clipped layout beats microscopic text.
const MIN_SCALE = 0.5;

const isMeasurable = (el) =>
  !!el && el.clientHeight > 0 && el.clientWidth > 0;

// ---------------------------------------------------------------------------
// Justified rows for `imageAspect: original` (uncropped, non-split).
//
// The CSS lays uncropped images out as wrapping flex rows at one shared height
// (see 45-team-cards.css). That already hugs captions to their image (gap 1)
// and keeps text uniformly magnified (gap 3), but a few wide screenshots at a
// fixed height overflow the row and wrap awkwardly (one wide image alone on
// top, the rest below) instead of filling the slide (gap 2). This pass packs
// the images into rows greedily and picks each row's height so its images span
// the full width — a "justified gallery". Purely a JS enhancement: without it
// (static/no-JS render) the CSS shared-height fallback still looks correct,
// just less optimally filled.
// ---------------------------------------------------------------------------

const isOriginalJustifiable = (slide) =>
  slide.classList.contains('aspect-original') &&
  !slide.classList.contains('has-column-split');

// Intrinsic aspect ratio (w/h) of a card's image, or null if not yet loaded.
const cardAspect = (card) => {
  const img = card.querySelector('.team-card-photo img');
  if (!img) return 1; // empty placeholder — treat as square
  if (!img.naturalWidth || !img.naturalHeight) return null;
  return img.naturalWidth / img.naturalHeight;
};

// Compute and apply per-row image heights so each row fills the grid width.
// Returns true if heights were applied, false if it bailed (images still
// loading — the CSS fallback stands and a load listener re-runs us).
const justifyOriginal = (slide) => {
  const grid = slide.querySelector(':scope > .slide-inner > .team-cards-grid');
  if (!grid) return false;
  const cards = Array.from(grid.querySelectorAll(':scope > .team-card'));
  if (!cards.length) return false;

  const aspects = cards.map(cardAspect);
  if (aspects.some((a) => a === null)) return false; // wait for images

  const styles = getComputedStyle(grid);
  const gap = parseFloat(styles.columnGap) || 0;
  // Max height = the CSS shared height (a small boost over --team-card-photo).
  const maxH = parseFloat(styles.getPropertyValue('--team-orig-photo-h')) || 300;
  // Subtract 1px so rounding never pushes a justified row one image too wide,
  // which would make flexbox wrap it and desync from our packing.
  const avail = grid.clientWidth - 1;
  if (avail <= 0) return false;

  // Greedy row packing: grow a row until justifying it to the full width would
  // drop its height to/under maxH; then close it. The last, partial row is
  // left at maxH (never stretched to fill) so a lone trailing image stays sane.
  const rows = [];
  let row = [];
  let sumAspect = 0;
  for (let i = 0; i < cards.length; i++) {
    row.push({ card: cards[i], aspect: aspects[i] });
    sumAspect += aspects[i];
    const rowH = (avail - gap * (row.length - 1)) / sumAspect;
    if (rowH <= maxH) {
      rows.push({ cards: row, h: rowH });
      row = [];
      sumAspect = 0;
    }
  }
  if (row.length) {
    const rowH = Math.min(maxH, (avail - gap * (row.length - 1)) / sumAspect);
    rows.push({ cards: row, h: rowH });
  }

  for (const r of rows) {
    for (const { card, aspect } of r.cards) {
      const photo = card.querySelector('.team-card-photo');
      if (photo) photo.style.height = `${r.h.toFixed(2)}px`;
      // Pin the card to the rendered image width so (a) a long caption wraps to
      // the image width instead of widening the card past its image (which
      // would also desync this packing from where flexbox actually wraps), and
      // (b) captions stay hugged to the image edges.
      card.style.width = `${Math.floor(r.h * aspect)}px`;
    }
  }
  return true;
};

// Remove any inline sizing (e.g. slide switched away from original).
const clearJustify = (slide) => {
  for (const p of slide.querySelectorAll('.team-card-photo[style*="height"]')) {
    p.style.height = '';
  }
  for (const c of slide.querySelectorAll('.team-card[style*="width"]')) {
    c.style.width = '';
  }
};

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

  // Justify uncropped rows first (mutates layout via inline photo heights), so
  // the overflow measurement below sees the final, filled arrangement.
  if (isOriginalJustifiable(slide)) justifyOriginal(slide);
  else clearJustify(slide);

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

    // Re-run once images decode: the original-aspect justify pass needs each
    // image's intrinsic aspect ratio, which isn't known until it loads.
    const imgListeners = [];
    if (isOriginalJustifiable(slide)) {
      for (const img of slide.querySelectorAll('.team-card-photo img')) {
        if (img.complete && img.naturalWidth) continue;
        const onLoad = () => schedule();
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onLoad);
        imgListeners.push({ img, onLoad });
      }
    }

    try {
      const ro = new ResizeObserver(schedule);
      ro.observe(slide);
      ro.observe(target);
      observers.push({
        ro,
        cancel: () => {
          if (raf) cancelAnimationFrame(raf);
          for (const { img, onLoad } of imgListeners) {
            img.removeEventListener('load', onLoad);
            img.removeEventListener('error', onLoad);
          }
        },
      });
    } catch {
      // ResizeObserver unavailable — the one-shot measurement still helps.
      for (const { img, onLoad } of imgListeners) {
        img.removeEventListener('load', onLoad);
        img.removeEventListener('error', onLoad);
      }
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
