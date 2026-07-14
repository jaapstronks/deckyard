import { bgClass, esc, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

function optionsFromContent(content) {
  const c =
    content && typeof content === 'object' ? content : {};
  // Keep the source field key with each option so inline-edit paths stay
  // correct even when a middle option is empty.
  const out = [];
  for (let i = 1; i <= 10; i += 1) {
    const key = `option${i}`;
    const v = nonEmpty(c?.[key]);
    if (v) out.push({ key, text: v });
  }
  return out;
}

export default {
  label: 'Likert (agree/disagree)',
  fields: [
    {
      key: 'question',
      label: 'Vraag / Question',
      type: 'string',
      required: true,
      maxLength: 200,
    },
    {
      key: 'option1',
      label: 'Label 1',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'option2',
      label: 'Label 2',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'option3',
      label: 'Label 3',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option4',
      label: 'Label 4',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option5',
      label: 'Label 5',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option6',
      label: 'Label 6',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option7',
      label: 'Label 7',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option8',
      label: 'Label 8',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option9',
      label: 'Label 9',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option10',
      label: 'Label 10',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    BACKGROUND_FIELD,
    {
      key: 'onClose',
      label: 'When closed',
      type: 'enum',
      required: false,
      options: [
        { value: 'stay', label: 'Stay on slide' },
        { value: 'next', label: 'Go to next slide' },
        { value: 'goto', label: 'Go to specific slide' },
      ],
    },
    {
      key: 'onCloseTarget',
      label: 'Target slide ID',
      type: 'string',
      required: false,
      maxLength: 100,
      helpText: 'Only used when "Go to specific slide" is selected.',
    },
  ],
  defaultsByLang: {
    nl: {
      question: 'In hoeverre ben je het hiermee eens?',
      option1: 'Helemaal mee oneens',
      option2: 'Mee oneens',
      option3: 'Neutraal',
      option4: 'Mee eens',
      option5: 'Helemaal mee eens',
      option6: '',
      option7: '',
      option8: '',
      option9: '',
      option10: '',
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
    'en-GB': {
      question: 'How much do you agree with this statement?',
      option1: 'Strongly disagree',
      option2: 'Disagree',
      option3: 'Neutral',
      option4: 'Agree',
      option5: 'Strongly agree',
      option6: '',
      option7: '',
      option8: '',
      option9: '',
      option10: '',
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
  },
  // Back-compat fallback
  defaults: {
    question: 'How much do you agree with this statement?',
    option1: 'Strongly disagree',
    option2: 'Disagree',
    option3: 'Neutral',
    option4: 'Agree',
    option5: 'Strongly agree',
    option6: '',
    option7: '',
    option8: '',
    option9: '',
    option10: '',
    background: 'lime',
    onClose: 'stay',
    onCloseTarget: '',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const options = optionsFromContent(content);
    const lang = ctx?.lang || 'nl';
    const copy = getSlideCopy(lang);
    const n = Math.max(2, Math.min(10, options.length || 0));
    const denom = Math.max(1, n - 1);

    const optsHtml = options
      .map(
        (t, i) => `
          <li class="likert-option">
            <div class="likert-option-inner">
              <span class="likert-num" aria-hidden="true">${
                i + 1
              }</span>
              <span class="likert-text" data-inline-field="${t.key}" dir="auto">${esc(t.text)}</span>
            </div>
          </li>
        `
      )
      .join('');

    const axisHtml = options
      .map(
        (_t, i) =>
          `<div class="likert-axis-tick" aria-hidden="true" style="--i:${i};">${
            i + 1
          }</div>`
      )
      .join('');

    return `
      <div class="slide slide-likert ${bg}" data-interaction="likert" data-likert="1" style="--likert-axis-count:${n};--likert-axis-denom:${denom};">
        <div class="slide-inner">
          <h2 class="heading" data-inline-field="question" dir="auto">${esc(content?.question)}</h2>
          <div class="poll-layout likert-layout">
            <div class="poll-left">
              <ol class="likert-options" aria-label="${esc(copy.likertScaleLabel)}">
                ${optsHtml}
              </ol>
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