/**
 * Static data and tuning constants for the insert-slide type picker.
 *
 * Pure values only — no DOM, no storage, no closure state. The picker's
 * localStorage keys live in ./preferences.js (its sole storage concern); these
 * are the domain data (aliases, curated presets, descriptions) and the layout /
 * tuning knobs the render and thumbnail modules read.
 */

// The slide canvas is rendered at this width, then scaled down to fit each
// thumbnail tile. Scale is computed per tile from its measured width.
export const SLIDE_CANVAS_WIDTH = 1600;

// Thumbnail view modes: 'schematic' shows an abstract symbolic diagram of each
// slide type (compact, legible at any size); 'preview' shows the real slide
// rendered small (richer, but text gets tiny). Default schematic — it scans
// faster and reads clearly even in a dense grid.
export const VIEW_MODES = new Set(['schematic', 'preview']);

// Preview-background toggle candidates: the chosen surface is forced onto every
// thumbnail whose slide type actually supports it. Filtered per theme/type at
// render time; '' ("auto") means each type renders on its own sample surface.
export const SURFACE_CANDIDATES = ['lime', 'mist', 'dark'];

// Frequently-used strip tuning: cap it to one row and don't show it until
// there's real signal.
export const FREQUENT_MAX = 6;
export const FREQUENT_MIN_TOTAL = 3;

// Curated picker groups, in display order, as type names. Anything registered,
// insertable and absent here lands in the computed "Other" group — a deliberate
// home for the long tail (payoff, end, custom-html), not a gap. Because absence
// is legitimate, only the *reverse* direction is gated: a group must not name a
// deprecated or unregistered type (see
// tests/slide-type-companion-coverage.test.js). The picker's grouping is
// intentionally coarser than the settings-tab curation list: process/timeline
// live under Layouts here, and there is no explicit "other" group.
//
// The theme's own `basicSlideTypes` are prepended to `basic` at render time, and
// custom types get their own computed group — neither belongs in this table.
export const PICKER_GROUPS = {
  basic: [
    'title-slide',
    'chapter-title-slide',
    'content-slide',
    'quote-slide',
    'lijstje-slide',
    // The styled "List" slide is a close cousin of the bulleted/numbered list,
    // so it sits right next to it rather than adrift in "Other".
    'list-slide',
  ],
  media: [
    'image-text-slide',
    'image-slide',
    'gallery-slide',
    'video-slide',
    'embed-slide',
    'team-cards-slide',
    'logo-wall-slide',
  ],
  // Layouts also absorbs the old "Process" group: process/timeline are just
  // structured layouts, not different enough to warrant a section of their own
  // (which showed 2 tiles and a wall of whitespace).
  layouts: [
    'text-blocks-slide',
    'icon-card-grid-slide',
    'process-slide',
    'timeline-slide',
  ],
  data: [
    'table-slide',
    'chart-slide',
    'kpi-metrics-slide',
    'comparison-slide',
    'matrix-slide',
    'funnel-slide',
    'pyramid-slide',
    'cycle-slide',
  ],
  interaction: [
    'poll-slide',
    'likert-slide',
    'likert-slider-slide',
    'feedback-slide',
    'follow-invite-slide',
    'countdown-slide',
  ],
};

// Extra search terms per type so people find a slide by an unofficial name
// (incl. Dutch), e.g. "smoelenboek"/"roster" -> team cards. Folded into the
// search haystack only; never shown.
export const SLIDE_TYPE_ALIASES = {
  'title-slide': 'cover opening intro voorpagina titel',
  'chapter-title-slide': 'section divider hoofdstuk tussentitel',
  'content-slide': 'text body paragraph tekst inhoud',
  'quote-slide': 'testimonial pull quote citaat',
  'lijstje-slide': 'bullets list opsomming lijst',
  'list-slide': 'list styled items opsomming lijst genummerd',
  'image-text-slide': 'photo text foto beeld tekst',
  'image-slide': 'photo full bleed foto beeld',
  'gallery-slide': 'photos images grid fotogalerij beelden',
  'video-slide': 'youtube vimeo movie film',
  'embed-slide': 'iframe figma miro sheet website',
  'team-cards-slide': 'roster faces headshots portraits people staff team smoelenboek gezichten medewerkers',
  'logo-wall-slide': 'sponsors clients brands partners logos logowand klanten',
  'text-blocks-slide': 'blocks process blokken stappen',
  'icon-card-grid-slide': 'cards features icons kaarten iconen',
  'table-slide': 'grid spreadsheet rows columns tabel',
  'chart-slide': 'graph bar line pie data viz grafiek diagram',
  'kpi-metrics-slide': 'numbers stats metrics figures cijfers kengetallen',
  'comparison-slide': 'versus vs pros cons vergelijking',
  'matrix-slide': 'quadrant 2x2 kwadrant',
  'funnel-slide': 'conversion sales trechter',
  'pyramid-slide': 'hierarchy layers piramide',
  'cycle-slide': 'loop pdca circular cyclus kringloop',
  'process-slide': 'steps flow workflow stappen proces',
  'timeline-slide': 'roadmap history dates milestones tijdlijn',
  'poll-slide': 'vote survey stemmen peiling',
  'likert-slide': 'agree disagree rating schaal',
  'likert-slider-slide': 'slider rating schaal',
  'feedback-slide': 'open question wordcloud feedback vraag',
  'follow-invite-slide': 'qr join volgen',
  'countdown-slide': 'timer break pauze aftellen',
  'payoff-slide': 'closing thanks afsluiter bedankt',
  'end-slide': 'contact details closing thanks afsluiter bedankt gegevens',
  'custom-html-slide': 'raw html css code escape hatch eigen code',
};

// Curated layout variants surfaced as their own picker tiles (item 15). Each
// preset inserts the base slide type pre-configured with these content
// overrides, so the alternative layout is discoverable without a schema change.
// Usage counts and pins still track the *base* type (not the preset), so the
// "frequently used" / "pinned" signal isn't fragmented across variants; those
// strips render one base tile. Kept to a tight curated set so the grid doesn't
// explode. A type absent here renders as a single base tile, as before.
export const SLIDE_TYPE_PRESETS = {
  'image-text-slide': [
    { id: 'image-left', labelKey: 'editor.slideTypePreset.imageText.left', label: 'Image left', content: { imageSide: 'left' } },
    { id: 'image-right', labelKey: 'editor.slideTypePreset.imageText.right', label: 'Image right', content: { imageSide: 'right' } },
    { id: 'image-wide', labelKey: 'editor.slideTypePreset.imageText.wide', label: 'Image 2/3', content: { imageWidth: 'wide' } },
    { id: 'image-corner', labelKey: 'editor.slideTypePreset.imageText.corner', label: 'Corner image', content: { layout: 'corner', imageSide: 'right' } },
    { id: 'image-row', labelKey: 'editor.slideTypePreset.imageText.row', label: 'Image row', content: { layout: 'row-top' } },
  ],
  // content-slide has no picker presets on purpose: its two-column layout is a
  // CSS text-flow variant that only splits once the body is long enough, so it
  // reads as "one column" in an empty new slide and confused people who picked
  // it expecting two separate fields. That layout stays reachable in the editor
  // via the layout switcher (content-slide's layoutVariants), which is where the
  // "I explicitly want two columns" use case lives now that content-columns-slide
  // is archived.
  'lijstje-slide': [
    { id: 'bullets', labelKey: 'editor.slideTypePreset.lijstje.bullets', label: 'Bullet list', content: { variant: 'bullets' } },
    { id: 'numbers', labelKey: 'editor.slideTypePreset.lijstje.numbers', label: 'Numbered list', content: { variant: 'numbers' } },
  ],
};

// Short "what is this" descriptions for the curated slide types, shown as the
// card tooltip so the picker explains itself. English here is the fallback;
// translations live under editor.slideTypeDesc.<type> in the i18n files.
// Types without an entry (theme basics, custom, "Other") fall back to the label.
export const SLIDE_TYPE_DESC = {
  'title-slide': 'Big title and subtitle to open with',
  'chapter-title-slide': 'Section divider between topics',
  'content-slide': 'A heading with body text',
  'quote-slide': 'A pull quote with attribution',
  'lijstje-slide': 'A simple bulleted list',
  'list-slide': 'A styled list of items',
  'image-text-slide': 'An image beside text',
  'image-slide': 'A single full-bleed image',
  'gallery-slide': 'A grid of images',
  'video-slide': 'An embedded video',
  'embed-slide': 'Embed an external page or iframe',
  'team-cards-slide': 'Image blocks in a grid',
  'logo-wall-slide': 'A wall of logos',
  'text-blocks-slide': 'Several labelled text blocks',
  'icon-card-grid-slide': 'Cards with an icon and label',
  'table-slide': 'A data table',
  'chart-slide': 'A bar, line or pie chart',
  'kpi-metrics-slide': 'Big numbers with deltas',
  'comparison-slide': 'Two options side by side',
  'matrix-slide': 'A 2×2 quadrant matrix',
  'funnel-slide': 'Stages narrowing to a goal',
  'pyramid-slide': 'A layered hierarchy pyramid',
  'cycle-slide': 'A repeating cycle of stages',
  'process-slide': 'Sequential steps with arrows',
  'timeline-slide': 'Events along a timeline',
  'poll-slide': 'A live audience poll',
  'likert-slide': 'An agree/disagree rating',
  'likert-slider-slide': 'A 1–10 slider rating',
  'feedback-slide': 'Collect open text feedback',
  'follow-invite-slide': 'A QR code to follow along',
  'countdown-slide': 'A countdown timer',
  'payoff-slide': 'A closing payoff statement',
  'end-slide': 'A closing slide with contact details',
  'custom-html-slide': 'Your own HTML and CSS, for anything else',
};
