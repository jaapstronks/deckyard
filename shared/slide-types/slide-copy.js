/**
 * Language-aware copy for slide type rendering.
 * Used by interactive slide types (poll, likert, feedback) that need
 * to display UI copy in the presentation language.
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
 * Get copy for a specific language.
 * Falls back to Dutch if language is not supported.
 * @param {string} lang - Language code ('nl' or 'en-GB')
 * @returns {Object} Copy object for the language
 */
export function getSlideCopy(lang) {
  const l = String(lang || '').trim();
  if (l === 'en-GB' || l === 'en') return SLIDE_COPY['en-GB'];
  return SLIDE_COPY.nl;
}