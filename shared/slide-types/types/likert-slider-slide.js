import { bgClass, escapeHtml, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { fillCopy, getSlideCopy } from '../slide-copy.js';

/**
 * The scale the audience rates on, declared once (D131): the canvas draws its
 * ticks and end numbers from it and the reader names both ends with it, so the
 * two cannot say different ranges.
 */
const SCALE = Object.freeze({
  min: 1,
  max: 10,
  minLabelKey: 'minLabel',
  maxLabelKey: 'maxLabel',
});

/** Fill `{min}` / `{max}` in a copy string from the scale (D131: one source). */
const scaleCopy = (text) => fillCopy(text, { min: SCALE.min, max: SCALE.max });

export default {
  structure: 'singleton',
  fallback: 'content-slide',
  runtime: 'live',
  fidelity: { pptx: 'raster' },
  // Same protocol kind as likert-slide: the audience sends a point on a
  // scale. The slider is how it is drawn, not what it collects.
  interaction: 'likert',
  label: 'Likert slider (1–10)',
  scale: SCALE,
  fields: [
    {
      key: 'question',
      role: 'heading',
      label: 'Statement',
      type: 'string',
      required: true,
      maxLength: 200,
    },
    {
      key: 'minLabel',
      label: 'Left label (1)',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'maxLabel',
      label: 'Right label (10)',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      question: 'De inhoud van deze bijeenkomst was relevant voor mij.',
      minLabel: 'Helemaal mee oneens',
      maxLabel: 'Helemaal mee eens',
      background: 'lime',
    },
    'en-GB': {
      question: 'The content of this session was relevant to me.',
      minLabel: 'Strongly disagree',
      maxLabel: 'Strongly agree',
      background: 'lime',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    question: 'The content of this session was relevant to me.',
    minLabel: 'Strongly disagree',
    maxLabel: 'Strongly agree',
    background: 'lime',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const copy = getSlideCopy(ctx?.lang);
    const n = SCALE.max - SCALE.min + 1;
    const denom = n - 1;

    const minLabel = nonEmpty(content?.minLabel);
    const maxLabel = nonEmpty(content?.maxLabel);

    const axisHtml = Array.from(
      { length: n },
      (_t, i) =>
        `<div class="likert-axis-tick" aria-hidden="true" style="--i:${i};">${SCALE.min + i}</div>`,
    ).join('');

    return `
      <div class="slide slide-likert slide-likert-slider ${bg}" data-interaction="likert" data-likert="1" style="--likert-axis-count:${n};--likert-axis-denom:${denom};">
        <div class="slide-inner">
          <h2 class="heading" data-inline-field="question" dir="auto">${escapeHtml(content?.question)}</h2>
          <div class="poll-layout likert-layout">
            <div class="poll-left">
              <div class="likert-slider-scale on-surface-light" aria-label="${escapeHtml(scaleCopy(copy.likertSliderScaleLabel))}">
                <div class="likert-slider-labels">
                  <div class="likert-slider-label">
                    <span class="likert-slider-num" aria-hidden="true">${SCALE.min}</span>
                    <span class="likert-slider-text" data-inline-field="minLabel" dir="auto">${escapeHtml(minLabel || '')}</span>
                  </div>
                  <div class="likert-slider-label is-right">
                    <span class="likert-slider-num" aria-hidden="true">${SCALE.max}</span>
                    <span class="likert-slider-text" data-inline-field="maxLabel" dir="auto">${escapeHtml(maxLabel || '')}</span>
                  </div>
                </div>
                <div class="help likert-slider-help">${escapeHtml(scaleCopy(copy.likertSliderHelp))}</div>
              </div>
            </div>
            <div class="poll-right">
              <div class="poll-results likert-results on-surface-light" aria-label="${escapeHtml(copy.likertResultsLabel)}">
                <div class="poll-results-title">${escapeHtml(copy.likertResultsTitle)}</div>
                <div class="likert-hill" data-likert-hill="1"></div>
                <div class="likert-axis" data-likert-axis="1">${axisHtml}</div>
                <div class="poll-total" data-poll-total="1"></div>
                <div class="help" data-poll-status="1"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
