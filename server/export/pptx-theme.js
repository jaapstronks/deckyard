/**
 * The theme as a PowerPoint layout set — the one place theme values take
 * pptxgenjs shape (B264, D106).
 *
 * ## What this promises, and what it deliberately does not
 *
 * The file this builds is a `.pptx` whose ground, fonts, text colours and logo
 * come from the theme, applied per slide. It is **not** a master that restyles
 * an existing deck. That is not a shortcut: pptxgenjs 4.0.1's
 * `defineSlideMaster` does not write an OOXML master at all — it writes a
 * *layout*, and the options on a placeholder are copied into the run
 * properties of every slide built on it rather than inherited from it (measured
 * in the B232 spike, 2026-09-09). So editing the layout later moves nothing
 * that already exists. D106 chose the smaller promise, written down as such,
 * over an inheritance promise the library cannot keep; a genuinely restyling
 * template means writing `slideMaster1.xml` by hand next to pptxgenjs, and is
 * its own item.
 *
 * Two more grains from the same spike shape the code below:
 *
 * - **There is no theme text colour.** `pptx.theme` carries font faces and
 *   nothing else; the OOXML colour scheme stays Office's own. A bare `addText`
 *   is written as hard-coded black, which on a dark ground is invisible. So
 *   every placeholder here names its colour, and so must every run any later
 *   layer writes.
 * - **The logo travels as a raster.** pptxgenjs writes an SVG twice — behind
 *   the modern `asvg:svgBlip` extension *and* as a "PNG" fallback that is the
 *   same SVG bytes under a `.png` name. PowerPoint takes the first and is
 *   happy; everything else takes the fallback and draws a broken-image box. So
 *   the mark is rendered to real PNG bytes here, or left out.
 *
 * ## Geometry
 *
 * Every box is expressed in the slide's own reference pixels (the 1600x900
 * canvas of `client/styles/slides/00-tokens.css`) and converted once, so the
 * layouts sit where the theme's own padding and type scale put them rather
 * than on numbers invented for the export. `--t-slide-text-scale` is a theme
 * value like any other and is honoured.
 */

import sharp from 'sharp';

import { resolveThemeLogo } from '../../shared/theme-logo.js';
import { resolveSlideBgHex } from '../../shared/slide-surface-tone.js';
import { toDataUrlIfLocal } from '../utils/html-utils.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('export-pptx-theme');

/**
 * The slide's design canvas, and the wide layout it is exported onto. Both are
 * 16:9 (1600x900 and 13.333x7.5in), so one scalar converts either axis.
 */
const CANVAS_W_PX = 1600;
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;

/** `--slide-space-16`, which `--slide-padding` aliases. */
const PADDING_PX = 64;

/** The corner-logo box from `.slide-logo-corner-img` (00-base.css). */
const LOGO_W_PX = 150;
const LOGO_H_PX = 44;
const LOGO_INSET_X_PX = 56;
const LOGO_INSET_Y_PX = 52;

/**
 * The type scale, in reference pixels, from `00-tokens.css`. Only the four
 * steps the layouts below actually use.
 */
const TEXT_PX = Object.freeze({
  title: 80, // --slide-text-5xl, the deck's cover
  subtitle: 28, // --slide-text-lg
  heading: 44, // --slide-text-2xl
  body: 20, // --slide-text-base
});

/** The text colour a ground falls back to when the theme names none. */
const FALLBACK_TEXT = '#0b0b0b';
/** The ground a theme falls back to when it declares no `defaultBackground`. */
const FALLBACK_GROUND = '#ffffff';

/**
 * The layout names, in the order PowerPoint offers them.
 *
 * Exported because two other places need to name a layout without re-deriving
 * it: the guardrail test, and whatever writes slides onto these layouts next
 * (PR 3). English, and not run through i18n, because these strings are read in
 * PowerPoint's own layout gallery next to its own English-shaped chrome, and
 * because a layout name is an identifier a later `addSlide({ masterName })`
 * has to match exactly.
 */
export const PPTX_LAYOUTS = Object.freeze({
  title: 'Title',
  headingBody: 'Heading and body',
  headingImageBody: 'Heading, image and body',
});

/** Reference pixels to inches on the exported slide, on either axis. */
function pxToIn(px) {
  return (px * SLIDE_W_IN) / CANVAS_W_PX;
}

/**
 * Reference pixels to points. 1600px is 13.333in is 960pt, so a reference
 * pixel is 0.6pt — the same conversion as {@link pxToIn}, in the unit
 * PowerPoint states font sizes in.
 */
function pxToPt(px) {
  return Math.round(px * 0.6 * 10) / 10;
}

/**
 * The first family in a CSS font stack, unquoted.
 *
 * pptxgenjs can only carry a family *name* — fonts are not embedded, the
 * recipient either has the face or falls back — so the stack's fallbacks have
 * nothing to attach to and the first entry is the whole answer. One level of
 * `var()` is followed because themes write `--t-font-caption: var(--t-font-body)`.
 *
 * @param {Record<string, string>|null} vars - the theme's cssVars
 * @param {string} name - the token to read, e.g. `--t-font-heading`
 * @returns {string} a family name, or '' when the theme names none
 */
function fontFamilyFromVar(vars, name) {
  const raw = String(vars?.[name] || '').trim();
  if (!raw) return '';
  const indirect = raw.match(/^var\(\s*(--[a-z0-9-]+)/i);
  if (indirect) {
    const target = indirect[1];
    // One hop only: a theme that points a token at itself must not spin here.
    if (target === name) return '';
    return fontFamilyFromVar(vars, target);
  }
  const first = raw.split(',')[0].trim();
  return first.replace(/^['"]|['"]$/g, '').trim();
}

/** A `#rrggbb` literal as pptxgenjs wants it: six hex digits, no hash. */
function pptxColor(hex, fallback) {
  const s = String(hex || '').trim();
  const m = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return pptxColor(fallback, '000000');
  const v = m[1];
  const full =
    v.length === 3
      ? v
          .split('')
          .map((c) => c + c)
          .join('')
      : v;
  return full.toUpperCase();
}

/**
 * Everything the layouts need from a theme, resolved once.
 *
 * Pure: no I/O, no pptxgenjs. That is what makes it the single derivation —
 * the layouts below read this object and never reach back into `theme`, so a
 * theme value cannot arrive two ways.
 *
 * The ground is the theme's `defaultBackground` when it declares one and the
 * built-in `lime` slot otherwise, which is what a slide gets when nothing says
 * different (`applyThemeDefaultBackground` in
 * `shared/slide-types/type-defaults.js`). No bundled theme declares one today,
 * so in practice this reads `--t-slide-bg-lime` — deliberately read rather than
 * assumed, since that slot is near-black under `midnight` and white under
 * `deckyard`.
 *
 * The text colour follows the same cascade the slide CSS does: a ground that
 * declares its own `--t-slide-bg-<id>-text` wins, else the theme's
 * `--t-color-text`, else the same `#0b0b0b` the stylesheet falls back to.
 *
 * @param {object|null} theme - the active normalized theme
 * @returns {{groundId: string, background: string, text: string, textMuted: string,
 *   headFont: string, bodyFont: string, logoUrl: string, logoAlt: string,
 *   label: string, textScale: number}}
 */
export function resolveThemeMaster(theme) {
  const vars =
    theme?.cssVars && typeof theme.cssVars === 'object' ? theme.cssVars : {};
  const groundId = String(theme?.defaultBackground || 'lime')
    .trim()
    .toLowerCase();
  const content = { background: groundId };

  const variant = (
    Array.isArray(theme?.slideBackgrounds) ? theme.slideBackgrounds : []
  ).find((v) => v && v.id === groundId);

  const declaredText =
    vars[`--t-slide-bg-${groundId}-text`] || variant?.textColor || '';
  const declaredMuted =
    vars[`--t-slide-bg-${groundId}-text-muted`] ||
    variant?.textColorMuted ||
    '';

  const scale = Number(vars['--t-slide-text-scale']);

  return {
    groundId,
    background: pptxColor(resolveSlideBgHex(content, theme), FALLBACK_GROUND),
    text: pptxColor(declaredText || vars['--t-color-text'], FALLBACK_TEXT),
    // A muted colour is often `rgba(...)`, which pptxgenjs cannot take; the
    // full-strength text colour is the honest fallback, never a guessed mix.
    textMuted: pptxColor(
      declaredMuted || vars['--t-color-text-muted'],
      declaredText || vars['--t-color-text'] || FALLBACK_TEXT,
    ),
    headFont: fontFamilyFromVar(vars, '--t-font-heading'),
    bodyFont: fontFamilyFromVar(vars, '--t-font-body'),
    logoUrl: resolveThemeLogo(theme, content),
    logoAlt: String(theme?.assets?.logoAlt || 'Logo'),
    label: String(theme?.label || theme?.id || 'Theme'),
    textScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

/**
 * The theme's mark as PNG bytes, ready for `addImage`, sized to fit the corner
 * box without distortion.
 *
 * Two things are done by hand here rather than left to the library, both for
 * reasons the B232 spike measured. The SVG is rasterized, because pptxgenjs'
 * own SVG fallback is not an image any non-PowerPoint renderer can read. And
 * the display box is computed from the mark's real pixels, because pptxgenjs
 * never reads an image's intrinsic size: its `sizing` option takes the box you
 * gave it *as* the image size, so `contain` is a no-op that stretches.
 *
 * A mark that is not a local asset — a remote URL, an unreadable path — yields
 * nothing rather than a broken reference: a template with no logo is a smaller
 * loss than one with a broken-image box in the corner.
 *
 * @param {string} repoRoot
 * @param {string} url - the resolved logo URL
 * @returns {Promise<{data: string, w: number, h: number}|null>} inches
 */
export async function rasterThemeLogo(repoRoot, url) {
  if (!url) return null;
  let png;
  try {
    const dataUrl = await toDataUrlIfLocal(repoRoot, url, {
      transform: async (buf, ext) => {
        // Render at the export's own resolution rather than the source's: an
        // SVG has no pixels of its own, and a 150pt-wide mark on a 2x export
        // wants ~300 of them.
        const out =
          ext === 'svg'
            ? await sharp(buf, { density: 288 })
                .resize({
                  width: LOGO_W_PX * 2,
                  height: LOGO_H_PX * 2,
                  fit: 'inside',
                  withoutEnlargement: false,
                })
                .png()
                .toBuffer()
            : await sharp(buf).png().toBuffer();
        return { buf: out, mime: 'image/png' };
      },
    });
    if (!dataUrl.startsWith('data:image/png;base64,')) return null;
    png = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  } catch (err) {
    log.warn(`theme logo could not be rasterized (${url}): ${err?.message}`);
    return null;
  }

  let meta;
  try {
    meta = await sharp(png).metadata();
  } catch {
    return null;
  }
  const iw = Number(meta?.width) || LOGO_W_PX;
  const ih = Number(meta?.height) || LOGO_H_PX;
  // Fit the box to the mark's own ratio — the crop pptxgenjs would not do.
  const ratio = Math.min(LOGO_W_PX / iw, LOGO_H_PX / ih);
  return {
    data: `data:image/png;base64,${png.toString('base64')}`,
    w: pxToIn(iw * ratio),
    h: pxToIn(ih * ratio),
  };
}

/**
 * The three layouts, as pptxgenjs `defineSlideMaster` arguments.
 *
 * Every placeholder names its own font, size and colour. That is not
 * belt-and-braces: a placeholder's options are the only carrier there is, since
 * the OOXML colour scheme never sees the theme, and they are copied into each
 * slide's runs rather than inherited.
 *
 * @param {ReturnType<typeof resolveThemeMaster>} spec
 * @param {{data: string, w: number, h: number}|null} logo
 * @returns {Array<object>} one `SlideMasterProps` per layout
 */
export function themeLayoutDefinitions(spec, logo = null) {
  const pad = pxToIn(PADDING_PX);
  const innerW = pxToIn(CANVAS_W_PX - 2 * PADDING_PX);
  const pt = (step) => pxToPt(TEXT_PX[step] * spec.textScale);

  const background = { color: spec.background };

  const logoObject = logo
    ? [
        {
          image: {
            data: logo.data,
            // Bottom-right: the theme's own corner mark sits top-right, but
            // that is an opt-in per slide, and a title box would run straight
            // through it. A template's mark stays out of the text.
            x: SLIDE_W_IN - pxToIn(LOGO_INSET_X_PX) - logo.w,
            y: SLIDE_H_IN - pxToIn(LOGO_INSET_Y_PX) - logo.h,
            w: logo.w,
            h: logo.h,
            altText: spec.logoAlt,
          },
        },
      ]
    : [];

  const heading = (name, y, h, step) => ({
    placeholder: {
      options: {
        name,
        type: 'title',
        x: pad,
        y,
        w: innerW,
        h,
        fontFace: spec.headFont || undefined,
        fontSize: pt(step),
        color: spec.text,
        align: 'left',
        valign: 'top',
      },
    },
  });

  const body = (name, x, y, w, h, color = spec.text) => ({
    placeholder: {
      options: {
        name,
        type: 'body',
        x,
        y,
        w,
        h,
        fontFace: spec.bodyFont || undefined,
        fontSize: pt('body'),
        color,
        align: 'left',
        valign: 'top',
      },
    },
  });

  return [
    {
      title: PPTX_LAYOUTS.title,
      background,
      objects: [
        heading('title', pxToIn(300), pxToIn(220), 'title'),
        {
          placeholder: {
            options: {
              name: 'subtitle',
              type: 'body',
              x: pad,
              y: pxToIn(536),
              w: innerW,
              h: pxToIn(120),
              fontFace: spec.bodyFont || undefined,
              fontSize: pxToPt(TEXT_PX.subtitle * spec.textScale),
              color: spec.textMuted,
              align: 'left',
              valign: 'top',
            },
          },
        },
        ...logoObject,
      ],
    },
    {
      title: PPTX_LAYOUTS.headingBody,
      background,
      objects: [
        heading('title', pad, pxToIn(120), 'heading'),
        body('body', pad, pxToIn(240), innerW, pxToIn(540)),
        ...logoObject,
      ],
    },
    {
      title: PPTX_LAYOUTS.headingImageBody,
      background,
      objects: [
        heading('title', pad, pxToIn(120), 'heading'),
        {
          placeholder: {
            options: {
              name: 'image',
              type: 'pic',
              x: pad,
              y: pxToIn(240),
              w: pxToIn(720),
              h: pxToIn(540),
            },
          },
        },
        body('body', pxToIn(832), pxToIn(240), pxToIn(704), pxToIn(540)),
        ...logoObject,
      ],
    },
  ];
}

/**
 * Put the theme's layouts and font faces on a pptxgenjs instance.
 *
 * Both halves matter and only one of them is the layouts: `pptx.theme` is what
 * writes `majorFont`/`minorFont` into `theme1.xml`, which is how a run that
 * names no face still comes out in the theme's typeface.
 *
 * @param {object} pptx - a pptxgenjs instance
 * @param {object|null} theme - the active normalized theme
 * @param {{repoRoot?: string}} [options]
 * @returns {Promise<ReturnType<typeof resolveThemeMaster>>} the resolved spec
 */
export async function applyThemeToPptx(pptx, theme, { repoRoot = '.' } = {}) {
  const spec = resolveThemeMaster(theme);
  const logo = await rasterThemeLogo(repoRoot, spec.logoUrl);

  if (spec.headFont || spec.bodyFont) {
    pptx.theme = {
      ...(spec.headFont ? { headFontFace: spec.headFont } : {}),
      ...(spec.bodyFont ? { bodyFontFace: spec.bodyFont } : {}),
    };
  }
  for (const layout of themeLayoutDefinitions(spec, logo)) {
    pptx.defineSlideMaster(layout);
  }
  return spec;
}

/**
 * A `.pptx` holding the theme's layouts and nothing else — the "theme as a
 * template" download.
 *
 * Empty is the point: the file is a starting document, so it carries the
 * layouts and no slides. PowerPoint opens it on the first layout; Keynote
 * imports the layouts as its own.
 *
 * @param {string} repoRoot
 * @param {object|null} theme
 * @returns {Promise<Buffer>}
 */
export async function buildThemeTemplateBuffer(repoRoot, theme) {
  let pptxgen;
  try {
    pptxgen = await import('pptxgenjs');
  } catch {
    const err = new Error(
      'PPTX export requires pptxgenjs. Install it with: npm i pptxgenjs',
    );
    err.code = 'PPTXGEN_MISSING';
    throw err;
  }
  const PptxGen = pptxgen?.default || pptxgen?.PptxGenJS || pptxgen;
  const pptx = new PptxGen();
  pptx.layout = 'LAYOUT_WIDE';

  const spec = await applyThemeToPptx(pptx, theme, { repoRoot });
  pptx.title = `${spec.label} template`;
  pptx.subject = `${spec.label} theme layouts`;

  return pptx.write('nodebuffer');
}
