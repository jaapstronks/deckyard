import { bgClass, esc, nonEmpty, BACKGROUND_FIELD } from '../helpers.js';
import { getSlideCopy } from '../slide-copy.js';

export default {
  label: 'Feedback',
  fields: [
    {
      key: 'question',
      label: 'Question',
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
  // Back-compat fallback
  defaults: {
    question: 'Any feedback for us?',
    placeholder: 'Type your feedback…',
    background: 'lime',
  },
  renderHtml: (content, _slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const lang = ctx?.lang || 'nl';
    const copy = getSlideCopy(lang);
    const followCodes = ctx && typeof ctx === 'object' ? ctx.followCodes || {} : {};
    const presId =
      ctx && typeof ctx === 'object' ? String(ctx.presentationId || '').trim() : '';
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
            <div class="sfi-header">
              <div class="sfi-title" data-inline-field="question" dir="auto">${esc(question)}</div>
              <div class="sfi-body">${esc(copy.feedbackHelp)}</div>
            </div>

            <div class="sfi-methods" role="group" aria-label="${esc(copy.feedbackMethodsLabel)}">
              <div class="sfi-card sfi-card-qr">
                <div class="sfi-card-kicker">${esc(copy.feedbackScan)}</div>
                <div class="sfi-qr-wrap">
                  <canvas class="sfi-qr" data-follow-qr="1" data-follow-url="${esc(
                    relFollowNl || relFollowEn
                  )}" role="img" aria-label="${esc(copy.feedbackQrCodeLabel)}"></canvas>
                </div>
              </div>

              <div class="sfi-card sfi-card-code">
                <div class="sfi-card-kicker">${esc(copy.feedbackOrGoTo)}</div>
                <div class="sfi-go" data-follow-go-url="1">/go</div>
                <div class="sfi-code-row">
                  <div class="sfi-row-label">NL</div>
                  <div class="sfi-code" aria-label="${esc(copy.feedbackAccessCodeNlLabel)}">${esc(
                    followCodes?.nl || '----'
                  )}</div>
                </div>
                <div class="sfi-code-row">
                  <div class="sfi-row-label">EN</div>
                  <div class="sfi-code" aria-label="${esc(copy.feedbackAccessCodeEnLabel)}">${esc(
                    followCodes?.en || '----'
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
