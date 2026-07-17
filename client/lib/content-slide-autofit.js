/**
 * Text-slide auto-fit runtime.
 *
 * Content-slides start at their density's largest size and step DOWN through
 * size classes until the body fits, so text never spills into a cut-off extra
 * column or below the slide:
 *   - `data-density="auto"`       large → `is-fit-medium` → `is-compact` (small)
 *   - `data-density="comfortable"` (Large) large → `is-fit-medium`, floored at
 *     medium so it stays clearly bigger than the small size even if a little
 *     content has to clip.
 *   - `data-density="compact"` (Small) is forced small at render time and not
 *     measured here.
 *
 * Image-text-slides keep the simpler two-step behavior (comfortable ↔
 * `is-compact`); with two text columns (`is-text-cols-2`) overflow flows
 * sideways like on the content slide, so the check switches to scrollWidth.
 * Re-runs whenever the slide or its body change size (e.g. while typing in
 * the editor preview).
 */

const SELECTOR =
  '.slide-content[data-density="auto"], .slide-content[data-density="comfortable"], .slide-image-text[data-density="auto"]';

const isMeasurable = (el) => {
  if (!el) return false;
  // Skip elements that aren't laid out yet (offscreen, display:none, etc.).
  return el.clientHeight > 0 && el.clientWidth > 0;
};

// Locate the body element for the slide variant. Returns { body, container }
// where `container` is the element whose available height limits the body.
const findBodyAndContainer = (slide) => {
  if (slide.classList.contains('slide-content')) {
    const inner = slide.querySelector(':scope > .slide-inner');
    const body = inner?.querySelector(':scope > .body') || null;
    return { body, container: inner };
  }
  if (slide.classList.contains('slide-image-text')) {
    const copy = slide.querySelector(
      ':scope > .slide-inner > .split > .copy'
    );
    const body = copy?.querySelector(':scope > .body') || null;
    return { body, container: copy };
  }
  return { body: null, container: null };
};

// Sum of child block heights + their vertical margins. Works for multi-column
// bodies where scrollHeight stays equal to clientHeight because spillover
// flows into extra columns to the side instead of growing the box.
const naturalContentHeight = (el) => {
  let total = 0;
  let prevMb = 0;
  const children = el.children;
  for (let i = 0; i < children.length; i += 1) {
    const c = children[i];
    const cs = getComputedStyle(c);
    const mt = parseFloat(cs.marginTop) || 0;
    const mb = parseFloat(cs.marginBottom) || 0;
    // Approximate margin collapsing between adjacent siblings.
    total += Math.max(prevMb, mt) + c.offsetHeight;
    prevMb = mb;
  }
  return total + prevMb;
};

// Content-slide overflow: the body is multi-column (columns: 2) in two-column
// layout, so a vertical scrollHeight check misses spillover — extra content
// flows sideways into a cut-off column instead, growing scrollWidth. Check
// both axes plus the container (heading/actions can push the body).
const contentOverflows = (body, container) =>
  body.scrollWidth > body.clientWidth + 1 ||
  body.scrollHeight > body.clientHeight + 1 ||
  container.scrollHeight > container.clientHeight + 1;

// Content-slide: step down from the largest size until it fits. Always start
// from the largest (strip the fit classes) so the decision is stable and
// doesn't oscillate.
const measureContentSlide = (slide) => {
  const { body, container } = findBodyAndContainer(slide);
  if (!body || !container) return;
  const density = slide.getAttribute('data-density');

  slide.classList.remove('is-compact', 'is-fit-medium');
  if (!contentOverflows(body, container)) return; // largest size fits

  slide.classList.add('is-fit-medium');
  if (!contentOverflows(body, container)) return; // medium fits

  // 'comfortable' (Large) is floored at medium so it stays clearly larger than
  // the small size; a little clipping (guarded by overflow:hidden in CSS) beats
  // shrinking it down to the small size. 'auto' may go all the way to small.
  if (density === 'comfortable') return;
  slide.classList.remove('is-fit-medium');
  slide.classList.add('is-compact');
};

// Image-text-slide: single-column copy, comfortable ↔ compact toggle.
const measureImageTextSlide = (slide) => {
  const { body, container } = findBodyAndContainer(slide);
  if (!body || !container) return;

  // Always evaluate in the comfortable state so the decision is stable: if we
  // measured while already compact we'd typically see "fits" and flip back,
  // re-overflow, and oscillate.
  const wasCompact = slide.classList.contains('is-compact');
  if (wasCompact) slide.classList.remove('is-compact');

  // Allow >1px slack to absorb sub-pixel rounding. With two text columns the
  // body is multi-column: spillover flows sideways into a cut-off extra
  // column (scrollWidth grows), and summing child block heights would
  // over-report by design, so that check is skipped there.
  const multiCol = slide.classList.contains('is-text-cols-2');
  const overflow =
    body.scrollHeight > body.clientHeight + 1 ||
    container.scrollHeight > container.clientHeight + 1 ||
    (multiCol
      ? body.scrollWidth > body.clientWidth + 1
      : naturalContentHeight(body) > body.clientHeight + 1);

  if (overflow) slide.classList.add('is-compact');
};

const measureSlide = (slide) => {
  if (!isMeasurable(slide)) return;
  if (slide.classList.contains('slide-content')) measureContentSlide(slide);
  else measureImageTextSlide(slide);
};

/**
 * Initialize auto-fit on a root element. Returns a cleanup function.
 */
export function initContentSlideAutoFit(rootEl) {
  if (!rootEl) return () => {};
  const slides = rootEl.matches?.(SELECTOR)
    ? [rootEl]
    : Array.from(rootEl.querySelectorAll?.(SELECTOR) || []);
  if (!slides.length) return () => {};

  const observers = [];

  for (const slide of slides) {
    const { body } = findBodyAndContainer(slide);
    if (!body) continue;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measureSlide(slide);
      });
    };

    // Initial measurement — wait one frame so layout has a chance to settle
    // (important in thumb/preview containers where width is set by JS).
    schedule();

    try {
      const ro = new ResizeObserver(schedule);
      ro.observe(slide);
      ro.observe(body);
      observers.push({ ro, cancel: () => raf && cancelAnimationFrame(raf) });
    } catch {
      // ResizeObserver unavailable — one-shot measurement is still useful.
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
