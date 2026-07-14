import { bgClass, esc, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

export default {
  label: 'Likert slider (1–10)',
  fields: [
    {
      key: 'question',
      label: 'Stelling / Statement',
      type: 'string',
      required: true,
      maxLength: 200,
    },
    {
      key: 'minLabel',
      label: 'Label links (1)',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'maxLabel',
      label: 'Label rechts (10)',
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
  // Back-compat fallback
  defaults: {
    question: 'The content of this session was relevant to me.',
    minLabel: 'Strongly disagree',
    maxLabel: 'Strongly agree',
    background: 'lime',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const lang = ctx?.lang || 'nl';
    const copy = getSlideCopy(lang);
    const n = 10;
    const denom = 9;

    const minLabel = nonEmpty(content?.minLabel);
    const maxLabel = nonEmpty(content?.maxLabel);

    const axisHtml = Array.from({ length: n }, (_t, i) =>
      `<div class="likert-axis-tick" aria-hidden="true" style="--i:${i};">${i + 1}</div>`
    ).join('');

    return `
      <div class="slide slide-likert slide-likert-slider ${bg}" data-interaction="likert" data-likert="1" style="--likert-axis-count:${n};--likert-axis-denom:${denom};">
        <div class="slide-inner">
          <h2 class="heading" data-inline-field="question" dir="auto">${esc(content?.question)}</h2>
          <div class="poll-layout likert-layout">
            <div class="poll-left">
              <div class="likert-slider-scale" aria-label="${esc(copy.likertSliderScaleLabel)}">
                <div class="likert-slider-labels">
                  <div class="likert-slider-label">
                    <span class="likert-slider-num" aria-hidden="true">1</span>
                    <span class="likert-slider-text" data-inline-field="minLabel" dir="auto">${esc(minLabel || '')}</span>
                  </div>
                  <div class="likert-slider-label is-right">
                    <span class="likert-slider-num" aria-hidden="true">10</span>
                    <span class="likert-slider-text" data-inline-field="maxLabel" dir="auto">${esc(maxLabel || '')}</span>
                  </div>
                </div>
                <div class="help likert-slider-help">${esc(copy.likertSliderHelp)}</div>
              </div>
            </div>
            <div class="poll-right">
              <div class="poll-results poll-results-main likert-results" aria-label="${esc(copy.likertResultsLabel)}">
                <div class="poll-results-title">${esc(copy.likertResultsTitle)}</div>
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
