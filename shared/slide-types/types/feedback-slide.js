import { bgClass, escapeHtml, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

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
    const relFollowNl = presId
      ? `/follow/${encodeURIComponent(presId)}?lang=nl`
      : '';
    const relFollowEn = presId
      ? `/follow/${encodeURIComponent(presId)}?lang=en-GB`
      : '';

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
                <div class="sfi-card-kicker">${escapeHtml(copy.feedbackScan)}</div>
                <div class="sfi-qr-wrap">
                  <canvas class="sfi-qr" data-follow-qr="1" data-follow-url="${escapeHtml(
                    relFollowNl || relFollowEn,
                  )}" role="img" aria-label="${escapeHtml(copy.feedbackQrCodeLabel)}"></canvas>
                </div>
              </div>

              <div class="sfi-card on-surface-light">
                <div class="sfi-card-kicker">${escapeHtml(copy.feedbackOrGoTo)}</div>
                <div class="sfi-go" data-follow-go-url="1">/go</div>
                <div class="sfi-code-row">
                  <div class="sfi-row-label">NL</div>
                  <div class="sfi-code" aria-label="${escapeHtml(copy.feedbackAccessCodeNlLabel)}">${escapeHtml(
                    followCodes?.nl || '----',
                  )}</div>
                </div>
                <div class="sfi-code-row">
                  <div class="sfi-row-label">EN</div>
                  <div class="sfi-code" aria-label="${escapeHtml(copy.feedbackAccessCodeEnLabel)}">${escapeHtml(
                    followCodes?.en || '----',
                  )}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
