/**
 * Bundled gradients — the image source that ships inside Deckyard.
 *
 * Every other stock source (Unsplash, Giphy) is a third-party API: it needs a
 * key, an approval, an attribution surface and a rate limit, and it puts a
 * licence question between a guest and their first slide. The public sandbox
 * has no upload path, so that one licensed source was the *only* image source
 * a guest had. This module removes the question instead of answering it: a set
 * of abstract gradients rendered from the palettes the built-in themes already
 * ship, served as static SVG from `/assets/gradients/`. No external request, no
 * attribution, no rate limit, no approval — and nothing to re-negotiate later.
 *
 * The set is *derived, not authored*. `paletteFromTheme()` reads a theme's
 * `brandColors` and background tokens; `GRADIENT_COMPOSITIONS` are the recipes
 * those colours are poured into. Themes × compositions is the whole library, so
 * a fork that drops its own theme in `themes/` and re-runs
 * `npm run gen:gradients` gets its own gradients for free.
 *
 * The SVG files are generated ahead of time and committed, for one reason: an
 * asset under `/assets/` is inlined by `toDataUrlIfLocal()`, so a gradient
 * survives PDF/PNG export, published pages and embeds with no export-path
 * change at all. `tests/bundled-gradients.test.js` re-renders every item and
 * fails if a committed file has drifted from this module.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

/** Intrinsic size of a generated gradient (matches the 16:9 slide stage). */
export const GRADIENT_WIDTH = 1600;
export const GRADIENT_HEIGHT = 900;

/** URL prefix and repo-relative directory the generated SVGs live under. */
export const GRADIENT_URL_PREFIX = '/assets/gradients/';
export const GRADIENT_DIR_REL = path.join('assets', 'gradients');

const HEX_RE = /^#[0-9a-f]{6}$/i;
const THEME_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

/**
 * @param {unknown} v
 * @returns {string|null} lowercase `#rrggbb`, or null when unusable.
 */
function hex(v) {
  const s = String(v || '').trim();
  return HEX_RE.test(s) ? s.toLowerCase() : null;
}

/**
 * @typedef {Object} GradientPalette
 * @property {string} id        Theme id (also the gradient id prefix).
 * @property {string} label     Human theme label.
 * @property {string} dark      Deep background token.
 * @property {string} light     Paper background token.
 * @property {string} mist      Tinted background token.
 * @property {string} accent    Accent colour.
 * @property {string[]} brand   Exactly four brand colours (cycled if fewer).
 */

/**
 * Read the colours a theme already declares into the palette the compositions
 * consume. Returns null for a theme that is missing a colour we need, rather
 * than inventing one — a half-derived gradient is worse than no gradient.
 *
 * @param {Object} theme - Parsed theme JSON.
 * @returns {GradientPalette|null}
 */
export function paletteFromTheme(theme) {
  const id = String(theme?.id || '').trim().toLowerCase();
  if (!THEME_ID_RE.test(id)) return null;

  const vars = theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const brand = (Array.isArray(theme?.brandColors) ? theme.brandColors : [])
    .map(hex)
    .filter(Boolean);
  const dark = hex(vars['--t-slide-bg-dark']);
  const light = hex(vars['--t-slide-bg-lime']);
  const mist = hex(vars['--t-slide-bg-mist']);
  if (brand.length < 2 || !dark || !light || !mist) return null;

  const at = (i) => brand[i % brand.length];
  return {
    id,
    label: String(theme?.label || id).trim(),
    dark,
    light,
    mist,
    accent: hex(vars['--t-color-accent']) || at(0),
    brand: [at(0), at(1), at(2), at(3)],
  };
}

/**
 * @param {number} cx @param {number} cy @param {number} r
 * @param {string} color
 * @param {Array<[number, number]>} stops - [offset, opacity] pairs.
 */
function radial(cx, cy, r, color, stops) {
  return { type: 'radial', cx, cy, r, color, stops };
}

/**
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {Array<[number, string, number]>} stops - [offset, color, opacity].
 */
function linear(x1, y1, x2, y2, stops) {
  return { type: 'linear', x1, y1, x2, y2, stops };
}

/**
 * Relative luminance of an `#rrggbb` colour (WCAG 2.x definition).
 * @param {string} color
 * @returns {number} 0 (black) … 1 (white)
 */
function luminance(color) {
  const channel = (i) => {
    const c = parseInt(color.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * Which text colour a gradient wants on top of it. *Measured*, not declared:
 * the "light" recipe pours the theme's paper token, and Midnight's paper token
 * is ink. A composition that names its own tone would label that one `light`
 * and hand the user white text on a near-black image.
 *
 * @param {string} base - The gradient's `#rrggbb` base colour.
 * @returns {'dark'|'light'}
 */
export function toneOf(base) {
  return luminance(base) < 0.4 ? 'dark' : 'light';
}

/**
 * The recipes. Each pours a palette into a layer stack over one of the theme's
 * background tokens.
 *
 * @type {Array<{ id: string, label: string, build: (p: GradientPalette) => { base: string, layers: Object[] } }>}
 */
export const GRADIENT_COMPOSITIONS = [
  {
    id: 'aurora',
    label: 'Aurora',
    // Three soft blobs over a deep base — the shape the theme slide
    // backgrounds already use, so it reads as "the theme, without a slide".
    build: (p) => ({
      base: p.dark,
      layers: [
        radial(0.62, 0.18, 0.72, p.brand[1], [[0, 0.55], [0.38, 0.18], [1, 0]]),
        radial(0.12, 0.88, 0.78, p.brand[0], [[0, 0.5], [0.44, 0.14], [1, 0]]),
        radial(0.88, 0.74, 0.6, p.brand[2], [[0, 0.34], [0.5, 0.1], [1, 0]]),
      ],
    }),
  },
  {
    id: 'halo',
    label: 'Halo',
    // One large centred glow. The calmest of the set: room for a centred
    // title without the composition fighting it.
    build: (p) => ({
      base: p.dark,
      layers: [
        radial(0.5, 0.42, 0.85, p.accent, [[0, 0.45], [0.45, 0.14], [1, 0]]),
        linear(0, 1, 0, 0, [
          [0, p.brand[3], 0.22],
          [0.55, p.brand[3], 0.05],
          [1, p.brand[3], 0],
        ]),
      ],
    }),
  },
  {
    id: 'dawn',
    label: 'Dawn',
    // Diagonal ramp through the full brand range, warmest in the top corner.
    build: (p) => ({
      base: p.dark,
      layers: [
        linear(0, 1, 1, 0, [
          [0, p.brand[0], 0.62],
          [0.5, p.brand[1], 0.38],
          [1, p.brand[3], 0.52],
        ]),
        radial(0.85, 0.12, 0.6, p.brand[3], [[0, 0.38], [0.5, 0.1], [1, 0]]),
      ],
    }),
  },
  {
    id: 'drift',
    label: 'Drift',
    // Two opposing corner glows over a tilted base ramp — asymmetric, so it
    // works under text pinned to either side.
    build: (p) => ({
      base: p.dark,
      layers: [
        linear(0, 0, 1, 1, [
          [0, p.brand[2], 0.3],
          [1, p.brand[0], 0.34],
        ]),
        radial(0.08, 0.1, 0.55, p.brand[2], [[0, 0.44], [0.5, 0.12], [1, 0]]),
        radial(0.92, 0.9, 0.6, p.brand[3], [[0, 0.38], [0.5, 0.1], [1, 0]]),
      ],
    }),
  },
  {
    id: 'mist',
    label: 'Mist',
    // Poured over the theme's *paper* token rather than its deep one. For five
    // of the six built-ins that yields the only light member of the set;
    // Midnight's paper token is ink, so there it stays dark — which is why
    // tone is measured (`toneOf`) rather than declared here.
    build: (p) => ({
      base: p.light,
      layers: [
        linear(0, 0, 0, 1, [
          [0, p.mist, 0.85],
          [1, p.mist, 0],
        ]),
        radial(0.2, 0.15, 0.7, p.brand[2], [[0, 0.42], [0.45, 0.12], [1, 0]]),
        radial(0.85, 0.85, 0.75, p.brand[1], [[0, 0.34], [0.5, 0.1], [1, 0]]),
      ],
    }),
  },
];

/** @param {number} n @returns {string} short, stable decimal (no `0.6100000001`). */
function num(n) {
  return String(Math.round(Number(n) * 1000) / 1000);
}

/**
 * @param {string} id
 * @param {Object} layer
 * @returns {string} one `<*Gradient>` def.
 */
function gradientDef(id, layer) {
  if (layer.type === 'radial') {
    const stops = layer.stops
      .map(
        ([offset, opacity]) =>
          `<stop offset="${num(offset)}" stop-color="${layer.color}" stop-opacity="${num(opacity)}"/>`
      )
      .join('');
    return `<radialGradient id="${id}" cx="${num(layer.cx)}" cy="${num(layer.cy)}" r="${num(layer.r)}">${stops}</radialGradient>`;
  }
  const stops = layer.stops
    .map(
      ([offset, color, opacity]) =>
        `<stop offset="${num(offset)}" stop-color="${color}" stop-opacity="${num(opacity)}"/>`
    )
    .join('');
  return `<linearGradient id="${id}" x1="${num(layer.x1)}" y1="${num(layer.y1)}" x2="${num(layer.x2)}" y2="${num(layer.y2)}">${stops}</linearGradient>`;
}

/**
 * Render a layer stack to a standalone SVG document.
 *
 * `slice` rather than the default `meet`: a gradient has no detail worth
 * preserving, and letterbox bars in a slide background would.
 *
 * @param {{ base: string, layers: Object[] }} spec
 * @returns {string} SVG source, newline-terminated.
 */
export function renderGradientSvg(spec) {
  const defs = spec.layers.map((layer, i) => gradientDef(`g${i}`, layer)).join('');
  const rects = [
    `<rect width="100%" height="100%" fill="${spec.base}"/>`,
    ...spec.layers.map((_, i) => `<rect width="100%" height="100%" fill="url(#g${i})"/>`),
  ].join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${GRADIENT_WIDTH} ${GRADIENT_HEIGHT}"` +
    ` width="${GRADIENT_WIDTH}" height="${GRADIENT_HEIGHT}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>${defs}</defs>${rects}</svg>\n`
  );
}

/**
 * @typedef {Object} BundledGradient
 * @property {string} id
 * @property {string} label
 * @property {string} url
 * @property {number} width
 * @property {number} height
 * @property {string} alt          English alt seed; the picker offers it as-is.
 * @property {'dark'|'light'} tone
 * @property {string} theme        Source theme id.
 * @property {string} composition  Recipe id.
 * @property {string[]} tags
 * @property {{ base: string, layers: Object[] }} spec  Render input (stripped before it leaves the server).
 */

/**
 * Cross-multiply themes with compositions. Deterministic and sorted, so the
 * generated files and the manifest are stable across runs and machines.
 *
 * @param {Object[]} themes - Parsed theme JSONs.
 * @returns {BundledGradient[]}
 */
export function buildGradientItems(themes) {
  const items = [];
  for (const theme of Array.isArray(themes) ? themes : []) {
    const p = paletteFromTheme(theme);
    if (!p) continue;
    for (const comp of GRADIENT_COMPOSITIONS) {
      const id = `${p.id}-${comp.id}`;
      const spec = comp.build(p);
      const tone = toneOf(spec.base);
      items.push({
        id,
        label: `${p.label} ${comp.label}`,
        url: `${GRADIENT_URL_PREFIX}${id}.svg`,
        width: GRADIENT_WIDTH,
        height: GRADIENT_HEIGHT,
        alt: `Abstract ${comp.label.toLowerCase()} gradient in the ${p.label} palette`,
        tone,
        theme: p.id,
        composition: comp.id,
        tags: ['gradient', comp.id, p.id, tone],
        spec,
      });
    }
  }
  items.sort((a, b) => a.id.localeCompare(b.id));
  return items;
}

/**
 * Load the built-in themes the library is derived from. Only `themes/` — the
 * bundled set has to match committed files, and a DB or per-organization custom
 * theme has nothing rendered on disk.
 *
 * @param {string} repoRoot
 * @returns {Promise<Object[]>}
 */
export async function loadBundledGradientThemes(repoRoot) {
  const dir = path.join(repoRoot, 'themes');
  let names = [];
  try {
    names = (await fs.readdir(dir)).filter((n) => n.endsWith('.json')).sort();
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      out.push(JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')));
    } catch {
      // A theme that does not parse simply contributes no gradients.
    }
  }
  return out;
}

/** @param {BundledGradient} item @returns {Omit<BundledGradient, 'spec'>} */
export function toManifestItem(item) {
  const { spec, ...rest } = item; // eslint-disable-line no-unused-vars
  return rest;
}

let manifestCache = null;

/** Drop the memoised manifest (tests, and anything that rewrites `themes/`). */
export function clearBundledGradientCache() {
  manifestCache = null;
}

/**
 * The manifest the editor's picker consumes: every item minus its render spec.
 * Memoised — the themes are read-only at runtime.
 *
 * @param {string} repoRoot
 * @returns {Promise<Array<Omit<BundledGradient, 'spec'>>>}
 */
export async function listBundledGradients(repoRoot) {
  if (manifestCache) return manifestCache;
  const themes = await loadBundledGradientThemes(repoRoot);
  manifestCache = buildGradientItems(themes).map(toManifestItem);
  return manifestCache;
}
