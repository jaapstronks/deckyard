import { bgClass, escapeHtml, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
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
  structure: 'fixed-collection',
  fallback: 'list-slide',
  runtime: 'live',
  interaction: 'poll',
  // `pollId` addresses the interaction state a live session collects, so two
  // slides must never share one: every copy path re-mints it. Vocabulary and
  // rationale in shared/slide-types/clone.js.
  rekeyOnClone: { pollId: 'fresh-id' },
  label: 'Poll',
  labelField: 'question',
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
    const copy = getSlideCopy(ctx?.lang);
    const followCodes =
      ctx && typeof ctx === 'object' ? ctx.followCodes || null : null;
    const joinHelp =
      followCodes?.nl || followCodes?.en
        ? copy.pollJoinHelpWithCodes
        : copy.pollJoinHelpWithoutCodes;

    const optsHtml = options
      .map(
        (t, i) => `
          <li class="poll-option">
            <div class="poll-option-inner on-surface-light">
              <span class="poll-letter" aria-hidden="true">${letterForIdx(i)}</span>
              <span class="poll-text" data-inline-field="${t.key}" dir="auto">${escapeHtml(t.text)}</span>
            </div>
          </li>
        `,
      )
      .join('');

    const barsHtml = options
      .map(
        (t, i) => `
          <div class="poll-bar-row" data-poll-bar-row="${i}">
            <div class="poll-bar-name">${escapeHtml(letterForIdx(i))}</div>
            <div class="poll-bar-track" aria-hidden="true">
              <div class="poll-bar-fill" data-poll-bar-fill="${i}"></div>
            </div>
            <div class="poll-bar-count">
              <span class="poll-bar-count-num" data-poll-count="${i}">0</span>
              <span class="poll-bar-count-pct" data-poll-pct="${i}">0%</span>
            </div>
          </div>
        `,
      )
      .join('');

    const codesHtml =
      followCodes?.nl || followCodes?.en
        ? `
          <div class="help poll-follow-codes">
            <div><strong>NL</strong>: ${escapeHtml(followCodes?.nl || '')}</div>
            <div><strong>EN</strong>: ${escapeHtml(followCodes?.en || '')}</div>
          </div>
        `
        : '';

    return `
      <div class="slide slide-poll ${bg}" data-interaction="poll">
        <div class="slide-inner">
          <h2 class="heading" data-inline-field="question" dir="auto">${escapeHtml(content?.question)}</h2>
          <div class="poll-layout">
            <div class="poll-left">
              <ol class="poll-options poll-options-grid" aria-label="${escapeHtml(copy.pollOptionsLabel)}">
                ${optsHtml}
              </ol>
              <div class="poll-results on-surface-light" aria-label="${escapeHtml(copy.pollResultsLabel)}">
                <div class="poll-results-title">${escapeHtml(copy.pollResultsTitle)}</div>
                <div class="poll-bars" data-poll-bars="1">
                  ${barsHtml}
                </div>
                <div class="poll-total" data-poll-total="1">${escapeHtml(copy.pollTotal)} 0</div>
                <div class="help" data-poll-status="1"></div>
              </div>
            </div>
            <div class="poll-right">
              <div class="poll-scan on-surface-light">
                <div class="poll-scan-title">${escapeHtml(copy.pollJoinTitle)}</div>
                <div class="help">${escapeHtml(joinHelp)}</div>
                ${codesHtml}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
