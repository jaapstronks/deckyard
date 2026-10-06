/** Editable comparison: two independent columns with their semantic treatment. */
import { pickTextColorForBg } from '../../shared/color-utils.js';
import {
  resolveSlideBgHex,
  resolveSlideBgTone,
} from '../../shared/slide-surface-tone.js';
import { comparisonVariantClass } from '../../shared/slide-types/types/comparison-slide.js';
import {
  MIN_BODY_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  paragraphRuns,
  slideBlocks,
  textBlockHeight,
  textBlockWidth,
} from './pptx-generic.js';
import { layoutBox, themeTextPt, mixPptxColors } from './pptx-theme.js';

/** Project one field at a time so repeated headings cannot blur column ownership. */
function fieldBlock(slide, key, ctx) {
  const projected = slideBlocks(
    { ...slide, content: { [key]: slide.content?.[key] } },
    ctx.def,
    {
      index: ctx.slideNum - 1,
      lang: ctx.docLang,
      slideIds: ctx.slideIds,
    },
  );
  return {
    kind: 'text',
    paragraphs:
      key === 'title'
        ? projected.heading.visible
          ? [
              {
                lines: [[{ text: projected.heading.text }]],
                level: 0,
                bullet: null,
              },
            ]
          : []
        : projected.blocks
            .filter((b) => b.kind === 'text')
            .flatMap((b) => b.paragraphs),
  };
}

/**
 * Keep headings, markdown, verdict and divider editable. Flat colours stand in
 * for translucent canvas roles; the normal text fit budget owns overflow.
 * @returns {Promise<{pptxSlide: object, warnings: string[]}>}
 */
export async function composeComparisonSlide(pptx, slide, ctx) {
  const { spec, theme, slideWidth, slideHeight, slideNum } = ctx;
  const content = slide.content || {};
  const variant = comparisonVariantClass(content.variant);
  const before = variant.endsWith('--before-after');
  const pros = variant.endsWith('--pros-cons');
  const tradeoff = variant.endsWith('--tradeoff');
  const ground = resolveSlideBgHex(content, theme) || `#${spec.background}`;
  const dark = resolveSlideBgTone(content, theme) === 'dark';
  const ink = pickTextColorForBg(ground).slice(1).toUpperCase();
  const muted = mixPptxColors(ink, ground, 0.65);
  const pptxSlide = pptx.addSlide();
  pptxSlide.background = { color: ground.slice(1).toUpperCase() };
  const warnings = [];
  const headingBold = Number(theme?.cssVars?.['--t-heading-weight']) >= 600;
  const px = (value) => (slideWidth * value) / 1600;
  const pad = layoutBox('headingBody', 'title').x;
  const width = slideWidth - 2 * pad;
  const blocks = Object.fromEntries(
    [
      'title',
      'subheading',
      'bottomSubheading',
      'leftTitle',
      'leftBody',
      'rightTitle',
      'rightBody',
      'verdict',
    ].map((key) => [key, fieldBlock(slide, key, ctx)]),
  );
  const has = (key) => blocks[key].paragraphs.length > 0;
  function put(key, box, pt, color, options = {}, marker) {
    if (!has(key)) return 0;
    const fit = fitSize([blocks[key]], box, pt, Math.min(pt, MIN_BODY_PT));
    if (!fit.fits)
      warnings.push(`Slide ${slideNum}: comparison ${key} overflows its box.`);
    const h = Math.min(box.h, textBlockHeight(blocks[key], fit.pt, box.w));
    const runs = paragraphRuns(blocks[key].paragraphs, {
      pt: fit.pt,
      color,
      face: options.fontFace || spec.bodyFont,
    });
    if (tradeoff && key.endsWith('Title'))
      for (const run of runs) run.text = run.text.toUpperCase();
    if (marker)
      for (const run of runs) {
        const bullet = run.options.bullet;
        if (bullet?.characterCode && !run.options.indentLevel)
          bullet.characterCode = marker;
      }
    pptxSlide.addText(runs, {
      ...box,
      h,
      margin: 0,
      valign: 'top',
      align: 'left',
      isTextBox: true,
      objectName: `Comparison ${key}`,
      ...options,
    });
    return h;
  }
  let top = pad;
  top += put(
    'title',
    { x: pad, y: top, w: width, h: px(140) },
    themeTextPt(spec, '2xl'),
    ink,
    {
      fontFace: spec.headFont,
      bold: headingBold,
      objectName: POSITIONED_TITLE_NAME,
    },
  );
  if (has('subheading')) {
    if (has('title')) top += px(8);
    top += put(
      'subheading',
      { x: pad, y: top, w: width, h: px(100) },
      themeTextPt(spec, 'lg'),
      muted,
    );
  }
  if (has('title') || has('subheading')) top += px(24);
  const bottomH = has('bottomSubheading') ? px(100) : 0;
  const verdictPt = themeTextPt(spec, 'base');
  const verdictW = has('verdict')
    ? Math.min(width, textBlockWidth(blocks.verdict, verdictPt) + px(48))
    : 0;
  const verdictH = has('verdict')
    ? textBlockHeight(blocks.verdict, verdictPt, verdictW - px(32)) + px(24)
    : 0;
  const bottom = slideHeight - pad - bottomH - (bottomH ? px(16) : 0);
  const splitBottom = bottom - verdictH - (verdictH ? px(20) : 0);
  pptxSlide.addShape(pptx.ShapeType.line, {
    x: slideWidth / 2,
    y: top + px(12),
    w: 0,
    h: Math.max(px(1), splitBottom - top - px(24)),
    line: {
      color: ink,
      transparency: 85,
      width: (tradeoff ? 1 : before ? 2 : 3) * 0.6,
    },
    objectName: 'Comparison divider',
  });
  if (before)
    pptxSlide.addShape(pptx.ShapeType.chevron, {
      x: slideWidth / 2 - px(12),
      y: (top + splitBottom) / 2 - px(12),
      w: px(24),
      h: px(24),
      fill: { color: muted },
      line: { color: muted, transparency: 100 },
      objectName: 'Comparison direction',
    });
  const colW = width / 2 - px(40);
  const titlePt = tradeoff
    ? 14 * 0.6 * spec.textScale
    : themeTextPt(spec, '2xl');
  // Equal title rows keep the bodies aligned even when only one title wraps.
  const titleH = Math.min(
    px(170),
    Math.max(
      ...['leftTitle', 'rightTitle'].map((key) =>
        has(key) ? textBlockHeight(blocks[key], titlePt, colW) : 0,
      ),
    ),
  );
  for (const [index, side] of ['left', 'right'].entries()) {
    const x = index ? slideWidth / 2 + px(40) : pad;
    const color = before && index === 0 ? muted : ink;
    // Same semantic positive/danger roles as the comparison canvas.
    const tone = index ? 'B54D4D' : '2F7A4F';
    const headingColor = pros
      ? dark
        ? mixPptxColors(tone, 'FFFFFF', 0.45)
        : tone
      : tradeoff
        ? muted
        : color;
    put(
      `${side}Title`,
      { x, y: top + px(24), w: colW, h: titleH },
      titlePt,
      headingColor,
      tradeoff
        ? { charSpacing: titlePt * 0.08 }
        : { fontFace: spec.headFont, bold: headingBold },
    );
    const bodyY = top + px(24) + titleH + (titleH ? px(20) : 0);
    put(
      `${side}Body`,
      {
        x,
        y: bodyY,
        w: colW,
        h: Math.max(px(1), splitBottom - bodyY - px(24)),
      },
      themeTextPt(spec, 'md'),
      color,
      {},
      pros ? (index ? '2717' : '2713') : null,
    );
  }
  if (has('verdict')) {
    const x = (slideWidth - verdictW) / 2;
    const y = bottom - verdictH;
    const fill = dark ? spec.darkAccent : spec.accent;
    pptxSlide.addShape(pptx.ShapeType.roundRect, {
      x,
      y,
      w: verdictW,
      h: verdictH,
      rectRadius: 0.12,
      fill: { color: fill },
      line: { color: fill, transparency: 100 },
      objectName: 'Comparison verdict badge',
    });
    put(
      'verdict',
      {
        x: x + px(16),
        y: y + px(12),
        w: verdictW - px(32),
        h: verdictH - px(24),
      },
      verdictPt,
      pickTextColorForBg(fill).slice(1).toUpperCase(),
      { align: 'center' },
    );
  }
  if (bottomH)
    put(
      'bottomSubheading',
      { x: pad, y: slideHeight - pad - bottomH, w: width, h: bottomH },
      themeTextPt(spec, 'lg'),
      muted,
    );
  return { pptxSlide, warnings };
}
