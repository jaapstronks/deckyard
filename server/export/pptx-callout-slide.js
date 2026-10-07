/** Editable callout: its semantic text inside the canvas' centred frame. */
import { pickTextColorForBg } from '../../shared/color-utils.js';
import {
  resolveSlideBgHex,
  resolveSlideBgTone,
} from '../../shared/slide-surface-tone.js';
import { calloutBodyBand } from '../../shared/slide-types/types/callout-slide/render.js';
import { calloutVariant } from '../../shared/slide-types/types/callout-slide/variants.js';
import {
  MIN_BODY_PT,
  POSITIONED_TITLE_NAME,
  fitSize,
  paragraphRuns,
  slideBlocks,
  textBlockHeight,
} from './pptx-generic.js';
import { layoutBox, themeTextPt, mixPptxColors } from './pptx-theme.js';

const CANVAS_W = 1600;

// The slide-internal status roles in 00-tokens.css have no theme feed. Keep
// their PowerPoint values pinned to that palette, not to brand accents.
const TONES = Object.freeze({
  insight: '2F7A4F',
  warning: 'A5620A',
  definition: '5B4BB8',
  note: '4A5A63',
  tip: '0F766E',
});

function textBlock(paragraphs) {
  return { kind: 'text', paragraphs };
}

/**
 * Write the label, markdown body and optional source as separate editable text
 * boxes. The frame is native PowerPoint geometry; its flat tint is a best-effort
 * stand-in for the canvas' translucent surface and masked Lucide glyph.
 * @returns {Promise<{pptxSlide: object, warnings: string[]}>}
 */
export async function composeCalloutSlide(pptx, slide, ctx) {
  const { spec, theme, slideWidth, slideHeight, slideNum } = ctx;
  const content = slide?.content || {};
  const projected = slideBlocks(slide, ctx.def, {
    index: slideNum - 1,
    lang: ctx.docLang,
    slideIds: ctx.slideIds,
  });
  const paragraphs = projected.blocks
    .filter((block) => block.kind === 'text')
    .flatMap((block) => block.paragraphs);
  const hasSource = Boolean(String(content.source || '').trim());
  const label = textBlock(paragraphs.slice(0, 1));
  const body = textBlock(paragraphs.slice(1, hasSource ? -1 : undefined));
  const source = hasSource ? textBlock(paragraphs.slice(-1)) : null;
  const warnings = [];
  const pptxSlide = pptx.addSlide();
  const ground = resolveSlideBgHex(content, theme) || `#${spec.background}`;
  pptxSlide.background = { color: ground.replace('#', '').toUpperCase() };
  const dark = resolveSlideBgTone(content, theme) === 'dark';
  const text = pickTextColorForBg(ground).replace('#', '').toUpperCase();
  const baseTone = TONES[calloutVariant(content.variant)];
  const tone = dark ? mixPptxColors(baseTone, 'FFFFFF', 0.45) : baseTone;
  const panelFill = mixPptxColors(tone, ground, 0.1);
  const panelEdge = mixPptxColors(tone, ground, 0.24);

  const pad = layoutBox('headingBody', 'title').x;
  const panelW = (slideWidth - 2 * pad) * 0.72;
  const panelX = (slideWidth - panelW) / 2;
  const insetX = (slideWidth * 48) / CANVAS_W;
  const insetY = (slideWidth * 40) / CANVAS_W;
  const gap = (slideWidth * 20) / CANVAS_W;
  const innerW = panelW - 2 * insetX;
  const labelPt = 14 * 0.6 * spec.textScale;
  const sourcePt = 16 * 0.6 * spec.textScale;
  const labelH = textBlockHeight(label, labelPt, innerW);
  const sourceH = source ? textBlockHeight(source, sourcePt, innerW) : 0;
  const maxPanelH = slideHeight - 2 * pad;
  const bodyBox = {
    w: innerW,
    h: maxPanelH - 2 * insetY - labelH - gap - (source ? gap + sourceH : 0),
  };
  const step = { lg: '3xl', md: '2xl', sm: 'xl' }[
    calloutBodyBand(content.body)
  ];
  const fit = fitSize([body], bodyBox, themeTextPt(spec, step), MIN_BODY_PT);
  if (!fit.fits)
    warnings.push(`Slide ${slideNum}: callout body overflows its frame.`);
  const bodyH = textBlockHeight(body, fit.pt, innerW);
  const panelH = Math.min(
    maxPanelH,
    2 * insetY + labelH + gap + bodyH + (source ? gap + sourceH : 0),
  );
  const panelY = (slideHeight - panelH) / 2;
  const barW = (slideWidth * 8) / CANVAS_W;
  pptxSlide.addShape(pptx.ShapeType.roundRect, {
    x: panelX,
    y: panelY,
    w: panelW,
    h: panelH,
    rectRadius: 0.12,
    fill: { color: panelFill },
    line: { color: panelEdge, width: 0.75 },
    objectName: 'Callout frame',
  });
  pptxSlide.addShape(pptx.ShapeType.rect, {
    x: panelX,
    y: panelY,
    w: barW,
    h: panelH,
    fill: { color: tone },
    line: { color: tone, transparency: 100 },
    objectName: 'Callout accent',
  });
  const x = panelX + insetX;
  let y = panelY + insetY;
  pptxSlide.addText(
    paragraphRuns(label.paragraphs, {
      pt: labelPt,
      color: tone,
      face: spec.bodyFont,
    }),
    {
      x,
      y,
      w: innerW,
      h: labelH,
      margin: 0,
      align: 'left',
      valign: 'top',
      isTextBox: true,
      objectName: POSITIONED_TITLE_NAME,
    },
  );
  y += labelH + gap;
  pptxSlide.addText(
    paragraphRuns(body.paragraphs, {
      pt: fit.pt,
      color: text,
      face: spec.bodyFont,
    }),
    {
      x,
      y,
      w: innerW,
      h: Math.min(bodyH, bodyBox.h),
      margin: 0,
      valign: 'top',
      isTextBox: true,
      objectName: 'Callout body',
    },
  );
  if (source) {
    y += Math.min(bodyH, bodyBox.h) + gap;
    pptxSlide.addText(
      paragraphRuns(source.paragraphs, {
        pt: sourcePt,
        color: mixPptxColors(text, ground, 0.7),
        face: spec.bodyFont,
      }),
      {
        x,
        y,
        w: innerW,
        h: sourceH,
        margin: 0,
        valign: 'top',
        isTextBox: true,
        objectName: 'Callout source',
      },
    );
  }
  return { pptxSlide, warnings };
}
