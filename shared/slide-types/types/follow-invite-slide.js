import { esc } from '../helpers.js';
import { normalizeLang } from '../../i18n-utils.js';

const COPY = {
  nl: {
    title: 'Volg mee op je telefoon',
    body: 'Scan de QR-code om mee te kijken. Wissel van taal en stel vragen via Q&A.',
    methodScan: 'Scan',
    methodType: 'Of ga naar',
    codeLabel: 'Code',
    followMethodsLabel: 'Meekijk methodes',
    qrCodeLabel: 'QR-code',
    accessCodeLabel: 'Toegangscode',
  },
  'en-GB': {
    title: 'Follow along on your phone',
    body: 'Scan the QR code to follow along. Switch language and submit questions via Q&A.',
    methodScan: 'Scan',
    methodType: 'Or go to',
    codeLabel: 'Code',
    followMethodsLabel: 'Follow along methods',
    qrCodeLabel: 'QR code',
    accessCodeLabel: 'Access code',
  },
};

export default {
  structure: 'chrome',
  // Chrome, so nothing authored to preserve; unlike the payoff this one sits
  // anywhere in the deck rather than at the end, so the neutral prose slide is
  // the tier-1 contract that keeps its place without claiming a closing beat.
  fallback: 'content-slide',
  // `static`: the join code it renders is a render input the session hands
  // over (ctx.followCodes), not state the session keeps for this slide.
  runtime: 'static',
  label: 'Follow-along invite',
  // Deliberately not offered to agents (see server/utils/ai/slide-catalog/
  // agent-catalog.js): the app inserts and maintains this slide itself, right
  // after the title slide, so an agent must never place one. The editor's
  // picker disables insertion for the same reason.
  ai: false,
  // Intentionally no editable fields:
  // - This slide is managed automatically by the server (kept right after title-slide)
  // - Our translation feature only translates fields declared as string/markdown in the slide schema;
  //   leaving `fields` empty ensures it won't "flip" the invite language.
  fields: [],
  defaults: {
    presentationId: '',
    sourceLang: 'nl',
  },
  // Signature must be (content, slide, ctx) – see `shared/slide-types/presentation.js`.
  renderHtml: (content, slide, ctx = {}) => {
    const presId = String(
      content?.presentationId || ''
    ).trim();
    const sourceLang =
      normalizeLang(content?.sourceLang) || 'nl';
    const base = COPY[sourceLang] || COPY.nl;
    const customTitle =
      typeof content?.customTitle === 'string'
        ? content.customTitle.trim()
        : '';
    const customBody =
      typeof content?.customBody === 'string'
        ? content.customBody.trim()
        : '';
    const copy = {
      title: customTitle || base.title,
      body: customBody || base.body,
    };

    const relFollow = presId
      ? `/follow/${encodeURIComponent(
          presId
        )}?lang=${encodeURIComponent(sourceLang)}`
      : '';

    // Get follow codes from context (when available during presentations)
    const followCodes = ctx?.followCodes || {};
    const code =
      sourceLang === 'nl' ? followCodes.nl : followCodes.en;

    const goHref = '/go';

    return `
      <div class="slide slide-bg-lime slide-follow-invite">
        <div class="slide-inner">
          <div class="sfi">
            <div class="sfi-header">
              <div class="sfi-title" dir="auto">${esc(
                copy.title
              )}</div>
              <div class="sfi-body" dir="auto">${esc(copy.body)}</div>
            </div>

            <div class="sfi-methods" role="group" aria-label="${esc(base.followMethodsLabel)}">
              <div class="sfi-card sfi-card-qr on-surface-light">
                <div class="sfi-card-kicker">${esc(
                  base.methodScan
                )}</div>
                <div class="sfi-qr-wrap">
                  <canvas class="sfi-qr" data-follow-qr="1" data-follow-url="${esc(
                    relFollow
                  )}" role="img" aria-label="${esc(base.qrCodeLabel)}"></canvas>
                </div>
              </div>

              <div class="sfi-card sfi-card-code on-surface-light">
                <div class="sfi-card-kicker">${esc(
                  base.methodType
                )}</div>
                <div class="sfi-go" data-follow-go-url="1">${esc(
                  goHref
                )}</div>
                <div class="sfi-code-row">
                  <div class="sfi-row-label">${esc(
                    base.codeLabel
                  )}</div>
                  <div class="sfi-code" aria-label="${esc(base.accessCodeLabel)}">${esc(
                    code || '----'
                  )}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `.trim();
  },
};