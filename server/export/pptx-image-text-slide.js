/**
 * The image-text slide as an editable PowerPoint slide: one picture in its
 * column, the heading and body as text beside it (B588 PR 2).
 *
 * Layer 0 put this slide on the generic "heading, image and body" layout: the
 * heading across the top, the picture in a padded box under it, contained.
 * The canvas does something else, and that is the slide's point (gate A2.8:
 * "the picture too small and in the wrong place"). This mapper follows the
 * canvas grid (`50-image-text-slide.css`) and reads the image through the
 * type's one resolution (`resolveImageTextImage`, `focusFromContent`,
 * `imageTextAltText`), so the export cannot disagree with the canvas about
 * fit, focus or alt text:
 *
 * - **Media column.** The picture runs edge to edge over the slide's full
 *   height, on the side `imageSide` names and at the share `imageWidth`
 *   names (37, 50 or 63 per cent). The corner layout puts it in the top 58
 *   per cent of a 45 per cent column and leaves the space below empty.
 * - **Fit.** `cover` fills the column with PowerPoint's own crop, keeping the
 *   focus in view; `contain` fits the picture inside the column's padding on
 *   a white plate (none when `imageBackground` is `match`), placed by the
 *   focus.
 * - **Copy column.** The heading and the body, in the column's padding,
 *   balanced on its vertical middle (the corner layout keeps them at the
 *   top). The heading is the slide's title placeholder, moved to where the
 *   canvas puts it, so the slide keeps its outline. The body is read from
 *   the slide's semantic projection, the same answer layer 0 and the reader
 *   use, so markdown, lists and links come out as they do there.
 * - **Caption.** On the canvas' dark chip in the picture's bottom-left
 *   corner, as on the image slide.
 *
 * The slide goes on the theme's heading-and-body layout for its ground and
 * logo, and names the colour on every run (B232 (a)). The slide-level
 * `background` swatch is not carried, as on every other editable slide.
 */

import { focusFromContent } from '../../shared/slide-types/helpers.js';
import { getSlideCopy } from '../../shared/slide-types/slide-copy.js';
import {
  imageTextAltText,
  resolveImageTextImage,
} from '../../shared/slide-types/types/image-text-slide/image.js';
import {
  DECORATIVE_PICTURE_NAME,
  MIN_BODY_PT,
  MIN_HEADING_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  paragraphRuns,
  placeStandIn,
  slideBlocks,
  textBlockHeight,
} from './pptx-generic.js';
import { placeChips } from './pptx-image-slide.js';
import { containInBox, coverCrop, rasterForPptx } from './pptx-image.js';
import { PPTX_LAYOUTS, layoutBox, themeTextPt } from './pptx-theme.js';

/** The layout every image-text slide sits on, for its ground and logo. */
const LAYOUT = 'headingBody';

/** Pixels per inch the picture is embedded at: 2x the 96dpi canvas. */
const RASTER_DPI = 192;

/** The media column's share of the slide width, per `imageWidth`. */
const SPLIT_SHARE = Object.freeze({ narrow: 0.37, half: 0.5, wide: 0.63 });

/** The corner layout's grid: a 45 per cent column, its top 58 per cent row. */
const CORNER_SHARE = Object.freeze({ w: 0.45, h: 0.58 });

/**
 * The white plate's padding around a contained picture, as a share of the
 * slide width: `--slide-space-6` (24px) on the 1600px canvas.
 */
const CONTAIN_INSET_SHARE = 24 / 1600;

/**
 * Space under the heading, as a share of the slide width: the heading's
 * `margin-bottom: var(--slide-space-5)` (20px) on the 1600px canvas.
 */
const HEADING_GAP_SHARE = 20 / 1600;

/** The most of the copy column the heading may take before the body. */
const HEADING_MAX_SHARE = 0.5;

/** One plain paragraph as a text block, the shape the line budget reads. */
function textBlock(text) {
  return {
    kind: 'text',
    paragraphs: [{ lines: [[{ text }]], level: 0, bullet: null }],
  };
}

/**
 * Where the picture and the copy go, in inches: the canvas grid for the
 * slide's layout, side and width.
 *
 * @param {object} content
 * @param {{ slideWidth: number, slideHeight: number, pad: number }} dims
 * @returns {{ media: Box, copy: Box, corner: boolean }}
 * @typedef {{x: number, y: number, w: number, h: number}} Box
 */
export function imageTextGeometry(content, { slideWidth, slideHeight, pad }) {
  const corner = String(content?.layout || 'split') === 'corner';
  const right = content?.imageSide === 'right';
  const share = corner
    ? CORNER_SHARE.w
    : SPLIT_SHARE[content?.imageWidth] || SPLIT_SHARE.half;
  const mediaW = slideWidth * share;
  const rowH = corner ? slideHeight * CORNER_SHARE.h : slideHeight;
  const media = {
    x: right ? slideWidth - mediaW : 0,
    y: 0,
    w: mediaW,
    h: rowH,
  };
  const copyX = right ? 0 : mediaW;
  const copy = {
    x: copyX + pad,
    y: pad,
    w: slideWidth - mediaW - 2 * pad,
    h: rowH - 2 * pad,
  };
  return { media, copy, corner };
}

/**
 * Write one image-text slide.
 *
 * @param {object} pptx - the pptxgenjs instance, its layouts already defined
 * @param {object} slide - the stored image-text slide
 * @param {{ repoRoot: string, spec: ReturnType<typeof import('./pptx-theme.js').resolveThemeMaster>,
 *   def?: object, slideNum: number, docLang?: string, slideIds?: string[],
 *   slideWidth: number, slideHeight: number }} ctx
 * @returns {Promise<{ pptxSlide: object, warnings: string[] }>}
 */
export async function composeImageTextSlide(pptx, slide, ctx) {
  const { spec, slideWidth, slideHeight, slideNum } = ctx;
  const content = slide?.content || {};
  const warnings = [];
  const pad = layoutBox(LAYOUT, 'title').x;
  const { media, copy, corner } = imageTextGeometry(content, {
    slideWidth,
    slideHeight,
    pad,
  });

  const pptxSlide = pptx.addSlide({ masterName: PPTX_LAYOUTS[LAYOUT] });
  await placePicture(pptxSlide, content, media, ctx, warnings);

  // The copy, from the projection: its heading, and its text blocks as the
  // body. The picture block is the one placed above.
  const projected = slideBlocks(slide, ctx.def, {
    index: slideNum - 1,
    lang: ctx.docLang,
    slideIds: ctx.slideIds,
  });
  const title = projected.heading.visible ? projected.heading.text : '';
  const flow = projected.blocks.filter((b) => b.kind !== 'image');
  if (flow.some((b) => b.kind !== 'text')) {
    warnings.push(
      `Slide ${slideNum}: a table beside the picture is left out of the editable slide.`,
    );
  }
  const body = flow
    .filter((b) => b.kind === 'text')
    .flatMap((b) => b.paragraphs);
  placeCopy(pptxSlide, { title, body }, copy, {
    spec,
    slideNum,
    warnings,
    top: corner,
    gap: slideWidth * HEADING_GAP_SHARE,
    bodyStep: content?.density === 'compact' ? 'body' : 'subtitle',
  });

  const caption =
    typeof content.caption === 'string' ? content.caption.trim() : '';
  if (caption) {
    placeChips(
      pptxSlide,
      [{ text: caption, pt: themeTextPt(spec, 'body') }],
      media,
      spec,
    );
  }
  return { pptxSlide, warnings };
}

/**
 * The picture in the media column, cropped or contained on its plate, or a
 * stand-in when there is none to place.
 */
async function placePicture(pptxSlide, content, media, ctx, warnings) {
  const { spec, slideWidth } = ctx;
  const { src, fit } = resolveImageTextImage(content);
  const standInPt = Math.max(MIN_BODY_PT, themeTextPt(spec, 'body'));
  if (!src) {
    // An empty column is the author's state, not a failure: the canvas shows
    // the same placeholder.
    placeStandIn(pptxSlide, getSlideCopy(ctx.docLang).imagePlaceholder, media, {
      spec,
      pt: standInPt,
    });
    return;
  }
  let box = media;
  if (fit === 'contain') {
    if (content.imageBackground !== 'match') {
      pptxSlide.addShape('rect', {
        ...media,
        fill: { color: 'FFFFFF' },
        line: { type: 'none' },
      });
    }
    const inset = slideWidth * CONTAIN_INSET_SHARE;
    box = {
      x: media.x + inset,
      y: media.y + inset,
      w: media.w - 2 * inset,
      h: media.h - 2 * inset,
    };
  }
  // A cover crop needs the picture's *short* side to fill the column, so the
  // cap is a square on the column's long side; a contained picture never
  // needs more than its box.
  const long = Math.round(Math.max(box.w, box.h) * RASTER_DPI);
  const raster = await rasterForPptx(ctx.repoRoot, src, {
    maxPx:
      fit === 'cover'
        ? { w: long, h: long }
        : {
            w: Math.round(box.w * RASTER_DPI),
            h: Math.round(box.h * RASTER_DPI),
          },
    embedRemote: true,
  });
  const alt = imageTextAltText(content);
  if (!raster) {
    placeStandIn(pptxSlide, alt || src, box, { spec, pt: standInPt });
    warnings.push(
      `Slide ${ctx.slideNum}: image ${src} could not be embedded; its alt text stands in.`,
    );
    return;
  }
  const focus = focusFromContent(content) || undefined;
  pptxSlide.addImage({
    data: raster.data,
    ...(fit === 'cover'
      ? coverCrop(raster, box, focus)
      : containInBox(raster, box, focus)),
    ...(alt ? { altText: alt } : { objectName: DECORATIVE_PICTURE_NAME }),
  });
}

/**
 * The heading and the body in the copy column, each at the largest size up
 * to its theme step that fits, stacked and balanced on the column's middle
 * (or from its top).
 */
function placeCopy(
  pptxSlide,
  { title, body },
  copy,
  { spec, slideNum, warnings, top, gap, bodyStep },
) {
  const heading = title ? textBlock(title) : null;
  let headingPt = 0;
  let headingH = 0;
  if (heading) {
    const fitted = fitSize(
      [heading],
      { ...copy, h: copy.h * (body.length ? HEADING_MAX_SHARE : 1) },
      themeTextPt(spec, 'heading'),
      MIN_HEADING_PT,
    );
    if (!fitted.fits)
      warnings.push(`Slide ${slideNum}: the heading overflows its box.`);
    headingPt = fitted.pt;
    headingH = textBlockHeight(heading, headingPt, copy.w);
  }
  const bodyBlock = body.length ? { kind: 'text', paragraphs: body } : null;
  let bodyPt = 0;
  let bodyH = 0;
  if (bodyBlock) {
    const room = {
      ...copy,
      h: Math.max(0, copy.h - (heading ? headingH + gap : 0)),
    };
    const fitted = fitSize(
      [bodyBlock],
      room,
      themeTextPt(spec, bodyStep),
      MIN_BODY_PT,
    );
    if (!fitted.fits)
      warnings.push(
        `Slide ${slideNum}: the text does not fit at ${MIN_BODY_PT}pt and overflows its box.`,
      );
    bodyPt = fitted.pt;
    bodyH = Math.min(room.h, textBlockHeight(bodyBlock, bodyPt, copy.w));
  }
  const total = headingH + (heading && bodyBlock ? gap : 0) + bodyH;
  // `safe center`: balanced when it fits, from the top when it does not.
  let y = top ? copy.y : copy.y + Math.max(0, (copy.h - total) / 2);
  if (heading) {
    pptxSlide.addText(
      [
        {
          text: title,
          options: {
            fontSize: headingPt,
            color: spec.text,
            ...(spec.headFont ? { fontFace: spec.headFont } : {}),
          },
        },
      ],
      {
        x: copy.x,
        y,
        w: copy.w,
        h: headingH,
        // Named, not inherited: as a placeholder the box would take the
        // master's title alignment, which PowerPoint centres.
        align: 'left',
        valign: 'top',
        objectName: POSITIONED_TITLE_NAME,
      },
    );
    y += headingH + gap;
  }
  if (bodyBlock) {
    pptxSlide.addText(
      paragraphRuns(body, {
        pt: bodyPt,
        color: spec.text,
        face: spec.bodyFont || undefined,
      }),
      { x: copy.x, y, w: copy.w, h: bodyH, valign: 'top' },
    );
  }
}
