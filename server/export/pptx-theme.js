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

import { hexToRgb } from '../../shared/color-utils.js';
import { resolveThemeLogo } from '../../shared/theme-logo.js';
import { resolveSlideBgHex } from '../../shared/slide-surface-tone.js';
import { escapeXml } from '../../shared/xml.js';
import { rasterForPptx } from './pptx-image.js';
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
 * The type scale, in reference pixels, from `00-tokens.css`, keyed by the
 * step's own name (`--slide-text-<step>`) so a composition asks for the step
 * its canvas CSS sets. Only the steps the layouts and mappers use.
 */
const TEXT_PX = Object.freeze({
  '4xl': 64, // quote and chapter title
  '5xl': 80, // the deck's cover title
  '2xl': 44, // a slide heading
  '3xl': 52, // the KPI slide heading
  xl: 34,
  lg: 28, // most slide text, and the cover subtitle
  md: 24,
  base: 20, // a template's empty body box
});

/**
 * The face written for an uploaded family that names no desktop font: its CSS
 * alias exists on no machine, and Arial is on every one (D126).
 */
const FALLBACK_TYPEFACE = 'Arial';

/**
 * The gap after a paragraph of a sample slide, as a share of its own size —
 * the share the deck export uses, so the sample reads like an exported slide.
 */
const SAMPLE_PARA_SPACE = 0.5;

/** The text colour a ground falls back to when the theme names none. */
const FALLBACK_TEXT = '#0b0b0b';
/** The ground a theme falls back to when it declares no `defaultBackground`. */
const FALLBACK_GROUND = '#ffffff';

/**
 * The layout names, in the order PowerPoint offers them.
 *
 * Exported because two other places need to name a layout without re-deriving
 * it: the guardrail test, and the generic composition that writes slides onto
 * these layouts (`pptx-generic.js`, B290). English, and not run through i18n,
 * because these strings are read in PowerPoint's own layout gallery next to its
 * own English-shaped chrome, and because a layout name is an identifier a later
 * `addSlide({ masterName })` has to match exactly.
 */
export const PPTX_LAYOUTS = Object.freeze({
  title: 'Title',
  headingBody: 'Heading and body',
  headingImageBody: 'Heading, image and body',
});

/**
 * Where each layout's boxes sit, in reference pixels — the one statement of the
 * geometry. The layouts below are built from it, and so is every slide the
 * generic composition writes onto them, so a box cannot sit in one place on the
 * layout and in another on the slide.
 *
 * `x` and `w` default to the padded content column.
 */
const LAYOUT_BOXES_PX = Object.freeze({
  title: Object.freeze({
    title: Object.freeze({ y: 300, h: 220 }),
    subtitle: Object.freeze({ y: 536, h: 120 }),
  }),
  headingBody: Object.freeze({
    title: Object.freeze({ y: PADDING_PX, h: 120 }),
    body: Object.freeze({ y: 240, h: 540 }),
  }),
  headingImageBody: Object.freeze({
    title: Object.freeze({ y: PADDING_PX, h: 120 }),
    image: Object.freeze({ x: PADDING_PX, y: 240, w: 720, h: 540 }),
    body: Object.freeze({ x: 832, y: 240, w: 704, h: 540 }),
  }),
});

/**
 * One box of one layout, in inches on the exported slide.
 *
 * @param {keyof typeof PPTX_LAYOUTS} layout
 * @param {string} name - `title`, `subtitle`, `body` or `image`
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function layoutBox(layout, name) {
  const box = LAYOUT_BOXES_PX[layout]?.[name];
  if (!box) throw new TypeError(`no box '${name}' on layout '${layout}'`);
  return {
    x: pxToIn(box.x ?? PADDING_PX),
    y: pxToIn(box.y),
    w: pxToIn(box.w ?? CANVAS_W_PX - 2 * PADDING_PX),
    h: pxToIn(box.h),
  };
}

/**
 * A step of the type scale in points, under the theme's own multiplier.
 *
 * @param {ReturnType<typeof resolveThemeMaster>} spec
 * @param {keyof typeof TEXT_PX} step
 * @returns {number}
 */
export function themeTextPt(spec, step) {
  return pxToPt(TEXT_PX[step] * (spec?.textScale || 1));
}

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

/**
 * The typeface a font token is written as in the PPTX — the one place that
 * decides it, for the document theme and every placeholder run alike.
 *
 * A curated family's CSS name is the name Google publishes and a desktop
 * install carries, so it is written as is. An uploaded family's CSS name is an
 * alias the uploader chose, which PowerPoint and Keynote match against nothing
 * ("missing font"); its `embedFonts` entries carry the installed font's full
 * name as `desktopFamily` when the family declares one, and Arial stands in
 * when it does not (B289, D126). An entry is uploaded when it is read from a
 * `url` rather than a curated `path` (D244).
 *
 * pptxgenjs splices the face into an XML attribute unescaped, so it leaves
 * here escaped.
 *
 * @param {object|null} theme - the active normalized theme
 * @param {Record<string, string>} vars - the theme's cssVars
 * @param {string} token - e.g. `--t-font-heading`
 * @returns {string} the attribute-safe typeface, or '' when the theme names none
 */
function pptxTypeface(theme, vars, token) {
  const family = fontFamilyFromVar(vars, token);
  if (!family) return '';
  const uploaded = (
    Array.isArray(theme?.embedFonts) ? theme.embedFonts : []
  ).filter((f) => f && f.family === family && f.url);
  if (!uploaded.length) return escapeXml(family);
  const desktop = uploaded.find((f) => f.desktopFamily)?.desktopFamily;
  return escapeXml(desktop || FALLBACK_TYPEFACE);
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
 *   label: string, textScale: number, darkBackground: string, darkText: string,
 *   darkAccent: string, monoFont: string}}
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
    darkBackground: pptxColor(vars['--t-slide-bg-dark'], '212121'),
    darkText: pptxColor(
      vars['--t-slide-bg-dark-text'] || vars['--t-text-color-light'],
      'FFFFFF',
    ),
    accent: pptxColor(vars['--t-color-accent'], '385C5C'),
    darkAccent: pptxColor(
      vars['--t-color-accent-on-dark'] || vars['--t-color-link-on-dark'],
      vars['--t-slide-bg-dark-text'] ||
        vars['--t-text-color-light'] ||
        'FFFFFF',
    ),
    monoFont: pptxTypeface(theme, vars, '--t-font-mono') || 'Courier New',
    background: pptxColor(resolveSlideBgHex(content, theme), FALLBACK_GROUND),
    text: pptxColor(declaredText || vars['--t-color-text'], FALLBACK_TEXT),
    // A muted colour is often `rgba(...)`, which pptxgenjs cannot take; the
    // full-strength text colour is the honest fallback, never a guessed mix.
    textMuted: pptxColor(
      declaredMuted || vars['--t-color-text-muted'],
      declaredText || vars['--t-color-text'] || FALLBACK_TEXT,
    ),
    headFont: pptxTypeface(theme, vars, '--t-font-heading'),
    bodyFont: pptxTypeface(theme, vars, '--t-font-body'),
    logoUrl: resolveThemeLogo(theme, content),
    logoAlt: String(theme?.assets?.logoAlt || 'Logo'),
    label: String(theme?.label || theme?.id || 'Theme'),
    textScale: Number.isFinite(scale) && scale > 0 ? scale : 1,
  };
}

/**
 * The theme's mark as raster bytes, ready for `addImage`, sized to fit the
 * corner box without distortion.
 *
 * The rasterizing and the reading of the real pixel size happen in
 * {@link rasterForPptx}, for the reasons the B232 spike measured; what is left
 * here is fitting the corner box to the mark's ratio.
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
  // Rendered at twice the corner box: a 150pt-wide mark on a 2x export wants
  // ~300 pixels.
  const mark = await rasterForPptx(repoRoot, url, {
    maxPx: { w: LOGO_W_PX * 2, h: LOGO_H_PX * 2 },
  });
  if (!mark) {
    log.warn(`theme logo could not be rasterized (${url})`);
    return null;
  }
  // Fit the box to the mark's own ratio — the crop pptxgenjs would not do.
  const ratio = Math.min(LOGO_W_PX / mark.w, LOGO_H_PX / mark.h);
  return {
    data: mark.data,
    w: pxToIn(mark.w * ratio),
    h: pxToIn(mark.h * ratio),
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
  const pt = (step) => themeTextPt(spec, step);

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

  const heading = (layout, step) => ({
    placeholder: {
      options: {
        name: 'title',
        type: 'title',
        ...layoutBox(layout, 'title'),
        fontFace: spec.headFont || undefined,
        fontSize: pt(step),
        color: spec.text,
        align: 'left',
        valign: 'top',
      },
    },
  });

  const body = (layout, name, step, color) => ({
    placeholder: {
      options: {
        name,
        type: 'body',
        ...layoutBox(layout, name),
        fontFace: spec.bodyFont || undefined,
        fontSize: pt(step),
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
        heading('title', '5xl'),
        body('title', 'subtitle', 'lg', spec.textMuted),
        ...logoObject,
      ],
    },
    {
      title: PPTX_LAYOUTS.headingBody,
      background,
      objects: [
        heading('headingBody', '2xl'),
        body('headingBody', 'body', 'base', spec.text),
        ...logoObject,
      ],
    },
    {
      title: PPTX_LAYOUTS.headingImageBody,
      background,
      objects: [
        heading('headingImageBody', '2xl'),
        {
          placeholder: {
            options: {
              name: 'image',
              type: 'pic',
              ...layoutBox('headingImageBody', 'image'),
            },
          },
        },
        body('headingImageBody', 'body', 'base', spec.text),
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
 * The sample slides a template opens on: one per theme layout, each filled
 * with text that says what its layout is for.
 *
 * Why a template carries slides at all. A `.pptx` that holds only layouts
 * opens on nothing of its own. PowerPoint shows the first layout, but Keynote
 * adds a slide on a "Default" layout it writes itself, which is black and
 * carries no placeholder, so the first thing you see is an empty black
 * rectangle and the theme's layouts stay hidden until you insert a slide
 * (measured in Keynote on 2026-10-09, B637; D126 had already recorded the
 * black "Default" Keynote adds). One sample slide per layout is what a
 * PowerPoint or Keynote template conventionally carries, and it leaves D106's
 * promise exactly as it was: these are slides *on* the layouts, never a master
 * that restyles a deck.
 *
 * Every run names its own size, face and colour, like the placeholders they
 * sit in and for the same reason: there is no theme text colour in OOXML, so a
 * run that names none is written as hard-coded black.
 *
 * The copy is English and not run through i18n, for the reason
 * {@link PPTX_LAYOUTS} is: each line names the layout it sits on, and that name
 * is an identifier read in PowerPoint's own layout gallery.
 *
 * The body sits at the theme's `lg` step, not the `base` the layout's own empty
 * body box carries, for the reason the deck export starts there too: `base` is
 * the size of an empty template box, and a handful of lines set at it read as
 * small type stranded in a large one.
 *
 * @param {ReturnType<typeof resolveThemeMaster>} spec
 * @returns {Array<{layout: keyof typeof PPTX_LAYOUTS, heading: string,
 *   headingStep: keyof typeof TEXT_PX, body: string[],
 *   bodyName: string, bodyStep: keyof typeof TEXT_PX, bodyMuted: boolean,
 *   picture?: string}>}
 */
export function themeSampleSlides(spec) {
  return [
    {
      layout: 'title',
      // The theme's own name, in its heading face at the cover size: the first
      // thing the file shows says which theme it is.
      heading: spec.label,
      headingStep: '5xl',
      bodyName: 'subtitle',
      bodyStep: 'lg',
      bodyMuted: true,
      body: [
        `Template. This slide is on the ${PPTX_LAYOUTS.title} layout, for a cover, a chapter opener or a closing word.`,
        'Replace the text; the ground, the type and the mark come from the theme.',
      ],
    },
    {
      layout: 'headingBody',
      heading: PPTX_LAYOUTS.headingBody,
      headingStep: '2xl',
      bodyName: 'body',
      bodyStep: 'lg',
      bodyMuted: false,
      body: [
        'The layout most slides use: a heading above, text below.',
        'The heading is set in the theme heading face, this text in its body face, both at the size the theme type scale gives them.',
        `The other layouts are ${PPTX_LAYOUTS.title} and ${PPTX_LAYOUTS.headingImageBody}; add a slide and pick one.`,
      ],
    },
    {
      layout: 'headingImageBody',
      heading: PPTX_LAYOUTS.headingImageBody,
      headingStep: '2xl',
      bodyName: 'body',
      bodyStep: 'lg',
      bodyMuted: false,
      body: [
        'Text beside a picture.',
        'Drop an image in the frame and keep the words in this column.',
      ],
      picture: 'Picture',
    },
  ];
}

/**
 * Write {@link themeSampleSlides} onto a pptxgenjs instance whose layouts are
 * already defined.
 *
 * Only the template download does this. The deck exports write their own
 * slides onto the same layouts (`pptx-generic.js`), and a sample slide in front
 * of them would be a slide the deck does not have.
 *
 * @param {object} pptx - a pptxgenjs instance, its layouts already defined
 * @param {ReturnType<typeof resolveThemeMaster>} spec
 * @returns {void}
 */
function addThemeSampleSlides(pptx, spec) {
  for (const sample of themeSampleSlides(spec)) {
    const slide = pptx.addSlide({ masterName: PPTX_LAYOUTS[sample.layout] });
    slide.addText(
      sampleRuns([sample.heading], {
        pt: themeTextPt(spec, sample.headingStep),
        color: spec.text,
        face: spec.headFont,
      }),
      { placeholder: 'title' },
    );
    slide.addText(
      sampleRuns(sample.body, {
        pt: themeTextPt(spec, sample.bodyStep),
        color: sample.bodyMuted ? spec.textMuted : spec.text,
        face: spec.bodyFont,
      }),
      { placeholder: sample.bodyName },
    );
    if (!sample.picture) continue;
    // The picture slot, drawn as a dashed frame with the word in it — the
    // vocabulary the deck export already uses for a frame with no picture.
    // The word goes *in* the placeholder rather than in a box of its own:
    // pptxgenjs writes every placeholder a slide leaves empty onto that slide,
    // and PowerPoint fills such a one with its own "Click to add text" and its
    // insert icons, which a second text box over the same rectangle then runs
    // straight through (PowerPoint 16, 2026-10-09). Filling it leaves the frame
    // as the only thing to draw, and that frame is what Keynote needs: there an
    // empty placeholder shows nothing at all, so the column would read as a
    // hole beside the text.
    slide.addShape(pptx.ShapeType.rect, {
      ...layoutBox(sample.layout, 'image'),
      fill: { type: 'none' },
      line: { color: spec.textMuted, width: 0.75, dashType: 'dash' },
    });
    slide.addText(
      sampleRuns([sample.picture], {
        pt: themeTextPt(spec, 'base'),
        color: spec.textMuted,
        face: spec.bodyFont,
        italic: true,
        align: 'center',
      }),
      { placeholder: 'image', valign: 'middle' },
    );
  }
}

/**
 * Paragraphs as pptxgenjs text runs, each naming its own size, face and
 * colour.
 *
 * Run level, not box level: a text box addressed by `placeholder` takes its
 * geometry *and its text options* from the layout, so a size passed beside the
 * placeholder is dropped and the layout's own step comes back. The deck export
 * carries its sizes in the runs for the same reason.
 *
 * @param {string[]} paragraphs
 * @param {{pt: number, color: string, face?: string, italic?: boolean,
 *   align?: string}} style
 * @returns {Array<{text: string, options: object}>}
 */
function sampleRuns(paragraphs, style) {
  return paragraphs.map((text, i) => ({
    text,
    options: {
      fontSize: style.pt,
      color: style.color,
      ...(style.face ? { fontFace: style.face } : {}),
      ...(style.italic ? { italic: true } : {}),
      ...(style.align ? { align: style.align } : {}),
      paraSpaceAfter: Math.round(style.pt * SAMPLE_PARA_SPACE),
      bullet: false,
      ...(i < paragraphs.length - 1 ? { breakLine: true } : {}),
    },
  }));
}

/**
 * A `.pptx` holding the theme's layouts and a sample slide on each — the
 * "theme as a template" download.
 *
 * The file is a starting document: the layouts are what it hands over, and the
 * sample slides are there so opening it shows them. See
 * {@link addThemeSampleSlides} for why a layout set with no slides in it opens
 * on a black rectangle in Keynote.
 *
 * @param {string} repoRoot
 * @param {object|null} theme
 * @returns {Promise<Buffer>}
 */
export async function buildThemeTemplateBuffer(repoRoot, theme) {
  const pptx = await createWidePptx();
  const spec = await applyThemeToPptx(pptx, theme, { repoRoot });
  pptx.title = `${spec.label} template`;
  pptx.subject = `${spec.label} theme layouts`;
  addThemeSampleSlides(pptx, spec);

  return pptx.write('nodebuffer');
}

/**
 * A fresh pptxgenjs presentation on the 16:9 wide layout (13.333 x 7.5in), the
 * one every PPTX this server writes starts from.
 *
 * pptxgenjs is an optional dependency, loaded here and nowhere else; without
 * it the export answers `PPTXGEN_MISSING`.
 *
 * @returns {Promise<object>} a pptxgenjs instance
 */
export async function createWidePptx() {
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
  // ESM/CJS interop: pptxgenjs exports a default class in most setups.
  const PptxGen = pptxgen?.default || pptxgen?.PptxGenJS || pptxgen;
  const pptx = new PptxGen();
  pptx.layout = 'LAYOUT_WIDE';
  return pptx;
}

/** Flatten a translucent canvas colour into an opaque PowerPoint colour. */
export function mixPptxColors(a, b, share) {
  const left = hexToRgb(a);
  const right = hexToRgb(b);
  return ['r', 'g', 'b']
    .map((channel) =>
      Math.round(left[channel] * share + right[channel] * (1 - share))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase();
}
