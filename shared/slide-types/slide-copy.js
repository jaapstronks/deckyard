/**
 * Language-aware copy for slide type rendering.
 * Used by interactive slide types (poll, likert, feedback) that need
 * to display UI copy in the presentation language.
 *
 * This module owns ONE decision: given a language code, which copy table does a
 * renderer read. It does not decide what a deck's language IS — that is
 * `resolveDeckLang()` in shared/i18n-utils.js, and every caller passes the
 * result in as `ctx.lang`. See docs/reference/slide-copy-language.md.
 */

export const SLIDE_COPY = {
  nl: {
    // Poll slide
    pollJoinTitle: 'Meekijken + stemmen',
    pollJoinHelpWithCodes: 'Ga naar /go en vul de code in',
    pollJoinHelpWithoutCodes: 'Ga naar /follow/<presentationId>',
    pollOptionsLabel: 'Antwoordopties',
    pollResultsLabel: 'Live resultaten',
    pollResultsTitle: 'Live resultaten',
    pollTotal: 'Totaal:',

    // Likert slide
    likertScaleLabel: 'Schaal',
    likertResultsLabel: 'Resultaten',
    likertResultsTitle: 'Live resultaten',

    // Likert slider slide
    likertSliderScaleLabel: 'Schaal van 1 tot 10',
    likertSliderHelp: 'Stem via de slider (1–10) op je telefoon.',

    // Feedback slide
    feedbackHelp: 'Geef je feedback via je telefoon.',
    feedbackMethodsLabel: 'Feedback methodes',
    feedbackScan: 'Scan',
    feedbackOrGoTo: 'Of ga naar',
    feedbackQrCodeLabel: 'QR-code',
    feedbackAccessCodeNlLabel: 'Toegangscode NL',
    feedbackAccessCodeEnLabel: 'Toegangscode EN',

    // Empty image placeholder (editor canvas only)
    imagePlaceholder: 'Afbeelding',
    logoPlaceholder: 'Logo',

    // Chart slide
    chartLegendLabel: 'Legenda',

    // Agenda/Timeline slide
    timelineLabel: 'Tijdlijn',

    // Follow-invite slide
    followMethodsLabel: 'Meekijk methodes',
    qrCodeLabel: 'QR-code',
    accessCodeLabel: 'Toegangscode',

    // Lead capture slide
    leadCaptureSubmitting: 'Versturen...',
    leadCaptureSuccess: 'Gelukt!',
    leadCaptureError: 'Er is iets misgegaan. Probeer het opnieuw.',
    leadCaptureCookieRequired: 'Schakel marketing cookies in om dit formulier te versturen.',
  },
  'en-GB': {
    // Poll slide
    pollJoinTitle: 'Follow along + vote',
    pollJoinHelpWithCodes: 'Go to /go and enter the code',
    pollJoinHelpWithoutCodes: 'Go to /follow/<presentationId>',
    pollOptionsLabel: 'Answer options',
    pollResultsLabel: 'Live results',
    pollResultsTitle: 'Live results',
    pollTotal: 'Total:',

    // Likert slide
    likertScaleLabel: 'Scale',
    likertResultsLabel: 'Results',
    likertResultsTitle: 'Live results',

    // Likert slider slide
    likertSliderScaleLabel: 'Scale from 1 to 10',
    likertSliderHelp: 'Vote via the slider (1–10) on your phone.',

    // Feedback slide
    feedbackHelp: 'Give your feedback via your phone.',
    feedbackMethodsLabel: 'Feedback methods',
    feedbackScan: 'Scan',
    feedbackOrGoTo: 'Or go to',
    feedbackQrCodeLabel: 'QR code',
    feedbackAccessCodeNlLabel: 'Access code NL',
    feedbackAccessCodeEnLabel: 'Access code EN',

    // Empty image placeholder (editor canvas only)
    imagePlaceholder: 'Image',
    logoPlaceholder: 'Logo',

    // Chart slide
    chartLegendLabel: 'Legend',

    // Agenda/Timeline slide
    timelineLabel: 'Timeline',

    // Follow-invite slide
    followMethodsLabel: 'Follow along methods',
    qrCodeLabel: 'QR code',
    accessCodeLabel: 'Access code',

    // Lead capture slide
    leadCaptureSubmitting: 'Submitting...',
    leadCaptureSuccess: 'Success!',
    leadCaptureError: 'Something went wrong. Please try again.',
    leadCaptureCookieRequired: 'Please enable marketing cookies to submit this form.',
  },
};

/**
 * The language slide copy falls back to when the deck names none, or names one
 * this table does not carry (a German deck, a stale locale, a render context
 * that never learned the deck's language).
 *
 * English, not Dutch. Dutch was never a product decision — it was the `else`
 * branch of this one file, and every renderer that repeated `ctx?.lang || 'nl'`
 * inherited it. The product's stated fallback tier is English: the whole
 * `t(key, fallback)` convention ships English fallbacks, and the locale-tiering
 * direction degrades tier-2 locales to English rather than Dutch.
 *
 * This is NOT the default language of a new deck. That is a stored, editable
 * property of the presentation (`pres.lang`, seeded from the workspace by
 * `resolveInitialDeckLang()`), and it still starts at `nl` for a Dutch
 * workspace. This constant only decides what happens when there is genuinely no
 * language information to go on.
 */
export const DEFAULT_SLIDE_COPY_LANG = 'en-GB';

/** The languages this table carries. */
export const SLIDE_COPY_LANGS = Object.keys(SLIDE_COPY);

/**
 * Resolve any language code to a language this copy table carries.
 * `en` is an accepted alias for the canonical `en-GB`; anything else the table
 * does not know resolves to {@link DEFAULT_SLIDE_COPY_LANG}.
 * @param {string} [lang]
 * @returns {'nl'|'en-GB'}
 */
export function slideCopyLang(lang) {
  const l = String(lang || '').trim();
  if (l === 'en') return 'en-GB';
  return Object.hasOwn(SLIDE_COPY, l) ? l : DEFAULT_SLIDE_COPY_LANG;
}

/**
 * Get copy for a specific language.
 * @param {string} [lang] - Language code ('nl' or 'en-GB'); anything else falls
 *   back to {@link DEFAULT_SLIDE_COPY_LANG}.
 * @returns {Object} Copy object for the language
 */
export function getSlideCopy(lang) {
  return SLIDE_COPY[slideCopyLang(lang)];
}