/**
 * Language-aware copy for slide type rendering.
 * Used by interactive slide types (poll, likert, feedback) that need
 * to display UI copy in the presentation language, and by the static exports
 * (PDF, PPTX) for the words they put on a slide the format cannot carry.
 *
 * This module owns ONE decision: given a language code, which copy table does a
 * renderer read. It does not decide what a deck's language IS — that is
 * `resolveDeckLang()` in shared/i18n-utils.js, and every caller passes the
 * result in as `ctx.lang`. See docs/reference/slide-copy-language.md.
 *
 * It is the only copy table keyed by the deck's language. An export that needs
 * a sentence in the deck's language adds a key here rather than a table of its
 * own: a second table is a second fallback ladder, and that is exactly how the
 * PDF video placeholder ended up falling back to Dutch while everything else
 * fell back to English (B358).
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
    likertSliderScaleLabel: 'Schaal van {min} tot {max}',
    likertSliderHelp: 'Stem via de slider ({min}–{max}) op je telefoon.',

    // Feedback slide
    feedbackHelp: 'Geef je feedback via je telefoon.',
    feedbackMethodsLabel: 'Feedback methodes',
    feedbackScan: 'Scan',
    feedbackOrGoTo: 'Of ga naar',
    feedbackQrCodeLabel: 'QR-code',

    // Empty image placeholder (editor canvas only)
    imagePlaceholder: 'Afbeelding',
    logoPlaceholder: 'Logo',

    // Admonitions — the eyebrow word for each kind of contrast block, shared
    // by callout-slide (a whole slide) and the aside inset (a block within
    // one), so the two say the same word for the same promise. On a callout an
    // author who fills `label` overrides it (a definition usually puts the term
    // there); an inset has no label field and always shows the word.
    admonitionInsight: 'Kernpunt',
    admonitionWarning: 'Let op',
    admonitionDefinition: 'Definitie',
    admonitionNote: 'Noot',
    admonitionTip: 'Tip',

    // Reader: the text of a link that jumps to another slide of the deck.
    readerSlideLink: 'Dia {n}',

    // Chart slide. The summary is the chart's text alternative: the canvas
    // puts it in its sr-only block, the reader in the data table's <caption>.
    chartLegendLabel: 'Legenda',
    chartKindBar: 'Staafdiagram',
    chartKindPie: 'Cirkeldiagram',
    chartKindLine: 'Lijndiagram',
    chartSummaryTop: '{kind} met {count} punten. Hoogste: {label} ({value}).',
    chartSummaryRange: '{kind} met {count} punten. Min: {min}. Max: {max}.',

    // Agenda/Timeline slide
    timelineLabel: 'Tijdlijn',

    // Follow-invite slide
    followMethodsLabel: 'Meekijk methodes',
    qrCodeLabel: 'QR-code',
    accessCodeLabel: 'Toegangscode',

    // Video slide in a static export. A PDF and a PPTX both hand the reader a
    // slide where the video cannot play; the PDF points at a watch URL, the
    // PPTX explains why the file has no media and what to do about it. The
    // `{provider}` placeholder carries a brand name (YouTube, Vimeo), which is
    // why one template serves every provider.
    videoPdfKicker: 'Videoslide',
    videoPdfLead:
      'Deze slide bevat een video die niet in een PDF kan worden afgespeeld. Bekijk de video online:',
    videoPdfNoUrl:
      'Deze slide bevat een video. De video is niet online beschikbaar.',
    videoPptxBunnyNotEmbedded: 'Bunny-video kon niet worden ingesloten',
    videoPptxNotEmbedded: 'Video kon niet worden ingesloten',
    videoPptxBunnyNotDownloaded: 'Bunny-video kon niet worden gedownload',
    videoPptxProviderVideo: '{provider}-video',
    videoPptxSourceUnknown: 'Videobron niet herkend',
    videoPptxBunnyUnconfigured:
      'BUNNY_PULLZONE is niet geconfigureerd op de server.',
    videoPptxEmbedFailed: 'Onbekende fout bij het toevoegen van de video.',
    videoPptxBunnyFallbackHint:
      'Controleer of MP4 Fallback is ingeschakeld in Bunny.',
    videoPptxProviderOffline:
      "{provider}-video's kunnen niet offline worden afgespeeld in PowerPoint.",
    videoPptxNoSource: 'Geen videobron opgegeven',
    videoPptxAddManually: 'Voeg de video handmatig toe in PowerPoint.',
    videoPptxAskAdmin:
      'Vraag de beheerder om de Bunny CDN-instellingen te configureren, of voeg de video handmatig toe.',
    videoPptxDownloadManually:
      'Download de video handmatig en voeg deze toe in PowerPoint.',
    videoPptxDownloadFromProvider:
      'Download de video van {provider} en voeg deze handmatig toe.',
    videoPptxYouTubeInstruction:
      'Download de video van YouTube en voeg deze handmatig toe, of gebruik "Online video invoegen" in PowerPoint (vereist internet tijdens de presentatie).',
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
    likertSliderScaleLabel: 'Scale from {min} to {max}',
    likertSliderHelp: 'Vote via the slider ({min}–{max}) on your phone.',

    // Feedback slide
    feedbackHelp: 'Give your feedback via your phone.',
    feedbackMethodsLabel: 'Feedback methods',
    feedbackScan: 'Scan',
    feedbackOrGoTo: 'Or go to',
    feedbackQrCodeLabel: 'QR code',

    // Empty image placeholder (editor canvas only)
    imagePlaceholder: 'Image',
    logoPlaceholder: 'Logo',

    // Admonitions — see the note on the Dutch table above.
    admonitionInsight: 'Key insight',
    admonitionWarning: 'Warning',
    admonitionDefinition: 'Definition',
    admonitionNote: 'Note',
    admonitionTip: 'Tip',

    // Reader: the text of a link that jumps to another slide of the deck.
    readerSlideLink: 'Slide {n}',

    // Chart slide — see the note on the Dutch table above.
    chartLegendLabel: 'Legend',
    chartKindBar: 'Bar chart',
    chartKindPie: 'Pie chart',
    chartKindLine: 'Line chart',
    chartSummaryTop: '{kind} with {count} points. Highest: {label} ({value}).',
    chartSummaryRange: '{kind} with {count} points. Min: {min}. Max: {max}.',

    // Agenda/Timeline slide
    timelineLabel: 'Timeline',

    // Follow-invite slide
    followMethodsLabel: 'Follow along methods',
    qrCodeLabel: 'QR code',
    accessCodeLabel: 'Access code',

    // Video slide in a static export — see the note on the Dutch table above.
    videoPdfKicker: 'Video slide',
    videoPdfLead:
      "This slide contains a video that can't play in a PDF. Watch it online:",
    videoPdfNoUrl: "This slide contains a video. It isn't available online.",
    videoPptxBunnyNotEmbedded: "Bunny video couldn't be embedded",
    videoPptxNotEmbedded: "Video couldn't be embedded",
    videoPptxBunnyNotDownloaded: "Bunny video couldn't be downloaded",
    videoPptxProviderVideo: '{provider} video',
    videoPptxSourceUnknown: 'Video source not recognised',
    videoPptxBunnyUnconfigured:
      'BUNNY_PULLZONE is not configured on the server.',
    videoPptxEmbedFailed: 'Unknown error while adding the video.',
    videoPptxBunnyFallbackHint: 'Check that MP4 Fallback is enabled in Bunny.',
    videoPptxProviderOffline:
      "{provider} videos can't play offline in PowerPoint.",
    videoPptxNoSource: 'No video source given',
    videoPptxAddManually: 'Add the video manually in PowerPoint.',
    videoPptxAskAdmin:
      'Ask the administrator to configure the Bunny CDN settings, or add the video manually.',
    videoPptxDownloadManually:
      'Download the video manually and add it in PowerPoint.',
    videoPptxDownloadFromProvider:
      'Download the video from {provider} and add it manually.',
    videoPptxYouTubeInstruction:
      'Download the video from YouTube and add it manually, or use "Insert Online Video" in PowerPoint (needs internet during the presentation).',
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
 * property of the presentation (`pres.lang`, seeded from the organization by
 * `resolveInitialDeckLang()`), and it still starts at `nl` for a Dutch
 * organization. This constant only decides what happens when there is genuinely no
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

/**
 * Fill the `{name}` placeholders of a copy template.
 *
 * The placeholder syntax belongs to the table, so the filler does too: four
 * call sites had grown three spellings of it (a private `fill()` in the chart
 * summary, a bare `.replace('{n}', …)` in the projection, a `scaleCopy()` in
 * the likert slider), and a template whose value nobody passes must read the
 * same way everywhere. An unknown name is left standing rather than blanked —
 * a visible `{provider}` names the bug, and so does a `String(undefined)` from
 * a key that does not exist: this filler repairs nothing silently.
 *
 * @param {string} template - A copy string from {@link SLIDE_COPY}.
 * @param {Record<string, string|number>} values - Values by placeholder name.
 * @returns {string}
 */
export function fillCopy(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (m, name) =>
    Object.hasOwn(values || {}, name) ? String(values[name]) : m,
  );
}
