/**
 * Editable quotes on the theme's dark ground (B588 PR 3). The solid ground
 * carries the contrast; the animated canvas gradient is not part of this
 * best-effort composition. Copy and pictures come from the semantic projection,
 * one quote at a time so each quote keeps its own attribution and portraits.
 */
import { curlyQuote } from '../../shared/slide-types/helpers.js';
import {
  displayQuotes,
  quoteFontScale,
} from '../../shared/slide-types/types/quote-slide.js';
import {
  MIN_BODY_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  paragraphRuns,
  placeStandIn,
  slideBlocks,
  textBlockHeight,
  textBlockWidth,
} from './pptx-generic.js';
import { coverCrop, rasterForPptx } from './pptx-image.js';
import { layoutBox, themeTextPt } from './pptx-theme.js';

/** Project one quote as a one-quote slide of the same definition. */
function projectQuote(slide, content, ctx) {
  const projected = slideBlocks({ ...slide, content }, ctx.def, {
    index: ctx.slideNum - 1,
    lang: ctx.docLang,
    slideIds: ctx.slideIds,
  });
  const paragraphs = projected.blocks
    .filter((b) => b.kind === 'text')
    .flatMap((b) => b.paragraphs);
  // The projection identifies the quotation with emphasis; the canvas prints
  // it upright, with curly quotation marks. Attribution follows it.
  const quoteIndex = paragraphs.findIndex((p) =>
    p.lines.some((line) => line.some((run) => run.italic)),
  );
  const quote =
    quoteIndex < 0
      ? ''
      : paragraphs[quoteIndex].lines
          .map((line) => line.map((run) => run.text).join(''))
          .join('\n');
  return {
    quote,
    text: {
      kind: 'text',
      paragraphs: [
        { lines: [[{ text: curlyQuote(quote) }]], level: 0, bullet: null },
      ],
    },
    byline: {
      kind: 'text',
      paragraphs: paragraphs.filter((_, i) => i !== quoteIndex),
    },
    images: projected.blocks.filter((b) => b.kind === 'image'),
  };
}

/**
 * Write a single hero quote or up to three alternating quotes.
 * @param {object} pptx - configured pptxgenjs instance
 * @param {object} slide - stored quote slide
 * @param {object} ctx - native handler context
 * @returns {Promise<{pptxSlide: object, warnings: string[]}>}
 */
export async function composeQuoteSlide(pptx, slide, ctx) {
  const { spec, slideWidth, slideHeight, slideNum } = ctx;
  const content = slide?.content || {};
  const items = displayQuotes(content).map(({ item }) =>
    projectQuote(slide, { ...content, quotes: [item] }, ctx),
  );
  const warnings = [];
  // Quote has no corner logo on the canvas. A bare slide also avoids inheriting
  // the default surface's logo and placeholders on this dark surface.
  const pptxSlide = pptx.addSlide();
  pptxSlide.background = { color: spec.darkBackground };
  const pad = layoutBox('headingBody', 'title').x;
  const multi = items.length > 1;
  const center = !multi && content.quoteAlign === 'center';
  const width = (slideWidth - 2 * pad) * (multi ? 0.74 : 1);
  const gap = (slideWidth * 16) / 1600;
  const itemGap = (slideWidth * 40) / 1600;
  const rowH =
    (slideHeight - 2 * pad - (items.length - 1) * itemGap) / items.length;
  const portraitSize = (slideWidth * (multi ? 64 : 112)) / 1600;
  const portraitGap = (slideWidth * (multi ? 16 : 32)) / 1600;
  const bylinePt = themeTextPt(spec, multi ? 'base' : 'lg');
  const startPt =
    themeTextPt(spec, '4xl') *
    quoteFontScale(
      items.length,
      items.map((item) => item.quote),
    );
  const rows = items.map((item) => {
    const pictureW =
      item.images.length * portraitSize +
      Math.max(0, item.images.length - 1) * gap;
    const bylineW = width - (pictureW ? pictureW + portraitGap : 0);
    const bylineFit = fitSize(
      [item.byline],
      { w: bylineW, h: rowH * 0.4 },
      bylinePt,
      MIN_BODY_PT,
    );
    const bylineH = Math.max(
      item.images.length ? portraitSize : 0,
      item.byline.paragraphs.length
        ? textBlockHeight(item.byline, bylineFit.pt, bylineW)
        : 0,
    );
    const fit = fitSize(
      [item.text],
      { w: width, h: Math.max(0, rowH - bylineH - gap) },
      startPt,
      MIN_BODY_PT,
    );
    if (!fit.fits || !bylineFit.fits)
      warnings.push(
        `Slide ${slideNum}: quote or attribution overflows its box.`,
      );
    return {
      ...item,
      pictureW,
      bylineW,
      bylineH,
      bylinePt: bylineFit.pt,
      pt: fit.pt,
    };
  });
  // The canvas gives all quotes the same scale, even when one is longer.
  const pt = Math.min(...rows.map((row) => row.pt));
  const heights = rows.map(
    (row) =>
      textBlockHeight(row.text, pt, width) +
      (row.bylineH ? gap + row.bylineH : 0),
  );
  const totalH =
    heights.reduce((a, b) => a + b, 0) + (rows.length - 1) * itemGap;
  let y =
    center || rows.length === 3
      ? pad + Math.max(0, (slideHeight - 2 * pad - totalH) / 2)
      : pad;
  for (const [i, row] of rows.entries()) {
    const align = center ? 'center' : multi && i % 2 ? 'right' : 'left';
    const x = align === 'right' ? slideWidth - pad - width : pad;
    const quoteH = textBlockHeight(row.text, pt, width);
    pptxSlide.addText(
      paragraphRuns(row.text.paragraphs, {
        pt,
        color: spec.darkText,
        face: spec.headFont || undefined,
      }),
      {
        x,
        y,
        w: width,
        h: quoteH,
        align,
        valign: 'top',
        margin: 0,
        isTextBox: true,
        ...(i === 0 ? { objectName: POSITIONED_TITLE_NAME } : {}),
      },
    );
    const bylineY =
      !multi && !center ? slideHeight - pad - row.bylineH : y + quoteH + gap;
    const groupTextW =
      center && row.pictureW
        ? Math.min(row.bylineW, textBlockWidth(row.byline, row.bylinePt))
        : row.bylineW;
    const groupX =
      center && row.pictureW
        ? x + (width - row.pictureW - portraitGap - groupTextW) / 2
        : x;
    const pictureX = align === 'right' ? x + width - row.pictureW : groupX;
    const textX =
      align === 'right'
        ? x
        : groupX + (row.pictureW ? row.pictureW + portraitGap : 0);
    if (row.byline.paragraphs.length)
      pptxSlide.addText(
        paragraphRuns(row.byline.paragraphs, {
          pt: row.bylinePt,
          color: spec.darkAccent,
          face: spec.monoFont,
        }),
        {
          x: textX,
          y: bylineY,
          w: groupTextW,
          h: row.bylineH,
          align,
          valign: 'mid',
          margin: 0,
          isTextBox: true,
        },
      );
    for (const [j, picture] of row.images.entries()) {
      const box = {
        x: pictureX + j * (portraitSize + gap),
        y: bylineY,
        w: portraitSize,
        h: portraitSize,
      };
      const raster = await rasterForPptx(ctx.repoRoot, picture.src, {
        maxPx: { w: 256, h: 256 },
        embedRemote: true,
      });
      if (raster)
        pptxSlide.addImage({
          data: raster.data,
          ...coverCrop(raster, box),
          rounding: true,
          altText: picture.alt,
        });
      else {
        placeStandIn(pptxSlide, picture.alt || picture.src, box, {
          spec: { ...spec, text: spec.darkText },
          pt: MIN_BODY_PT,
        });
        warnings.push(
          `Slide ${slideNum}: portrait ${picture.src} could not be embedded; its alt text stands in.`,
        );
      }
    }
    y =
      rows.length === 2
        ? slideHeight - pad - heights[1]
        : y + heights[i] + itemGap;
  }
  return { pptxSlide, warnings };
}
