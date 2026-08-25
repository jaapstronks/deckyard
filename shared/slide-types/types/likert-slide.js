import {
  bgClass,
  escapeHtml,
  liveInteractionOptions,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';
import { sharedOption } from '../../ui-i18n-keys.js';

export default {
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'live',
  interaction: 'likert',
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
      // The `options[]` array every live type carries — see
      // shared/slide-types/runtime.js § the live content contract. `ordered`
      // because a scale IS its order: "disagree" sits between "strongly
      // disagree" and "neutral", which is what the axis draws and what the
      // reader projects as an <ol>. Ten is the ceiling the vote store clamps
      // to (`MAX_OPTIONS`, server/storage/interaction-slides.js).
      key: 'options',
      label: 'Scale labels',
      type: 'items',
      ordered: true,
      required: true,
      minItems: 2,
      maxItems: 10,
      itemDefaults: { text: '' },
      itemFields: [
        {
          key: 'text',
          label: 'Label',
          type: 'string',
          required: true,
          maxLength: 120,
        },
      ],
    },
    BACKGROUND_FIELD,
    {
      key: 'onClose',
      label: 'When closed',
      labelKey: 'editor.slideField.onClose.label',
      type: 'enum',
      required: false,
      options: [
        sharedOption(
          'editor.slideField.onClose.option.stay',
          'stay',
          'Stay on slide',
        ),
        sharedOption(
          'editor.slideField.onClose.option.next',
          'next',
          'Go to next slide',
        ),
        sharedOption(
          'editor.slideField.onClose.option.goto',
          'goto',
          'Go to specific slide',
        ),
      ],
    },
    {
      key: 'onCloseTarget',
      label: 'Target slide ID',
      labelKey: 'editor.slideField.onCloseTarget.label',
      type: 'string',
      required: false,
      maxLength: 100,
      // The condition used to live in prose ("Only used when …"), which meant
      // the form showed a dead control in the other two modes and the reader
      // printed its value as a paragraph. Declared, both surfaces agree; and a
      // slide id is machine data even when the field IS live, hence
      // `presentational`.
      visibleWhen: { field: 'onClose', in: ['goto'] },
      presentational: true,
    },
  ],
  defaultsByLang: {
    nl: {
      question: 'In hoeverre ben je het hiermee eens?',
      options: [
        { text: 'Helemaal mee oneens' },
        { text: 'Mee oneens' },
        { text: 'Neutraal' },
        { text: 'Mee eens' },
        { text: 'Helemaal mee eens' },
      ],
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
    'en-GB': {
      question: 'How much do you agree with this statement?',
      options: [
        { text: 'Strongly disagree' },
        { text: 'Disagree' },
        { text: 'Neutral' },
        { text: 'Agree' },
        { text: 'Strongly agree' },
      ],
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
  },
  // Back-compat fallback
  defaults: {
    question: 'How much do you agree with this statement?',
    options: [
      { text: 'Strongly disagree' },
      { text: 'Disagree' },
      { text: 'Neutral' },
      { text: 'Agree' },
      { text: 'Strongly agree' },
    ],
    background: 'lime',
    onClose: 'stay',
    onCloseTarget: '',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const options = liveInteractionOptions(content);
    const copy = getSlideCopy(ctx?.lang);
    const n = Math.max(2, Math.min(10, options.length || 0));
    const denom = Math.max(1, n - 1);

    const optsHtml = options
      .map(
        (text, i) => `
          <li class="likert-option" data-inline-item="options" data-inline-item-index="${i}">
            <div class="likert-option-inner on-surface-light">
              <span class="likert-num" aria-hidden="true">${i + 1}</span>
              <span class="likert-text" data-inline-field="options.${i}.text" dir="auto">${escapeHtml(text)}</span>
            </div>
          </li>
        `,
      )
      .join('');

    const axisHtml = options
      .map(
        (_text, i) =>
          `<div class="likert-axis-tick" aria-hidden="true" style="--i:${i};">${
            i + 1
          }</div>`,
      )
      .join('');

    return `
      <div class="slide slide-likert ${bg}" data-interaction="likert" data-likert="1" style="--likert-axis-count:${n};--likert-axis-denom:${denom};">
        <div class="slide-inner">
          <h2 class="heading" data-inline-field="question" dir="auto">${escapeHtml(content?.question)}</h2>
          <div class="poll-layout likert-layout">
            <div class="poll-left">
              <ol class="likert-options" aria-label="${escapeHtml(copy.likertScaleLabel)}">
                ${optsHtml}
              </ol>
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
