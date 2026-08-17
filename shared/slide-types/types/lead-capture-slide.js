import { bgClass, escapeHtml, nonEmpty, BACKGROUND_FIELD, cryptoUuid } from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';

export default {
  structure: 'singleton',
  fallback: 'content-slide',
  // `static` even though the form collects: submissions go to lead storage
  // over their own endpoint, never into the presenting session. `live` means
  // the session aggregates answers, which no code path here does.
  runtime: 'static',
  label: 'Lead Capture',
  // PARKED, not superseded (decision 2026-07-24). The form is consent-gated on
  // marketing cookies (see lead-capture-runtime.js → hasMarketingConsent), but
  // the cookie-consent banner that grants that consent was never wired in, so a
  // freshly inserted form can never be submitted. Rather than ship a broken card
  // we hide it from every insertion path (picker + AI) via `deprecated` — the
  // established "not authorable, still renders stored decks" contract. Existing
  // lead-capture slides keep rendering. Re-enable = drop this flag AND wire the
  // consent banner (both
  // together): full revive checklist in briefs/cookie-consent-decision.md.
  deprecated: true,
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
      // `.lead-capture-header` centres both of these (17-lead-capture.css).
      defaultAlign: 'center',
    },
    {
      key: 'description',
      label: 'Description',
      type: 'markdown',
      required: false,
      maxLength: 500,
      defaultAlign: 'center',
    },
    {
      key: 'nameLabel',
      label: 'Name field label',
      type: 'string',
      required: false,
      maxLength: 60,
    },
    {
      key: 'emailLabel',
      label: 'Email field label',
      type: 'string',
      required: false,
      maxLength: 60,
    },
    {
      key: 'submitLabel',
      label: 'Submit button text',
      type: 'string',
      required: false,
      maxLength: 40,
    },
    {
      key: 'thankYouTitle',
      label: 'Thank you title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'thankYouMessage',
      label: 'Thank you message',
      type: 'markdown',
      required: false,
      maxLength: 500,
    },
    {
      key: 'privacyText',
      label: 'Privacy consent text',
      type: 'string',
      required: true,
      maxLength: 300,
      helpText: 'Text shown next to the consent checkbox (e.g., "I agree to receive communications...")',
    },
    {
      key: 'privacyUrl',
      label: 'Privacy policy URL',
      type: 'string',
      required: false,
      maxLength: 500,
      helpText: 'Optional link to your privacy policy',
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      leadCaptureId: '',
      title: 'Blijf op de hoogte',
      description: 'Laat je gegevens achter en ontvang updates.',
      nameLabel: 'Je naam',
      emailLabel: 'E-mailadres',
      submitLabel: 'Versturen',
      thankYouTitle: 'Bedankt!',
      thankYouMessage: 'We hebben je gegevens ontvangen.',
      privacyText: 'Ik ga akkoord met het ontvangen van communicatie.',
      privacyUrl: '',
      privacyLinkText: 'Privacybeleid',
      cookieNoticeText: 'Schakel marketingcookies in om dit formulier te versturen.',
      errorAcceptCookies: 'Accepteer marketingcookies om dit formulier te versturen.',
      errorEnterName: 'Vul je naam in.',
      errorValidEmail: 'Vul een geldig e-mailadres in.',
      errorAcceptTerms: 'Accepteer de privacyvoorwaarden.',
      errorGeneric: 'Er is iets misgegaan. Probeer het opnieuw.',
      background: 'lime',
    },
    'en-GB': {
      leadCaptureId: '',
      title: 'Stay in touch',
      description: 'Leave your details to receive updates.',
      nameLabel: 'Your name',
      emailLabel: 'Email address',
      submitLabel: 'Submit',
      thankYouTitle: 'Thank you!',
      thankYouMessage: "We've received your details.",
      privacyText: 'I agree to receive communications.',
      privacyUrl: '',
      privacyLinkText: 'Privacy Policy',
      cookieNoticeText: 'Please enable marketing cookies to submit this form.',
      errorAcceptCookies: 'Please accept marketing cookies to submit this form.',
      errorEnterName: 'Please enter your name.',
      errorValidEmail: 'Please enter a valid email address.',
      errorAcceptTerms: 'Please accept the privacy terms.',
      errorGeneric: 'Something went wrong. Please try again.',
      background: 'lime',
    },
  },
  // Back-compat fallback
  defaults: {
    leadCaptureId: '',
    title: 'Stay in touch',
    description: 'Leave your details to receive updates.',
    nameLabel: 'Your name',
    emailLabel: 'Email address',
    submitLabel: 'Submit',
    thankYouTitle: 'Thank you!',
    thankYouMessage: "We've received your details.",
    privacyText: 'I agree to receive communications.',
    privacyUrl: '',
    privacyLinkText: 'Privacy Policy',
    cookieNoticeText: 'Please enable marketing cookies to submit this form.',
    errorAcceptCookies: 'Please accept marketing cookies to submit this form.',
    errorEnterName: 'Please enter your name.',
    errorValidEmail: 'Please enter a valid email address.',
    errorAcceptTerms: 'Please accept the privacy terms.',
    errorGeneric: 'Something went wrong. Please try again.',
    background: 'lime',
  },
  /**
   * Generate unique leadCaptureId when creating a new slide.
   * Called by newSlide() in slide helpers.
   */
  onCreate: (content) => {
    return {
      ...content,
      leadCaptureId: content?.leadCaptureId || cryptoUuid(),
    };
  },
  renderHtml: (content, slide, ctx = {}) => {
    const bg = bgClass(content?.background);
    const slideId = slide?.id || '';

    const title = nonEmpty(content?.title);
    const description = nonEmpty(content?.description);
    const nameLabel = nonEmpty(content?.nameLabel) || 'Your name';
    const emailLabel = nonEmpty(content?.emailLabel) || 'Email address';
    const submitLabel = nonEmpty(content?.submitLabel) || 'Submit';
    const thankYouTitle = nonEmpty(content?.thankYouTitle);
    const thankYouMessage = nonEmpty(content?.thankYouMessage);
    const privacyText = nonEmpty(content?.privacyText);
    const privacyUrl = nonEmpty(content?.privacyUrl);
    const privacyLinkText = nonEmpty(content?.privacyLinkText) || 'Privacy Policy';
    const cookieNoticeText = nonEmpty(content?.cookieNoticeText) || 'Please enable marketing cookies to submit this form.';
    const errorAcceptCookies = nonEmpty(content?.errorAcceptCookies) || 'Please accept marketing cookies to submit this form.';
    const errorEnterName = nonEmpty(content?.errorEnterName) || 'Please enter your name.';
    const errorValidEmail = nonEmpty(content?.errorValidEmail) || 'Please enter a valid email address.';
    const errorAcceptTerms = nonEmpty(content?.errorAcceptTerms) || 'Please accept the privacy terms.';
    const errorGeneric = nonEmpty(content?.errorGeneric) || 'Something went wrong. Please try again.';

    // Render markdown for description and thank you message
    const descriptionHtml = description ? markdownToSafeHtml(description) : '';
    const thankYouHtml = thankYouMessage ? markdownToSafeHtml(thankYouMessage) : '';

    // Build privacy label with optional link
    let privacyLabelHtml = escapeHtml(privacyText);
    if (privacyUrl) {
      privacyLabelHtml += ` <a href="${escapeHtml(privacyUrl)}" target="_blank" rel="noopener noreferrer" class="lead-capture-privacy-link">${escapeHtml(privacyLinkText)}</a>`;
    }

    return `
      <div class="slide slide-lead-capture ${bg}" data-interaction="lead-capture" data-slide-id="${escapeHtml(slideId)}"
        data-error-accept-cookies="${escapeHtml(errorAcceptCookies)}"
        data-error-enter-name="${escapeHtml(errorEnterName)}"
        data-error-valid-email="${escapeHtml(errorValidEmail)}"
        data-error-accept-terms="${escapeHtml(errorAcceptTerms)}"
        data-error-generic="${escapeHtml(errorGeneric)}">
        <div class="slide-inner">
          <div class="lead-capture-container">
            <!-- Form state -->
            <div class="lead-capture-form-state on-surface-light" data-lead-state="form">
              <div class="lead-capture-header">
                <h2 class="lead-capture-title" data-inline-field="title" dir="auto">${escapeHtml(title)}</h2>
                ${descriptionHtml ? `<div class="lead-capture-description" data-inline-field="description">${descriptionHtml}</div>` : ''}
              </div>

              <form class="lead-capture-form" data-lead-form="1" autocomplete="on">
                <div class="lead-capture-field">
                  <label for="lead-name-${escapeHtml(slideId)}" class="lead-capture-label" data-inline-field="nameLabel">${escapeHtml(nameLabel)}</label>
                  <input
                    type="text"
                    id="lead-name-${escapeHtml(slideId)}"
                    name="name"
                    class="lead-capture-input"
                    required
                    autocomplete="name"
                    maxlength="200"
                    placeholder="${escapeHtml(nameLabel)}"
                  />
                </div>

                <div class="lead-capture-field">
                  <label for="lead-email-${escapeHtml(slideId)}" class="lead-capture-label" data-inline-field="emailLabel">${escapeHtml(emailLabel)}</label>
                  <input
                    type="email"
                    id="lead-email-${escapeHtml(slideId)}"
                    name="email"
                    class="lead-capture-input"
                    required
                    autocomplete="email"
                    maxlength="320"
                    placeholder="${escapeHtml(emailLabel)}"
                  />
                </div>

                <div class="lead-capture-consent">
                  <label class="lead-capture-consent-label">
                    <input
                      type="checkbox"
                      name="consent"
                      class="lead-capture-consent-checkbox"
                      required
                    />
                    <span class="lead-capture-consent-text">${privacyLabelHtml}</span>
                  </label>
                </div>

                <input type="hidden" name="consentText" value="${escapeHtml(privacyText)}" />
                <input type="hidden" name="privacyUrl" value="${escapeHtml(privacyUrl)}" />

                <div class="lead-capture-actions">
                  <button type="submit" class="lead-capture-submit btn btn-primary" data-inline-field="submitLabel">
                    ${escapeHtml(submitLabel)}
                  </button>
                </div>

                <div class="lead-capture-error" data-lead-error="1" role="alert" aria-live="polite"></div>
              </form>

              <!-- Cookie consent required message -->
              <div class="lead-capture-cookie-notice on-surface-light" data-lead-cookie-notice="1" hidden>
                <p>${escapeHtml(cookieNoticeText)}</p>
              </div>
            </div>

            <!-- Thank you state -->
            <div class="lead-capture-thankyou-state on-surface-light" data-lead-state="thankyou" hidden>
              <div class="lead-capture-thankyou">
                <div class="lead-capture-thankyou-icon" aria-hidden="true">
                  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="32" cy="32" r="30" stroke="currentColor" stroke-width="4"/>
                    <path d="M20 32L28 40L44 24" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
                <h2 class="lead-capture-thankyou-title" dir="auto">${escapeHtml(thankYouTitle)}</h2>
                ${thankYouHtml ? `<div class="lead-capture-thankyou-message">${thankYouHtml}</div>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },
};
