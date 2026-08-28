import {
  bgClass,
  escapeHtml,
  liveInteractionOptions,
  BACKGROUND_FIELD,
  ON_CLOSE_FIELD,
  ON_CLOSE_TARGET_FIELD,
} from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

function letterForIdx(i) {
  return ['A', 'B', 'C', 'D'][i] || '?';
}

export default {
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'live',
  interaction: 'poll',
  // `pollId` addresses the interaction state a live session collects, so two
  // slides must never share one: every copy path re-mints it. Vocabulary and
  // rationale in shared/slide-types/instance-keys.js.
  instanceKeys: { pollId: 'fresh-id' },
  label: 'Poll',
  labelField: 'question',
  fields: [
    {
      key: 'question',
      label: 'Question',
      labelKey: 'editor.slideField.question.label',
      type: 'string',
      required: true,
      maxLength: 200,
    },
    {
      // The `options[]` array every live type carries — see
      // shared/slide-types/runtime.js § the live content contract. Two to four:
      // the renderer letters them A..D, so a fifth has no name.
      key: 'options',
      label: 'Answers',
      type: 'items',
      required: true,
      minItems: 2,
      maxItems: 4,
      itemDefaults: { text: '' },
      itemFields: [
        {
          key: 'text',
          label: 'Answer',
          type: 'string',
          required: true,
          maxLength: 120,
        },
      ],
    },
    BACKGROUND_FIELD,
    ON_CLOSE_FIELD,
    ON_CLOSE_TARGET_FIELD,
  ],
  defaultsByLang: {
    nl: {
      // pollId is injected at slide creation time (client + shared newSlide)
      pollId: '',
      question: 'Wat vind jij?',
      options: [{ text: 'Optie A' }, { text: 'Optie B' }],
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
    'en-GB': {
      // pollId is injected at slide creation time (client + shared newSlide)
      pollId: '',
      question: 'What do you think?',
      options: [{ text: 'Option A' }, { text: 'Option B' }],
      background: 'lime',
      onClose: 'stay',
      onCloseTarget: '',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    // pollId is injected at slide creation time (client + shared newSlide)
    pollId: '',
    question: 'What do you think?',
    options: [{ text: 'Option A' }, { text: 'Option B' }],
    background: 'lime',
    onClose: 'stay',
    onCloseTarget: '',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const options = liveInteractionOptions(content);
    const copy = getSlideCopy(ctx?.lang);
    const followCodes =
      ctx && typeof ctx === 'object' ? ctx.followCodes || null : null;
    const joinHelp =
      followCodes?.nl || followCodes?.en
        ? copy.pollJoinHelpWithCodes
        : copy.pollJoinHelpWithoutCodes;

    const optsHtml = options
      .map(
        (text, i) => `
          <li class="poll-option" data-inline-item="options" data-inline-item-index="${i}">
            <div class="poll-option-inner on-surface-light">
              <span class="poll-letter" aria-hidden="true">${letterForIdx(i)}</span>
              <span class="poll-text" data-inline-field="options.${i}.text" dir="auto">${escapeHtml(text)}</span>
            </div>
          </li>
        `,
      )
      .join('');

    const barsHtml = options
      .map(
        (_text, i) => `
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
            <div><strong>NL</strong>: <span data-follow-code="nl">${escapeHtml(followCodes?.nl || '')}</span></div>
            <div><strong>EN</strong>: <span data-follow-code="en">${escapeHtml(followCodes?.en || '')}</span></div>
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
