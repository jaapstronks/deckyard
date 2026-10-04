/**
 * The image slide as an editable PowerPoint slide: one picture, framed and
 * cropped as the canvas frames and crops it, with its heading, subheading,
 * bottom subheading and caption as text (B588 PR 1).
 *
 * Layer 0 places a picture as one block among others: contained, in the body
 * region, under a heading box. For a slide whose whole point is the picture
 * that is "too small and in the wrong place" (gate A2.8). This mapper reads the
 * slide's own image axes instead, through the type's one resolution
 * (`resolveImageSlideImage`, `focusFromContent`, `imageSlideAltText`), so the
 * export cannot disagree with the canvas about fit, bleed, focus or alt text:
 *
 * - **Frame.** Without bleed the picture fills the padded column under the
 *   heading and above the bottom subheading; with bleed it fills the slide.
 * - **Fit.** `contain` fits a frame of the picture's own ratio into that box,
 *   placed by the focus; `cover` fills the box and crops, keeping the focus in
 *   view. The crop is PowerPoint's own, so "Crop" in PowerPoint shows the rest
 *   of the picture.
 * - **Text.** Without bleed the heading goes in the layout's title
 *   placeholder (the slide keeps its outline) and the rest is text on the
 *   slide's ground. With bleed the heading, the bottom subheading and the
 *   caption sit on a dark scrim over the picture, as on the canvas.
 *
 * The slide goes on the theme's heading-and-body layout and names the colour on
 * every run, since there is no theme text colour to inherit (B232 (a)).
 */

import { focusFromContent } from '../../shared/slide-types/helpers.js';
import { getSlideCopy } from '../../shared/slide-types/slide-copy.js';
import {
  imageSlideAltText,
  resolveImageSlideImage,
} from '../../shared/slide-types/types/image-slide/image.js';
import {
  DECORATIVE_PICTURE_NAME,
  MIN_BODY_PT,
  MIN_HEADING_PT,
  fitSize,
  paragraphRuns,
  placeStandIn,
  textBlockHeight,
  textBlockWidth,
} from './pptx-generic.js';
import { containInBox, coverCrop, rasterForPptx } from './pptx-image.js';
import { PPTX_LAYOUTS, layoutBox, themeTextPt } from './pptx-theme.js';

/** The layout every image slide sits on. */
const LAYOUT = 'headingBody';

/** Pixels per inch the picture is embedded at: 2x the 96dpi canvas. */
const RASTER_DPI = 192;

/**
 * The canvas' overlay chip, in inches and PowerPoint colour: 18px from the
 * frame's edge (`.slide-image .caption`), on `rgba(0, 0, 0, 0.45)`, in
 * `--slide-text-light`. Fixed, as on the canvas: the scrim is what makes light
 * text readable on any picture, so it does not follow the theme.
 */
const CHIP_INSET = 0.15;
const CHIP_FILL = Object.freeze({ color: '000000', transparency: 55 });
const CHIP_TEXT = 'FFFFFF';
/** Extra height a chip gets over its estimated lines, so no line is clipped. */
const CHIP_PAD_Y = 0.08;

/** Room under a non-bleed frame for the bottom subheading (100px). */
const BOTTOM_BAND = 0.833;

/** A stored string field, trimmed. */
function field(content, key) {
  return typeof content?.[key] === 'string' ? content[key].trim() : '';
}

/** One plain paragraph as a text block, the shape the line budget reads. */
function textBlock(text) {
  return {
    kind: 'text',
    paragraphs: [{ lines: [[{ text }]], level: 0, bullet: null }],
  };
}

/**
 * Write one image slide.
 *
 * @param {object} pptx - the pptxgenjs instance, its layouts already defined
 * @param {object} slide - the stored image slide
 * @param {{ repoRoot: string, spec: ReturnType<typeof import('./pptx-theme.js').resolveThemeMaster>,
 *   slideNum: number, docLang?: string, slideWidth: number,
 *   slideHeight: number }} ctx
 * @returns {Promise<{ pptxSlide: object, warnings: string[] }>}
 */
export async function composeImageSlide(pptx, slide, ctx) {
  const { spec, slideWidth, slideHeight } = ctx;
  const content = slide?.content || {};
  const warnings = [];
  const { fit, bleed } = resolveImageSlideImage(content);
  const title = field(content, 'title');
  const subheading = field(content, 'subheading');
  const bottom = field(content, 'bottomSubheading');
  const caption = field(content, 'caption');

  const pptxSlide = pptx.addSlide({ masterName: PPTX_LAYOUTS[LAYOUT] });
  const titleBox = layoutBox(LAYOUT, 'title');
  const pad = titleBox.x;

  let frame;
  if (bleed) {
    frame = { x: 0, y: 0, w: slideWidth, h: slideHeight };
  } else {
    // The picture starts right under the heading, as on the canvas: under
    // the title box, or under the subheading band when there is one.
    const top = subheading
      ? layoutBox(LAYOUT, 'body').y
      : title
        ? titleBox.y + titleBox.h
        : pad;
    const end = slideHeight - pad - (bottom ? BOTTOM_BAND : 0);
    frame = { x: pad, y: top, w: slideWidth - 2 * pad, h: end - top };
  }

  // The picture first: everything after it is drawn over it.
  await placePicture(pptxSlide, content, frame, fit, ctx, warnings);

  const sizes = {
    heading: themeTextPt(spec, 'heading'),
    sub: themeTextPt(spec, 'subtitle'),
    body: themeTextPt(spec, 'body'),
  };
  if (bleed) {
    placeOverlays(pptxSlide, { title, subheading, bottom, caption }, frame, {
      spec,
      sizes,
    });
  } else {
    placeHeading(pptxSlide, { title, subheading }, titleBox, frame, {
      spec,
      sizes,
      warnings,
      slideNum: ctx.slideNum,
    });
    if (bottom) {
      placeText(
        pptxSlide,
        bottom,
        { x: frame.x, y: frame.y + frame.h, w: frame.w, h: BOTTOM_BAND },
        { pt: sizes.sub, color: spec.text, face: spec.bodyFont },
      );
    }
    if (caption) {
      placeChips(pptxSlide, [{ text: caption, pt: sizes.body }], frame, spec);
    }
  }
  return { pptxSlide, warnings };
}

/**
 * The picture in its frame, cropped or contained, or a stand-in when there is
 * none to place.
 */
async function placePicture(pptxSlide, content, frame, fit, ctx, warnings) {
  const { spec } = ctx;
  const src = field(content, 'image');
  const standInPt = Math.max(MIN_BODY_PT, themeTextPt(spec, 'body'));
  if (!src) {
    // An empty frame is the author's state, not a failure: the canvas shows
    // the same placeholder.
    placeStandIn(pptxSlide, getSlideCopy(ctx.docLang).imagePlaceholder, frame, {
      spec,
      pt: standInPt,
    });
    return;
  }
  // A cover crop needs the picture's *short* side to fill the frame, so the
  // cap is a square on the frame's long side; a contained picture never needs
  // more than the frame.
  const long = Math.round(Math.max(frame.w, frame.h) * RASTER_DPI);
  const raster = await rasterForPptx(ctx.repoRoot, src, {
    maxPx:
      fit === 'cover'
        ? { w: long, h: long }
        : {
            w: Math.round(frame.w * RASTER_DPI),
            h: Math.round(frame.h * RASTER_DPI),
          },
    embedRemote: true,
  });
  const alt = imageSlideAltText(content);
  if (!raster) {
    placeStandIn(pptxSlide, alt || src, frame, { spec, pt: standInPt });
    warnings.push(
      `Slide ${ctx.slideNum}: image ${src} could not be embedded; its alt text stands in.`,
    );
    return;
  }
  const focus = focusFromContent(content) || undefined;
  pptxSlide.addImage({
    data: raster.data,
    ...(fit === 'cover'
      ? coverCrop(raster, frame, focus)
      : containInBox(raster, frame, focus)),
    ...(alt ? { altText: alt } : { objectName: DECORATIVE_PICTURE_NAME }),
  });
}

/**
 * Without bleed: the title in the layout's title placeholder, the subheading
 * in the band between it and the frame (or in the title's place when there is
 * no title).
 */
function placeHeading(
  pptxSlide,
  { title, subheading },
  titleBox,
  frame,
  { spec, sizes, warnings, slideNum },
) {
  if (title) {
    const fitted = fitSize(
      [textBlock(title)],
      titleBox,
      sizes.heading,
      MIN_HEADING_PT,
    );
    if (!fitted.fits)
      warnings.push(`Slide ${slideNum}: the heading overflows its box.`);
    pptxSlide.addText(
      [
        {
          text: title,
          options: {
            fontSize: fitted.pt,
            color: spec.text,
            ...(spec.headFont ? { fontFace: spec.headFont } : {}),
          },
        },
      ],
      { placeholder: 'title' },
    );
  }
  if (subheading) {
    const y = title ? titleBox.y + titleBox.h : titleBox.y;
    placeText(
      pptxSlide,
      subheading,
      { x: titleBox.x, y, w: titleBox.w, h: frame.y - y },
      { pt: sizes.sub, color: spec.textMuted, face: spec.bodyFont },
    );
  }
}

/**
 * One paragraph in a box, at the largest size up to `pt` that fits it.
 *
 * @param {object} pptxSlide
 * @param {string} text
 * @param {{x: number, y: number, w: number, h: number}} box
 * @param {{ pt: number, color: string, face?: string }} style
 */
function placeText(pptxSlide, text, box, style) {
  const block = textBlock(text);
  const { pt } = fitSize([block], box, style.pt, MIN_BODY_PT);
  pptxSlide.addText(paragraphRuns(block.paragraphs, { ...style, pt }), {
    ...box,
    valign: 'top',
  });
}

/**
 * With bleed: the heading on a chip in the frame's top-left corner, and the
 * bottom subheading and caption stacked on chips in its bottom-left corner.
 */
function placeOverlays(
  pptxSlide,
  { title, subheading, bottom, caption },
  frame,
  { spec, sizes },
) {
  const top = [];
  if (title) top.push({ text: title, pt: sizes.heading, face: spec.headFont });
  if (subheading) top.push({ text: subheading, pt: sizes.sub });
  if (top.length) placeChip(pptxSlide, top, frame, spec, 'top');
  const under = [];
  if (bottom) under.push({ text: bottom, pt: sizes.sub });
  if (caption) under.push({ text: caption, pt: sizes.body });
  placeChips(pptxSlide, under, frame, spec);
}

/**
 * Chips stacked up from a frame's bottom-left corner, the last one lowest:
 * the bottom subheading sits above the caption, as on the canvas.
 */
function placeChips(pptxSlide, lines, frame, spec) {
  let bottomEdge = frame.y + frame.h - CHIP_INSET;
  for (const line of [...lines].reverse()) {
    const h = placeChip(pptxSlide, [line], frame, spec, 'bottom', bottomEdge);
    bottomEdge -= h + CHIP_INSET;
  }
}

/**
 * One chip: light text on the scrim, as wide as its words up to the frame's
 * width, at a corner of the frame. Returns its height.
 *
 * @param {object} pptxSlide
 * @param {Array<{ text: string, pt: number, face?: string }>} lines - one
 *   paragraph each, each at its own size
 * @param {{x: number, y: number, w: number, h: number}} frame
 * @param {{ bodyFont?: string }} spec
 * @param {'top'|'bottom'} corner
 * @param {number} [bottomEdge] - for a bottom chip, where its lower edge sits
 * @returns {number} inches
 */
function placeChip(pptxSlide, lines, frame, spec, corner, bottomEdge) {
  const maxW = frame.w - 2 * CHIP_INSET;
  const w = Math.min(
    maxW,
    Math.max(...lines.map((l) => textBlockWidth(textBlock(l.text), l.pt))),
  );
  const h =
    lines.reduce(
      (sum, l) => sum + textBlockHeight(textBlock(l.text), l.pt, w),
      0,
    ) + CHIP_PAD_Y;
  const runs = lines.flatMap((l, i) => {
    const out = paragraphRuns(textBlock(l.text).paragraphs, {
      pt: l.pt,
      color: CHIP_TEXT,
      face: l.face || spec.bodyFont || undefined,
    });
    if (i < lines.length - 1) out[out.length - 1].options.breakLine = true;
    return out;
  });
  pptxSlide.addText(runs, {
    x: frame.x + CHIP_INSET,
    y: corner === 'top' ? frame.y + CHIP_INSET : bottomEdge - h,
    w,
    h,
    fill: CHIP_FILL,
    valign: 'top',
  });
  return h;
}
