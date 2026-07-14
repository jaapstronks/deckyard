import { bgClass, esc, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

function optionsFromContent(content) {
  // Keep the source field key with each option so inline-edit paths stay
  // correct even when a middle option is empty.
  const out = [];
  for (let i = 1; i <= 4; i += 1) {
    const key = `option${i}`;
    const v = nonEmpty(content?.[key]);
    if (v) out.push({ key, text: v });
  }
  return out;
}

function letterForIdx(i) {
  return ['A', 'B', 'C', 'D'][i] || '?';
}

export default {
  label: 'Poll',
  fields: [
    {
      key: 'question',
      label: 'Question',
      type: 'string',
      required: true,
      maxLength: 200,
    },
    {
      key: 'option1',
      label: 'Answer A',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'option2',
      label: 'Answer B',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'option3',
      label: 'Answer C',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'option4',
      label: 'Answer D',
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
      // pollId is injected at slide creation time (client + shared newSlide)
      pollId: '',
      question: 'Wat vind jij?',
      option1: 'Optie A',
      option2: 'Optie B',
      option3: '',
      option4: '',
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
    'en-GB': {
      // pollId is injected at slide creation time (client + shared newSlide)
      pollId: '',
      question: 'What do you think?',
      option1: 'Option A',
      option2: 'Option B',
      option3: '',
      option4: '',
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
  },
  // Back-compat fallback
  defaults: {
    // pollId is injected at slide creation time (client + shared newSlide)
    pollId: '',
    question: 'What do you think?',
    option1: 'Option A',
    option2: 'Option B',
    option3: '',
    option4: '',
    background: 'lime',
    onClose: 'stay',
    onCloseTarget: '',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const options = optionsFromContent(content);
    const lang = ctx?.lang || 'nl';
    const copy = getSlideCopy(lang);
    const followCodes =
      ctx && typeof ctx === 'object' ? ctx.followCodes || null : null;
    const joinHelp = followCodes?.nl || followCodes?.en
      ? copy.pollJoinHelpWithCodes
      : copy.pollJoinHelpWithoutCodes;

    const optsHtml = options
      .map(
        (t, i) => `
          <li class="poll-option">
            <div class="poll-option-inner">
              <span class="poll-letter" aria-hidden="true">${letterForIdx(i)}</span>
              <span class="poll-text" data-inline-field="${t.key}" dir="auto">${esc(t.text)}</span>
            </div>
          </li>
        `
      )
      .join('');

    const barsHtml = options
      .map(
        (t, i) => `
          <div class="poll-bar-row" data-poll-bar-row="${i}">
            <div class="poll-bar-name">${esc(letterForIdx(i))}</div>
            <div class="poll-bar-track" aria-hidden="true">
              <div class="poll-bar-fill" data-poll-bar-fill="${i}"></div>
            </div>
            <div class="poll-bar-count">
              <span class="poll-bar-count-num" data-poll-count="${i}">0</span>
              <span class="poll-bar-count-pct" data-poll-pct="${i}">0%</span>
            </div>
          </div>
        `
      )
      .join('');

    const codesHtml =
      followCodes?.nl || followCodes?.en
        ? `
          <div class="help poll-follow-codes">
            <div><strong>NL</strong>: ${esc(followCodes?.nl || '')}</div>
            <div><strong>EN</strong>: ${esc(followCodes?.en || '')}</div>
          </div>
        `
        : '';

    return `
      <div class="slide slide-poll ${bg}" data-interaction="poll">
        <div class="slide-inner">
          <h2 class="heading" data-inline-field="question" dir="auto">${esc(content?.question)}</h2>
          <div class="poll-layout">
            <div class="poll-left">
              <ol class="poll-options poll-options-grid" aria-label="${esc(copy.pollOptionsLabel)}">
                ${optsHtml}
              </ol>
              <div class="poll-results poll-results-main" aria-label="${esc(copy.pollResultsLabel)}">
                <div class="poll-results-title">${esc(copy.pollResultsTitle)}</div>
                <div class="poll-bars" data-poll-bars="1">
                  ${barsHtml}
                </div>
                <div class="poll-total" data-poll-total="1">${esc(copy.pollTotal)} 0</div>
                <div class="help" data-poll-status="1"></div>
              </div>
            </div>
            <div class="poll-right">
              <div class="poll-scan">
                <div class="poll-scan-title">${esc(copy.pollJoinTitle)}</div>
                <div class="help">${esc(joinHelp)}</div>
                ${codesHtml}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
