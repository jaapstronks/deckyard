/** Editable section divider on the theme's dark surface (B588 PR 4). */
import {
  MIN_BODY_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  paragraphRuns,
  slideBlocks,
  textBlockHeight,
} from './pptx-generic.js';
import { layoutBox, themeTextPt } from './pptx-theme.js';

/**
 * Compose the chapter heading and optional subheading as separate text boxes.
 * The canvas gradient moves and cannot be represented by a native PowerPoint
 * background; its dark theme colour preserves the section divider's contrast.
 * @param {object} pptx
 * @param {object} slide
 * @param {object} ctx
 * @returns {Promise<{pptxSlide: object, warnings: string[]}>}
 */
export async function composeChapterTitleSlide(pptx, slide, ctx) {
  const { spec, slideWidth, slideHeight, slideNum } = ctx;
  const content = slide?.content || {};
  const projected = slideBlocks(slide, ctx.def, {
    index: slideNum - 1,
    lang: ctx.docLang,
    slideIds: ctx.slideIds,
  });
  const warnings = [];
  const pptxSlide = pptx.addSlide();
  pptxSlide.background = { color: spec.darkBackground };

  const pad = layoutBox('headingBody', 'title').x;
  const center = content.titleBlockAlign === 'center';
  const align = center ? 'center' : 'left';
  const width = slideWidth - 2 * pad;
  const titleWidth = Math.min(width, (slideWidth * 34) / 52);
  const subtitleWidth = Math.min(width, (slideWidth * 48) / 80);
  const titleX = center ? (slideWidth - titleWidth) / 2 : pad;
  const subtitleX = center ? (slideWidth - subtitleWidth) / 2 : pad;
  const title = projected.heading.visible ? projected.heading.text : '';
  const subtitle = projected.blocks.find((block) => block.kind === 'text');
  const gap = subtitle ? (slideWidth * 24) / 1600 : 0;
  const available = slideHeight - 2 * pad;
  const titleBlock = {
    kind: 'text',
    paragraphs: [{ lines: [[{ text: title }]], level: 0, bullet: null }],
  };
  const subtitleStart = themeTextPt(spec, 'xl');
  const titleStart = themeTextPt(spec, '4xl');
  const subtitleFit = subtitle
    ? fitSize(
        [subtitle],
        { w: subtitleWidth, h: available * 0.38 },
        subtitleStart,
        MIN_BODY_PT,
      )
    : null;
  const subtitlePt = subtitleFit?.pt || 0;
  const subtitleH = subtitle
    ? textBlockHeight(subtitle, subtitlePt, subtitleWidth)
    : 0;
  const titleFit = fitSize(
    [titleBlock],
    { w: titleWidth, h: available - subtitleH - gap },
    titleStart,
    MIN_BODY_PT,
  );
  const titleH = textBlockHeight(titleBlock, titleFit.pt, titleWidth);
  if (!titleFit.fits || (subtitleFit && !subtitleFit.fits))
    warnings.push(
      `Slide ${slideNum}: chapter title or subheading overflows its box.`,
    );
  const groupH = titleH + gap + subtitleH;
  const layout = ['top', 'center', 'bottom'].includes(content.layout)
    ? content.layout
    : 'center';
  const y =
    layout === 'top'
      ? pad
      : layout === 'bottom'
        ? slideHeight - pad - groupH
        : (slideHeight - groupH) / 2;

  pptxSlide.addText(title, {
    x: titleX,
    y,
    w: titleWidth,
    h: titleH,
    fontFace: spec.headFont || undefined,
    fontSize: titleFit.pt,
    color: spec.darkText,
    bold: false,
    align,
    valign: 'top',
    margin: 0,
    isTextBox: true,
    objectName: POSITIONED_TITLE_NAME,
  });
  if (subtitle)
    pptxSlide.addText(
      paragraphRuns(subtitle.paragraphs, {
        pt: subtitlePt,
        color: spec.darkText,
        face: spec.bodyFont || undefined,
      }),
      {
        x: subtitleX,
        y: y + titleH + gap,
        w: subtitleWidth,
        h: subtitleH,
        align,
        valign: 'top',
        margin: 0,
        isTextBox: true,
      },
    );
  return { pptxSlide, warnings };
}
