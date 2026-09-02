import { bgClass, escapeHtml, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';
import {
  DEFAULT_DECK_LANG,
  getLangDisplayName,
  normalizeLang,
} from '../../i18n-utils.js';

export default {
  structure: 'singleton',
  fallback: 'content-slide',
  runtime: 'live',
  interaction: 'feedback',
  label: 'Feedback',
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
      key: 'placeholder',
      label: 'Placeholder',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      question: 'Wat wil je ons meegeven?',
      placeholder: 'Typ je feedback…',
      background: 'lime',
    },
    'en-GB': {
      question: 'Any feedback for us?',
      placeholder: 'Type your feedback…',
      background: 'lime',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    question: 'Any feedback for us?',
    placeholder: 'Type your feedback…',
    background: 'lime',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const copy = getSlideCopy(ctx?.lang);
    const followCodes =
      ctx && typeof ctx === 'object' ? ctx.followCodes || {} : {};
    const presId =
      ctx && typeof ctx === 'object'
        ? String(ctx.presentationId || '').trim()
        : '';
    // The QR points at the version being shown, not at a fixed Dutch-then-
    // English pair: a German audience scanning it lands in German (B182/D72 #6).
    const lang = normalizeLang(ctx?.lang) || DEFAULT_DECK_LANG;
    const relFollow = presId
      ? `/follow/${encodeURIComponent(presId)}?lang=${encodeURIComponent(lang)}`
      : '';
    // One row per code the session minted — one per version the deck has —
    // instead of a hardcoded NL row above an EN one. Outside a session nothing
    // is minted yet, so a single `----` row for the version on screen stands
    // in; `follow-invite-runtime.js` fills it from the QR's follow URL, which
    // points at that same version.
    const minted = Object.entries(followCodes).filter(([, code]) => code);
    const codeRows = minted.length ? minted : [[lang, '----']];

    const question = nonEmpty(content?.question);

    return `
      <div class="slide slide-feedback slide-follow-invite ${bg}" data-interaction="feedback">
        <div class="slide-inner">
          <div class="sfi">
            <div>
              <div class="sfi-title" data-inline-field="question" dir="auto">${escapeHtml(question)}</div>
              <div class="sfi-body">${escapeHtml(copy.feedbackHelp)}</div>
            </div>

            <div class="sfi-methods" role="group" aria-label="${escapeHtml(copy.feedbackMethodsLabel)}">
              <div class="sfi-card on-surface-light">
                <div class="sfi-card-title">${escapeHtml(copy.feedbackScan)}</div>
                <div class="sfi-qr-wrap">
                  <canvas class="sfi-qr" data-follow-qr="1" data-follow-url="${escapeHtml(
                    relFollow,
                  )}" role="img" aria-label="${escapeHtml(copy.feedbackQrCodeLabel)}"></canvas>
                </div>
              </div>

              <div class="sfi-card on-surface-light">
                <div class="sfi-card-title">${escapeHtml(copy.feedbackOrGoTo)}</div>
                <div class="sfi-go" data-follow-go-url="1">/go</div>
                ${codeRows
                  .map(
                    ([codeLang, code]) => `
                <div class="sfi-code-row">
                  <div class="sfi-row-label" lang="${escapeHtml(codeLang)}">${escapeHtml(
                    getLangDisplayName(codeLang),
                  )}</div>
                  <div class="sfi-code" data-follow-code="${escapeHtml(codeLang)}" aria-label="${escapeHtml(
                    `${copy.accessCodeLabel} ${getLangDisplayName(codeLang)}`,
                  )}">${escapeHtml(code)}</div>
                </div>`,
                  )
                  .join('')}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
