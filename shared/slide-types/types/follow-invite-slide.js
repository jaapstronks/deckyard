import { escapeHtml } from '../helpers.js';
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
  // `presentationId` caches which deck this slide invites people into (the QR
  // code is built from it), so a copy into another deck has to re-point it.
  // Vocabulary and rationale in shared/slide-types/clone.js.
  rekeyOnClone: { presentationId: 'presentation-id' },
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
  // No `sourceLang`/`targetLang`: the invite's language is the language of the
  // version it is rendered in, and the render context already knows that
  // (`ctx.lang`, supplied by `resolveDeckLang()` at every call site). Storing it
  // per version made it possible for the stored value and the version to
  // disagree — divergence with no authority behind it. See
  // docs/plans/briefs/collab-codec-per-language-fields.md.
  defaults: {
    presentationId: '',
  },
  // Signature must be (content, slide, ctx) – see `shared/slide-types/presentation.js`.
  renderHtml: (content, slide, ctx = {}) => {
    const presId = String(content?.presentationId || '').trim();
    // Derived, never read from the slide: this is the invite for *this* version.
    const lang = normalizeLang(ctx?.lang) || 'nl';
    const base = COPY[lang] || COPY.nl;
    const customTitle =
      typeof content?.customTitle === 'string'
        ? content.customTitle.trim()
        : '';
    const customBody =
      typeof content?.customBody === 'string' ? content.customBody.trim() : '';
    const copy = {
      title: customTitle || base.title,
      body: customBody || base.body,
    };

    const relFollow = presId
      ? `/follow/${encodeURIComponent(presId)}?lang=${encodeURIComponent(lang)}`
      : '';

    // Get follow codes from context (when available during presentations)
    const followCodes = ctx?.followCodes || {};
    const code = lang === 'nl' ? followCodes.nl : followCodes.en;

    const goHref = '/go';

    return `
      <div class="slide slide-bg-lime slide-follow-invite">
        <div class="slide-inner">
          <div class="sfi">
            <div>
              <div class="sfi-title" dir="auto">${escapeHtml(copy.title)}</div>
              <div class="sfi-body" dir="auto">${escapeHtml(copy.body)}</div>
            </div>

            <div class="sfi-methods" role="group" aria-label="${escapeHtml(base.followMethodsLabel)}">
              <div class="sfi-card on-surface-light">
                <div class="sfi-card-kicker">${escapeHtml(
                  base.methodScan,
                )}</div>
                <div class="sfi-qr-wrap">
                  <canvas class="sfi-qr" data-follow-qr="1" data-follow-url="${escapeHtml(
                    relFollow,
                  )}" role="img" aria-label="${escapeHtml(base.qrCodeLabel)}"></canvas>
                </div>
              </div>

              <div class="sfi-card on-surface-light">
                <div class="sfi-card-kicker">${escapeHtml(
                  base.methodType,
                )}</div>
                <div class="sfi-go" data-follow-go-url="1">${escapeHtml(
                  goHref,
                )}</div>
                <div class="sfi-code-row">
                  <div class="sfi-row-label">${escapeHtml(base.codeLabel)}</div>
                  <div class="sfi-code" aria-label="${escapeHtml(base.accessCodeLabel)}">${escapeHtml(
                    code || '----',
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
