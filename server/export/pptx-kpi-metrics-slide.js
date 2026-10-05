/** Editable KPI cards: the value and unit remain one reading in each card. */
import {
  resolveSlideBgHex,
  resolveSlideBgTone,
} from '../../shared/slide-surface-tone.js';
import {
  displayMetrics,
  parseNoteTone,
} from '../../shared/slide-types/types/kpi-metrics-slide.js';
import {
  MIN_BODY_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  slideBlocks,
  textBlockHeight,
} from './pptx-generic.js';
import { PPTX_LAYOUTS, layoutBox, themeTextPt } from './pptx-theme.js';

const CANVAS_W = 1600;

/** A plain block for the existing line-budget calculator. */
function textBlock(text) {
  return {
    kind: 'text',
    paragraphs: [{ lines: [[{ text }]], level: 0, bullet: null }],
  };
}

/** Match the canvas grid: one centered card, two or three columns, or 2×2. */
function cardBoxes(count, { width, top, bottom, pad }) {
  const gap = (width * 24) / CANVAS_W;
  const availableW = width - 2 * pad;
  const availableH = bottom - top;
  if (count === 1) {
    const w = Math.min((width * 980) / CANVAS_W, availableW * 0.7);
    const h = Math.min(availableH, (width * 420) / CANVAS_W);
    return [{ x: (width - w) / 2, y: top + (availableH - h) / 2, w, h }];
  }
  const columns = count === 4 ? 2 : count;
  const rows = count === 4 ? 2 : 1;
  const w = (availableW - (columns - 1) * gap) / columns;
  const h =
    count === 4
      ? (availableH - gap) / 2
      : Math.min(availableH, (width * (count === 2 ? 320 : 300)) / CANVAS_W);
  const firstY = rows === 1 ? top + (availableH - h) / 2 : top;
  return Array.from({ length: count }, (_, index) => ({
    x: pad + (index % columns) * (w + gap),
    y: firstY + Math.floor(index / columns) * (h + gap),
    w,
    h,
  }));
}

/** Write a theme-coloured editable text box and report an actual fit failure. */
function addFittedText(pptxSlide, text, box, options, warnings, slideNum) {
  if (!text) return 0;
  const block = textBlock(text);
  const fit = fitSize(
    [block],
    box,
    options.fontSize,
    options.minPt || MIN_BODY_PT,
  );
  if (!fit.fits)
    warnings.push(`Slide ${slideNum}: KPI text overflows its box.`);
  const h = Math.min(box.h, textBlockHeight(block, fit.pt, box.w));
  pptxSlide.addText(text, {
    ...box,
    h,
    ...options,
    fontSize: fit.pt,
    margin: 0,
    valign: 'top',
    isTextBox: true,
  });
  return h;
}

/**
 * Put each metric's number, unit, label and note inside its own editable card.
 * The canvas animates count-up and uses translucent surfaces; the PPTX keeps
 * their static final values and theme colours.
 * @returns {Promise<{pptxSlide: object, warnings: string[]}>}
 */
export async function composeKpiMetricsSlide(pptx, slide, ctx) {
  const { spec, theme, slideWidth, slideHeight, slideNum } = ctx;
  const content = slide?.content || {};
  const metrics = displayMetrics(content);
  const warnings = [];
  const pptxSlide = pptx.addSlide({ masterName: PPTX_LAYOUTS.headingBody });
  const ground = resolveSlideBgHex(content, theme);
  if (ground) pptxSlide.background = { color: ground.slice(1).toUpperCase() };
  const dark = resolveSlideBgTone(content, theme) === 'dark';
  const color = dark ? spec.darkText : spec.text;
  const muted = dark ? spec.darkText : spec.textMuted;
  const pad = layoutBox('headingBody', 'title').x;
  const width = slideWidth - 2 * pad;
  const centerHeader = content.headerAlign === 'center';
  const headerAlign = centerHeader ? 'center' : 'left';
  const projected = slideBlocks(slide, ctx.def, {
    index: slideNum - 1,
    lang: ctx.docLang,
    slideIds: ctx.slideIds,
  });
  const title = projected.heading.visible ? projected.heading.text : '';
  let headerY = pad;
  headerY += addFittedText(
    pptxSlide,
    title,
    { x: pad, y: headerY, w: width, h: slideHeight * 0.14 },
    {
      fontSize: themeTextPt(spec, '3xl'),
      color,
      fontFace: spec.headFont || undefined,
      align: headerAlign,
      objectName: POSITIONED_TITLE_NAME,
    },
    warnings,
    slideNum,
  );
  const subheading = String(content.subheading || '').trim();
  if (subheading) {
    headerY += (slideWidth * 10) / CANVAS_W;
    headerY += addFittedText(
      pptxSlide,
      subheading,
      { x: pad, y: headerY, w: width, h: slideHeight * 0.1 },
      { fontSize: themeTextPt(spec, 'lg'), color: muted, align: headerAlign },
      warnings,
      slideNum,
    );
  }
  const bottomText = String(content.bottomSubheading || '').trim();
  const bottomH = bottomText ? slideHeight * 0.1 : 0;
  if (bottomText)
    addFittedText(
      pptxSlide,
      bottomText,
      { x: pad, y: slideHeight - pad - bottomH, w: width, h: bottomH },
      { fontSize: themeTextPt(spec, 'lg'), color: muted },
      warnings,
      slideNum,
    );
  const gridTop = Math.max(
    headerY + (slideWidth * 40) / CANVAS_W,
    slideHeight * 0.22,
  );
  const gridBottom = slideHeight - pad - bottomH - (bottomText ? 0.12 : 0);
  const boxes = cardBoxes(metrics.length, {
    width: slideWidth,
    top: gridTop,
    bottom: gridBottom,
    pad,
  });
  for (const [index, metric] of metrics.entries()) {
    const value = metric.value || '0';
    const label = metric.label || 'Label';
    const box = boxes[index];
    const inset = (slideWidth * (metrics.length === 1 ? 64 : 24)) / CANVAS_W;
    const inner = { x: box.x + inset, y: box.y + inset, w: box.w - 2 * inset };
    const accent = index === 0 && content.accent !== 'none';
    const border = accent
      ? content.accent === 'highlight-risk'
        ? 'B54D4D'
        : spec.darkAccent
      : muted;
    pptxSlide.addShape(pptx.ShapeType.roundRect, {
      ...box,
      rectRadius: 0.12,
      fill: { color: 'FFFFFF', transparency: 55 },
      line: { color: border, transparency: accent ? 15 : 72, width: 0.8 },
      objectName: `KPI ${index + 1} card`,
    });

    const numberStart =
      (metrics.length === 1 ? 132 : metrics.length === 4 ? 96 : 98) *
      0.6 *
      spec.textScale;
    const unitStart = (metrics.length === 1 ? 54 : 40) * 0.6 * spec.textScale;
    const numberBlock = textBlock(
      `${value}${metric.unit ? ` ${metric.unit}` : ''}`,
    );
    const numberH = Math.min(box.h * 0.35, (slideHeight * 1.2) / 7.5);
    const numberFit = fitSize(
      [numberBlock],
      { w: inner.w, h: numberH },
      numberStart,
      MIN_BODY_PT,
    );
    if (!numberFit.fits)
      warnings.push(
        `Slide ${slideNum}: KPI ${index + 1} value overflows its card.`,
      );
    const numberPt = numberFit.pt;
    pptxSlide.addText(
      [
        { text: value, options: { fontSize: numberPt, color } },
        ...(metric.unit
          ? [
              {
                text: ` ${metric.unit}`,
                options: {
                  fontSize: Math.min(unitStart, numberPt * 0.65),
                  color: muted,
                },
              },
            ]
          : []),
      ],
      {
        x: inner.x,
        y: inner.y,
        w: inner.w,
        h: numberH,
        margin: 0,
        breakLine: false,
        fontFace: spec.headFont || undefined,
        align: metrics.length === 1 ? 'center' : 'left',
        valign: 'top',
        isTextBox: true,
        objectName: `KPI ${index + 1} value and unit`,
      },
    );
    const labelY = inner.y + numberH + (slideWidth * 8) / CANVAS_W;
    const noteH = metric.note ? Math.min(box.h * 0.18, 0.55) : 0;
    const noteY = box.y + box.h - inset - noteH;
    const labelH = Math.max(0.1, noteY - labelY - (metric.note ? 0.08 : 0));
    addFittedText(
      pptxSlide,
      label,
      { x: inner.x, y: labelY, w: inner.w, h: labelH },
      {
        fontSize: themeTextPt(spec, 'lg'),
        color,
        fontFace: spec.bodyFont || undefined,
        align: metrics.length === 1 ? 'center' : 'left',
        objectName: `KPI ${index + 1} label`,
      },
      warnings,
      slideNum,
    );
    if (metric.note) {
      const { highlight, rest, tone } = parseNoteTone(metric.note);
      if (metrics.length > 1)
        pptxSlide.addShape(pptx.ShapeType.line, {
          x: inner.x,
          y: noteY - 0.08,
          w: inner.w,
          h: 0,
          line: { color: muted, transparency: 70, width: 0.5 },
        });
      const noteFit = fitSize(
        [textBlock(metric.note)],
        { w: inner.w, h: noteH },
        themeTextPt(spec, 'base'),
        10,
      );
      if (!noteFit.fits)
        warnings.push(
          `Slide ${slideNum}: KPI ${index + 1} note overflows its card.`,
        );
      pptxSlide.addText(
        highlight
          ? [
              {
                text: highlight,
                options: {
                  color: tone === 'danger' ? 'B54D4D' : spec.darkAccent,
                },
              },
              { text: rest ? ` ${rest}` : '', options: { color: muted } },
            ]
          : metric.note,
        {
          x: inner.x,
          y: noteY,
          w: inner.w,
          h: noteH,
          margin: 0,
          fontSize: noteFit.pt,
          color: muted,
          fontFace: spec.monoFont,
          align: metrics.length === 1 ? 'center' : 'left',
          valign: 'top',
          isTextBox: true,
          objectName: `KPI ${index + 1} note`,
        },
      );
    }
  }
  return { pptxSlide, warnings };
}
