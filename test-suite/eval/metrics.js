/**
 * Deterministic metrics over a generated deck. No model calls, so these run
 * in --dry-run and cost nothing.
 */

/** Content keys that carry a slide's heading rather than its body. */
const TITLE_KEYS = new Set(['title', 'heading', 'tagline']);

/**
 * Configuration words. A key counts as configuration if it contains any of
 * these, case-insensitively.
 *
 * Matching on substrings rather than exact names is deliberate: several slide
 * types use flat numbered keys (`row1Color`, `arrow1`, `row2Enabled`,
 * `card3Icon`) rather than nested objects. An exact-name blocklist misses
 * those, and their values ("yellow", "down", "yes") then read as slide prose --
 * which made the judge penalize decks for text no audience ever sees.
 */
const CONFIG_KEY_PATTERN =
  /(^|[a-z0-9])(background|layout|variant|density|icon|colou?r|arrow|image|url|src|alt|logo|theme|tone|align|direction|enabled|count|size|width|height|position|style|id|type)([A-Z0-9]|$)/i;

/**
 * @param {string} key
 * @returns {boolean} true when the key holds configuration rather than text
 */
function isConfigKey(key) {
  return CONFIG_KEY_PATTERN.test(String(key || ''));
}

/**
 * Pull the human-readable text out of a slide, whatever its type.
 *
 * Slide content is type-specific (`body`, `items[]`, `quote`, `metrics[]`, ...),
 * so this walks the content object rather than assuming a shape. Anything
 * list-like counts as a bullet, which is what "bullets per slide" means for
 * card, timeline, and KPI slides too.
 *
 * @param {object} slide
 * @returns {{title: string, body: string, bullets: string[], allText: string}}
 */
export function extractSlideText(slide) {
  const content = slide?.content || {};
  const titleParts = [];
  const bodyParts = [];
  const bullets = [];

  const walk = (value, key, depth) => {
    if (value == null) return;
    if (typeof value === 'string') {
      const text = value.trim();
      if (!text || isConfigKey(key)) return;
      if (depth === 0 && TITLE_KEYS.has(key)) titleParts.push(text);
      else bodyParts.push(text);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        // Each array entry is one bullet, however it is structured.
        const before = bodyParts.length;
        walk(item, key, depth + 1);
        const added = bodyParts.slice(before).join(' ').trim();
        if (added) bullets.push(added);
      }
      return;
    }
    if (typeof value === 'object') {
      for (const [childKey, childValue] of Object.entries(value)) {
        walk(childValue, childKey, depth + 1);
      }
    }
  };

  for (const [key, value] of Object.entries(content)) walk(value, key, 0);

  // Markdown bodies carry their own bullets; count those too.
  const body = bodyParts.join('\n');
  if (!bullets.length) {
    for (const line of body.split('\n')) {
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) bullets.push(line.replace(/^\s*([-*+]|\d+\.)\s+/, ''));
    }
  }

  const title = titleParts.join(' ');
  return { title, body, bullets, allText: [title, body].filter(Boolean).join('\n') };
}

/**
 * Count words in a string.
 * @param {string} text
 * @returns {number}
 */
export function wordCount(text) {
  const words = String(text || '')
    .replace(/[#*_`>|]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words.length;
}

/**
 * Structural and density metrics for a deck.
 *
 * @param {object} deck
 * @returns {object}
 */
export function deckMetrics(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const perSlide = slides.map((slide) => {
    const { title, bullets, allText } = extractSlideText(slide);
    return {
      type: slide.type,
      title,
      words: wordCount(allText),
      bullets: bullets.length,
    };
  });

  const words = perSlide.map((s) => s.words);
  const bullets = perSlide.map((s) => s.bullets);
  const contentSlides = perSlide.filter((s) => s.type !== 'title-slide');

  return {
    slideCount: slides.length,
    wordsPerSlide: {
      mean: mean(words),
      median: median(words),
      max: words.length ? Math.max(...words) : 0,
    },
    bulletsPerSlide: {
      mean: mean(bullets),
      max: bullets.length ? Math.max(...bullets) : 0,
    },
    // A wall-of-text slide is the failure mode the slide-economy rubric
    // dimension is about; count them explicitly so a prompt change shows up
    // here and not only in the judge's opinion.
    wallOfTextSlides: contentSlides.filter((s) => s.words > 80).length,
    emptySlides: contentSlides.filter((s) => s.words < 5).length,
    slideTypeDistribution: countBy(perSlide.map((s) => s.type)),
    // Monotony: how often a slide repeats its predecessor's type, and the
    // longest such run. A deck can have a healthy type mix overall and still
    // read as a wall of bullets if the repeats are clustered, so both matter.
    repetition: typeRepetition(perSlide.map((s) => s.type)),
    // Share of the deck that is section dividers rather than content.
    dividerShare: slides.length
      ? round(perSlide.filter((s) => s.type === 'chapter-title-slide').length / slides.length)
      : 0,
    structure: {
      hasTitleSlide: slides[0]?.type === 'title-slide',
      hasClosing: /^(payoff|quote|chapter-title)/.test(slides.at(-1)?.type || ''),
      chapterCount: perSlide.filter((s) => s.type === 'chapter-title-slide').length,
    },
    perSlide,
  };
}

/**
 * Numbers that appear in the deck but not in the source.
 *
 * This is cheap hallucination detection: a generated deck should not invent
 * figures. Years and small integers are ignored because they are routinely
 * produced by formatting (list indices, "3 pillars") rather than copied from
 * the source, and would otherwise drown the signal.
 *
 * @param {object} deck
 * @param {string} sourceText
 * @returns {{checked: number, unsupported: string[], supportRate: number}}
 */
export function numberFidelity(deck, sourceText) {
  const sourceNumbers = new Set(extractNumbers(sourceText).map(normalizeNumber));
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];

  const deckNumbers = new Set();
  for (const slide of slides) {
    for (const raw of extractNumbers(extractSlideText(slide).allText)) deckNumbers.add(raw);
  }

  const checked = [];
  const unsupported = [];
  for (const raw of deckNumbers) {
    const value = Number(normalizeNumber(raw));
    // Skip plausible years and small counts: too noisy to be evidence.
    if (Number.isInteger(value) && value >= 1900 && value <= 2100) continue;
    if (Math.abs(value) < 10) continue;
    checked.push(raw);
    if (!sourceNumbers.has(normalizeNumber(raw))) unsupported.push(raw);
  }

  return {
    checked: checked.length,
    unsupported: unsupported.sort(),
    supportRate: checked.length ? (checked.length - unsupported.length) / checked.length : 1,
  };
}

/**
 * Extract numeric literals, including EU and US thousand/decimal styles.
 * @param {string} text
 * @returns {string[]}
 */
function extractNumbers(text) {
  const matches = String(text || '').match(/\d[\d.,]*/g) || [];
  return matches.map((m) => m.replace(/[.,]$/, '')).filter(Boolean);
}

/**
 * Normalize "1.234,5" and "1,234.5" to a comparable "1234.5".
 * @param {string} raw
 * @returns {string}
 */
function normalizeNumber(raw) {
  let s = String(raw);
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Whichever separator comes last is the decimal point.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    s = s.split(groupSep).join('').replace(decimalSep, '.');
  } else if (lastComma > -1) {
    // A lone comma is a decimal separator only when it isn't grouping digits.
    s = /,\d{3}$/.test(s) ? s.split(',').join('') : s.replace(',', '.');
  } else if (lastDot > -1) {
    s = /\.\d{3}$/.test(s) ? s.split('.').join('') : s;
  }
  const value = Number(s);
  return Number.isFinite(value) ? String(value) : String(raw);
}

function mean(values) {
  if (!values.length) return 0;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Measure how often consecutive slides share a type.
 *
 * @param {string[]} types - Slide types in deck order
 * @returns {{consecutiveRepeats: number, longestRun: number, repeatRate: number}}
 */
function typeRepetition(types) {
  let consecutiveRepeats = 0;
  let longestRun = types.length ? 1 : 0;
  let currentRun = 1;

  for (let i = 1; i < types.length; i += 1) {
    if (types[i] === types[i - 1]) {
      consecutiveRepeats += 1;
      currentRun += 1;
      if (currentRun > longestRun) longestRun = currentRun;
    } else {
      currentRun = 1;
    }
  }

  return {
    consecutiveRepeats,
    longestRun,
    repeatRate: types.length > 1 ? round(consecutiveRepeats / (types.length - 1)) : 0,
  };
}

function countBy(items) {
  const out = {};
  for (const item of items) out[item] = (out[item] || 0) + 1;
  return out;
}

function round(n) {
  return Math.round(n * 100) / 100;
}
