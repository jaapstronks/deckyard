/**
 * Team-cards (image-blocks) justified-rows runtime.
 *
 * For `imageAspect: original` (uncropped, non-split) slides the CSS lays the
 * images out as wrapping flex rows at one shared height (see 45-team-cards.css).
 * That already hugs captions to their image and keeps text uniformly magnified,
 * but a few wide screenshots at a fixed height overflow the row and wrap
 * awkwardly (one wide image alone on top, the rest below) instead of filling the
 * slide. This pass packs the images into rows greedily and picks each row's
 * height so its images span the full width — a "justified gallery".
 *
 * Two bounds decide the packing (D167):
 *
 *  1. The **declared CSS ceiling** bounds one row's photo height. It is read
 *     from the resolved `max-height` of the photo box, which is the stylesheet's
 *     own number — not a fallback constant maintaining a second ceiling.
 *  2. The **available content height** under the heading bounds all rows
 *     together. The pass picks the largest ceiling that still fits, re-packing
 *     the cards rather than scaling them down afterwards.
 *
 * The server renders run it too: `server/utils/script-chain.js` inlines this
 * file into every document with such a slide, so it must keep no imports and
 * exactly one export. Without it the CSS shared-height fallback wraps a few
 * landscape images into a grid that covers the title.
 * Background and rationale: docs/reference/team-cards-original-aspect.md.
 *
 * Runs in every mode, thumbnails included: a thumbnail is the same logical
 * slide box at a smaller scale, so a thumbnail that fell back to the CSS shared
 * height showed a different packing than the slide it stands for. Every
 * measurement below therefore reads layout values (`clientHeight`,
 * `offsetHeight`), which a thumbnail's transform leaves alone. Re-runs on
 * resize / content changes (e.g. while typing in the editor preview) and once
 * images decode (the pass needs their intrinsic aspect ratios).
 */

const SELECTOR = '.slide-team-cards';

const isMeasurable = (el) => !!el && el.clientHeight > 0 && el.clientWidth > 0;

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

const findGrid = (slide) =>
  slide.querySelector(':scope > .slide-inner > .team-cards-grid') || null;

const cardPhoto = (card) => card.querySelector('.team-card-photo');
const cardTitle = (card) => card.querySelector('.team-card-name');

/**
 * How many rendered pixels one logical slide pixel is worth. A thumbnail is the
 * logical slide under a `transform: scale(…)`, so a rectangle read off it has to
 * be divided by this to be a slide measurement again.
 *
 * @param {HTMLElement} slide
 * @returns {number}
 */
const slideScale = (slide) => {
  const rendered = slide.getBoundingClientRect().width;
  const logical = slide.offsetWidth;
  return logical > 0 && rendered > 0 ? rendered / logical : 1;
};

/**
 * An element's height in logical slide pixels, sub-pixels included.
 *
 * `offsetHeight` would be simpler but it rounds, and a row levelled on a rounded
 * height still starts its images a pixel apart when one title is 134.4 tall and
 * its neighbour 134.1.
 *
 * @param {HTMLElement} el
 * @param {number} scale
 * @returns {number}
 */
const logicalHeight = (el, scale) => el.getBoundingClientRect().height / scale;

/**
 * The row ceiling, read from the CSS declaration itself: `max-height` on the
 * photo box resolves the `calc()` chain to pixels, so the runtime packs against
 * the height the stylesheet actually asks for. (`--team-orig-photo-h` is an
 * unregistered custom property: reading it hands back the literal `calc(...)`
 * text, which is not a number — which is how the old `|| 300` fallback became
 * the real, hidden ceiling.)
 *
 * @param {HTMLElement[]} cards
 * @returns {number|null} Pixels, or null when nothing is measurable yet.
 */
const rowCeiling = (cards) => {
  for (const card of cards) {
    const photo = cardPhoto(card);
    if (!photo) continue;
    const ceiling = parseFloat(getComputedStyle(photo).maxHeight);
    if (Number.isFinite(ceiling) && ceiling > 0) return ceiling;
  }
  return null;
};

/**
 * The content height the rows have to fit in: the slide's inner box minus
 * everything that is not the grid (heading, bottom subheading) and the flex
 * gaps between them.
 *
 * Deliberately *not* the grid's own height. `.team-cards-grid` is a flex item
 * that its content can push past the slide edge, so measuring it would hand the
 * packing back the very overflow it is meant to prevent (the reported grid ran
 * to y=947 in a 900px slide). `.slide-inner` is `height: 100%` of the slide's
 * content box, so it stays put whatever the cards do.
 *
 * @param {HTMLElement} grid
 * @returns {number|null} Pixels, or null when nothing is measurable yet.
 */
const availableHeight = (grid) => {
  const inner = grid.parentElement;
  if (!inner) return null;
  const box = inner.clientHeight;
  if (!(box > 0)) return null;
  const gap = parseFloat(getComputedStyle(inner).rowGap) || 0;
  let taken = 0;
  let siblings = 0;
  for (const child of inner.children) {
    if (child === grid) continue;
    // offsetHeight only: `.bottom-subheading` is pushed down by `margin-top:
    // auto`, and that leftover is space the grid may use, not space it loses.
    taken += child.offsetHeight;
    siblings += 1;
  }
  const avail = box - taken - gap * siblings;
  return avail > 0 ? avail : null;
};

/**
 * Greedy row packing at one ceiling: grow a row until justifying it to the full
 * width would drop its height to/under `cap`, then close it. The last, partial
 * row is left at `cap` (never stretched to fill) so a lone trailing image stays
 * sane.
 *
 * @param {number[]} aspects
 * @param {number} cap Ceiling for one row's photo height, in px.
 * @param {number} width Usable grid width, in px.
 * @param {number} gap Column gap, in px.
 * @returns {{start: number, end: number, height: number}[]}
 */
const packRows = (aspects, cap, width, gap) => {
  const rows = [];
  let start = 0;
  let sumAspect = 0;
  for (let i = 0; i < aspects.length; i += 1) {
    sumAspect += aspects[i];
    const height = (width - gap * (i - start)) / sumAspect;
    if (height <= cap) {
      rows.push({ start, end: i, height });
      start = i + 1;
      sumAspect = 0;
    }
  }
  if (start < aspects.length) {
    const height = (width - gap * (aspects.length - 1 - start)) / sumAspect;
    rows.push({
      start,
      end: aspects.length - 1,
      height: Math.min(cap, height),
    });
  }
  return rows;
};

/**
 * Every ceiling at which the packing above can change: the justified height of
 * each contiguous run of cards, plus the declared ceiling itself. Descending, so
 * a caller walking the list meets the largest photo height first.
 *
 * Enumerated rather than searched: a lower ceiling re-packs the rows and can
 * rewrap the captions, so the total height is not monotonic in the ceiling and
 * a bisection could step over the answer.
 *
 * @param {number[]} aspects
 * @param {number} maxH
 * @param {number} width
 * @param {number} gap
 * @returns {number[]}
 */
const candidateCeilings = (aspects, maxH, width, gap) => {
  const caps = new Set([maxH]);
  for (let i = 0; i < aspects.length; i += 1) {
    let sumAspect = 0;
    for (let j = i; j < aspects.length; j += 1) {
      sumAspect += aspects[j];
      const height = (width - gap * (j - i)) / sumAspect;
      if (height > 0 && height < maxH) caps.add(Math.round(height * 100) / 100);
    }
  }
  return Array.from(caps).sort((a, b) => b - a);
};

/**
 * Give every card in a row the same title height, so the images below them
 * start on one line. Titles wrap to the card width, so this runs after the
 * widths are pinned; clearing first keeps a re-run from growing monotonically.
 *
 * @param {HTMLElement[]} cards
 * @param {{start: number, end: number}[]} rows
 * @param {number} scale
 */
const shareTitleHeight = (cards, rows, scale) => {
  for (const r of rows) {
    if (r.end - r.start < 1) continue;
    const titles = [];
    for (let i = r.start; i <= r.end; i += 1) {
      const title = cardTitle(cards[i]);
      if (title) titles.push(title);
    }
    if (titles.length < 2) continue;
    const tallest = Math.max(...titles.map((t) => logicalHeight(t, scale)));
    if (!Number.isFinite(tallest) || tallest <= 0) continue;
    for (const title of titles)
      title.style.minHeight = `${tallest.toFixed(2)}px`;
  }
};

/**
 * Size the cards for one packing. Widths are pinned to the rendered image width
 * so (a) a long caption wraps to the image width instead of widening the card
 * past its image (which would also desync this packing from where flexbox
 * actually wraps), and (b) captions stay hugged to the image edges.
 *
 * @param {HTMLElement[]} cards
 * @param {number[]} aspects
 * @param {{start: number, end: number, height: number}[]} rows
 * @param {boolean} isSplit
 * @param {number} scale
 */
const applyPacking = (cards, aspects, rows, isSplit, scale) => {
  for (const card of cards) {
    const title = cardTitle(card);
    if (title) title.style.minHeight = '';
  }
  for (const r of rows) {
    for (let i = r.start; i <= r.end; i += 1) {
      const width = Math.floor(r.height * aspects[i]);
      const photo = cardPhoto(cards[i]);
      if (photo) {
        photo.style.height = `${r.height.toFixed(2)}px`;
        // An empty placeholder has no image to give it a width, and its CSS
        // width is the declared ceiling — which would keep a card at full size
        // in a row this pass just made shorter.
        if (photo.classList.contains('is-empty'))
          photo.style.width = `${width}px`;
      }
      cards[i].style.width = `${width}px`;
    }
  }
  if (isSplit) shareTitleHeight(cards, rows, scale);
};

/**
 * Height of the applied packing: the tallest card per row plus the row gaps.
 * Measured from the DOM, so it includes the wrapped title and byline.
 *
 * @param {HTMLElement[]} cards
 * @param {{start: number, end: number}[]} rows
 * @param {number} rowGap
 * @param {number} scale
 * @returns {number}
 */
const packedHeight = (cards, rows, rowGap, scale) => {
  let total = 0;
  for (const r of rows) {
    let tallest = 0;
    for (let i = r.start; i <= r.end; i += 1) {
      tallest = Math.max(tallest, logicalHeight(cards[i], scale));
    }
    total += tallest;
  }
  return total + rowGap * Math.max(0, rows.length - 1);
};

/**
 * Compute and apply per-row image heights so each row fills the grid width and
 * all rows together fit the content height.
 *
 * @param {HTMLElement} slide
 * @returns {boolean} False when it bailed (images still loading, or nothing
 *   measurable yet) — the CSS fallback stands and a listener re-runs us.
 */
const justifyOriginal = (slide) => {
  const grid = findGrid(slide);
  if (!grid) return false;
  const cards = Array.from(grid.querySelectorAll(':scope > .team-card'));
  if (!cards.length) return false;

  const aspects = cards.map(cardAspect);
  if (aspects.some((a) => a === null)) return false; // wait for images

  const styles = getComputedStyle(grid);
  const gap = parseFloat(styles.columnGap) || 0;
  const rowGap = parseFloat(styles.rowGap) || 0;
  const maxH = rowCeiling(cards);
  if (maxH === null) return false; // nothing measurable yet — wait
  // Subtract 1px so rounding never pushes a justified row one image too wide,
  // which would make flexbox wrap it and desync from our packing.
  const width = grid.clientWidth - 1;
  if (width <= 0) return false;
  const height = availableHeight(grid);
  if (height === null) return false;

  const isSplit = slide.classList.contains('text-split');
  const scale = slideScale(slide);

  // Distinct packings, largest ceiling first. Two ceilings that pack the cards
  // the same way are measured once.
  const packings = [];
  const seen = new Set();
  for (const cap of candidateCeilings(aspects, maxH, width, gap)) {
    const rows = packRows(aspects, cap, width, gap);
    const key = rows.map((r) => `${r.end}:${r.height.toFixed(2)}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    packings.push(rows);
  }

  // The largest photo height whose rows fit. Not a bisection: a lower ceiling
  // re-packs the rows and can rewrap the captions, so a taller candidate that
  // overflows says nothing about a shorter one.
  let fallback = null;
  let fits = false;
  for (const rows of packings) {
    applyPacking(cards, aspects, rows, isSplit, scale);
    const total = packedHeight(cards, rows, rowGap, scale);
    if (total <= height) {
      fits = true;
      break;
    }
    if (!fallback || total < fallback.total) fallback = { rows, total };
  }

  // Nothing fits: the text itself is taller than the slide. Keep the least
  // overflowing packing and let it run off the bottom edge — the heading stays
  // clear, because the grid centres its rows by default and would otherwise
  // spill upwards over it.
  if (!fits && fallback) {
    applyPacking(cards, aspects, fallback.rows, isSplit, scale);
  }
  grid.style.alignContent = fits ? '' : 'flex-start';
  return true;
};

// Remove any inline sizing (e.g. slide switched away from original).
const clearJustify = (slide) => {
  for (const p of slide.querySelectorAll('.team-card-photo[style*="height"]')) {
    p.style.height = '';
    p.style.width = '';
  }
  for (const c of slide.querySelectorAll('.team-card[style*="width"]')) {
    c.style.width = '';
  }
  for (const t of slide.querySelectorAll(
    '.team-card-name[style*="min-height"]',
  )) {
    t.style.minHeight = '';
  }
  const grid = findGrid(slide);
  if (grid) grid.style.alignContent = '';
};

const measureSlide = (slide) => {
  if (!isMeasurable(slide)) return;
  if (isOriginalJustifiable(slide)) justifyOriginal(slide);
  else clearJustify(slide);
};

/**
 * Initialize the team-cards justify pass on a root element. Returns a cleanup
 * function.
 * @param {HTMLElement} rootEl
 * @returns {() => void}
 */
export function initTeamCardsJustify(rootEl) {
  if (!rootEl) return () => {};
  const slides = rootEl.matches?.(SELECTOR)
    ? [rootEl]
    : Array.from(rootEl.querySelectorAll?.(SELECTOR) || []);
  if (!slides.length) return () => {};

  const observers = [];

  for (const slide of slides) {
    const grid = findGrid(slide);
    if (!grid) continue;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measureSlide(slide);
      });
    };

    // Initial pass — wait one frame so layout has settled (widths in
    // preview/thumb containers are set by JS).
    schedule();

    // Re-run once images decode: the pass needs each image's intrinsic aspect
    // ratio, which isn't known until it loads.
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
      // The grid is sized by this pass, so observing it would feed our own
      // output back in; the slide box and the heading above the grid are what
      // change the available height.
      const inner = grid.parentElement;
      for (const child of inner ? inner.children : []) {
        if (child !== grid) ro.observe(child);
      }
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
      // ResizeObserver unavailable — the one-shot pass still helps.
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
