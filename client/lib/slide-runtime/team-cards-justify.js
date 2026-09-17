/**
 * Justified rows for uncropped image blocks. One CSS ceiling bounds each row;
 * the slide's available content height bounds the complete packing.
 *
 * The script chain inlines this module into export documents, so it must keep
 * no imports and exactly one export. All measurements use logical slide pixels
 * so thumbnails and full-size slides share the same layout.
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

// Read the resolved CSS length, not an unregistered custom property's calc().
const rowCeiling = (cards) => {
  for (const card of cards) {
    const photo = cardPhoto(card);
    if (!photo) continue;
    const ceiling = parseFloat(getComputedStyle(photo).maxHeight);
    if (Number.isFinite(ceiling) && ceiling > 0) return ceiling;
  }
  return null;
};

// The grid can grow past the slide edge, so only its parent's fixed content
// box is a valid budget. Auto margins on the bottom subheading are free space.
const availableHeight = (grid, scale) => {
  const inner = grid.parentElement;
  if (!inner) return null;
  const styles = getComputedStyle(inner);
  const inset = [
    'borderTopWidth',
    'borderBottomWidth',
    'paddingTop',
    'paddingBottom',
  ].reduce((sum, key) => sum + (parseFloat(styles[key]) || 0), 0);
  const box = logicalHeight(inner, scale) - inset;
  if (!(box > 0)) return null;
  const gap = parseFloat(styles.rowGap) || 0;
  let taken = 0;
  let siblings = 0;
  for (const child of inner.children) {
    if (child === grid) continue;
    taken += logicalHeight(child, scale);
    siblings += 1;
  }
  const avail = box - taken - gap * siblings;
  return Math.max(0, avail);
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
      partial: true,
    });
  }
  return rows;
};

// Heights are emitted to CSS in hundredths of a logical pixel. Search that
// same finite domain; screen/thumbnail scale never changes its precision.
const HEIGHT_PRECISION = 100;
const heightTicks = (height) => Math.ceil(height * HEIGHT_PRECISION - 1e-7);
const cardWidth = (height, aspect) => Math.floor(height * aspect + 1e-7);

// Between these boundaries the row membership and every integer card width
// stay fixed. Only the partial last row's photo height changes; caption
// wrapping and the heights of all completed rows remain unchanged.
const intervalFloor = (rows, aspects, cap) => {
  let floor = 1;
  for (const row of rows) {
    if (!row.partial) {
      floor = Math.max(floor, heightTicks(row.height));
      continue;
    }
    for (let i = row.start; i <= row.end; i += 1) {
      floor = Math.max(
        floor,
        heightTicks(cardWidth(cap, aspects[i]) / aspects[i]),
      );
    }
  }
  return floor;
};

// The predicate is monotone only inside one fixed-width, fixed-partition
// interval. Never carry a bisection across a text wrap or row boundary.
const highestFit = (low, high, limit, measure) => {
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(middle) <= limit) low = middle;
    else high = middle - 1;
  }
  return low;
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
      const width = cardWidth(r.height, aspects[i]);
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
  const scale = slideScale(slide);
  const height = availableHeight(grid, scale);
  if (height === null) return false;

  const isSplit = slide.classList.contains('text-split');

  const measure = (ticks) => {
    const rows = packRows(aspects, ticks / HEIGHT_PRECISION, width, gap);
    applyPacking(cards, aspects, rows, isSplit, scale);
    return packedHeight(cards, rows, rowGap, scale);
  };

  let fallback = null;
  let fits = false;
  let upper = Math.floor(maxH * HEIGHT_PRECISION);
  while (upper >= 1) {
    const cap = upper / HEIGHT_PRECISION;
    const rows = packRows(aspects, cap, width, gap);
    const lower = Math.min(upper, intervalFloor(rows, aspects, cap));
    const top = measure(upper);
    if (top <= height) {
      fits = true;
      break;
    }

    const bottom = lower === upper ? top : measure(lower);
    if (bottom <= height) {
      measure(highestFit(lower, upper, height, measure));
      fits = true;
      break;
    }
    if (!fallback || bottom < fallback.total) {
      fallback = { lower, upper, total: bottom };
    }
    upper = lower - 1;
  }

  // Every interval failed. Keep the least overflow, breaking ties toward the
  // largest ceiling, and keep the heading clear by overflowing downward.
  if (!fits && fallback) {
    measure(
      highestFit(fallback.lower, fallback.upper, fallback.total, measure),
    );
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
    let detached = false;
    const schedule = () => {
      if (detached || raf) return;
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

    // Card fonts may finish after the heading has already settled, so heading
    // observation alone cannot detect a changed caption wrap.
    const fonts = slide.ownerDocument.fonts;
    fonts?.ready.then(schedule);
    fonts?.addEventListener('loadingdone', schedule);

    let ro;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(schedule);
      ro.observe(slide);
      // The grid is sized by this pass, so observing it would feed our own
      // output back in; the slide box and the heading above the grid are what
      // change the available height.
      const inner = grid.parentElement;
      for (const child of inner ? inner.children : []) {
        if (child !== grid) ro.observe(child);
      }
    }
    observers.push({
      ro,
      cancel: () => {
        detached = true;
        if (raf) cancelAnimationFrame(raf);
        fonts?.removeEventListener('loadingdone', schedule);
        for (const { img, onLoad } of imgListeners) {
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onLoad);
        }
      },
    });
  }

  return () => {
    for (const entry of observers) {
      // This export-inlined module cannot import the app's disposal helper.
      for (const detach of [() => entry.ro?.disconnect(), entry.cancel]) {
        try {
          detach();
        } catch (error) {
          console.warn('[team-cards] Failed to detach layout observer', error);
        }
      }
    }
    observers.length = 0;
  };
}
