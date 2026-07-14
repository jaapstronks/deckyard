/**
 * Timeline slide runtime — auto-fits long titles.
 *
 * A timeline never gains an extra row, so cards have vertical headroom above
 * and below the track: a title wrapping to two or three lines is fine and reads
 * far better than one shrunk to fit a single line. So rather than forcing every
 * title onto one line, we allow up to --timeline-title-max-lines (default 3) at
 * the full --timeline-title-max-px size, and only step the font down (toward
 * --timeline-title-min-px) for titles that still exceed that line budget — after
 * which the CSS `overflow-wrap: break-word` takes over.
 */

const MIN_PX_DEFAULT = 16;
const MAX_PX_DEFAULT = 20;
const MAX_LINES_DEFAULT = 3;

function readPx(el, varName, fallback) {
  const raw = getComputedStyle(el).getPropertyValue(varName).trim();
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function fitTitle(titleEl) {
  const maxPx = readPx(titleEl, '--timeline-title-max-px', MAX_PX_DEFAULT);
  const minPx = readPx(titleEl, '--timeline-title-min-px', MIN_PX_DEFAULT);
  const maxLines = Math.max(
    1,
    readPx(titleEl, '--timeline-title-max-lines', MAX_LINES_DEFAULT)
  );

  // The height budget is maxLines worth of line-boxes, with a small multiplier
  // for sub-pixel rounding. A title that fits inside it at the ceiling size
  // keeps that size, wraps and all.
  const budgetH = (lh) => lh * maxLines * 1.1;

  titleEl.style.fontSize = `${maxPx}px`;
  const lineHeight = parseFloat(getComputedStyle(titleEl).lineHeight) || maxPx * 1.15;
  if (titleEl.scrollHeight <= budgetH(lineHeight)) return;

  for (let px = maxPx - 1; px >= minPx; px--) {
    titleEl.style.fontSize = `${px}px`;
    const lh = parseFloat(getComputedStyle(titleEl).lineHeight) || px * 1.15;
    if (titleEl.scrollHeight <= budgetH(lh)) return;
  }
  // Hit the floor — CSS break-word will wrap whatever remains.
}

export function initTimelineSlides(rootEl) {
  if (!rootEl?.querySelectorAll) return () => {};

  const selector = '.slide-timeline';
  const slides = [
    ...(rootEl.matches?.(selector) ? [rootEl] : []),
    ...Array.from(rootEl.querySelectorAll(selector)),
  ];
  if (!slides.length) return () => {};

  const titles = [];
  for (const slide of slides) {
    for (const t of slide.querySelectorAll('.timeline-title')) titles.push(t);
  }
  if (!titles.length) return () => {};

  for (const t of titles) fitTitle(t);

  // Re-fit on container size changes (responsive viewport, sidebar toggles, etc).
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    let raf = 0;
    ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        for (const t of titles) fitTitle(t);
      });
    });
    for (const slide of slides) ro.observe(slide);
  }

  return () => {
    try { ro?.disconnect(); } catch {}
  };
}
