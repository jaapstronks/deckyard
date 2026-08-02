/**
 * Fixtures for the structural export metrics (B14 form 2).
 *
 * Two shapes, per `docs/plans/briefs/export-structural-metrics.md`:
 *
 *  - **the calibration slide**, rendered once per built-in theme. One slide,
 *    one layout, six themes: what differs between the baselines is exactly the
 *    theme, so a drifting box or a fallback font is attributable.
 *  - **the all-field-types deck**, one pass over every field kind the registry
 *    knows (`string`, `markdown`, `enum`, `number`, `items`, `image`,
 *    `boolean`, `csv`, `code`), so a renderer regression in a field kind that
 *    the calibration slide does not use still has somewhere to show up.
 *
 * The calibration text is deliberately short and free of near-wrap lines. Where
 * a line breaks is a function of font metrics, and the ubuntu CI runner
 * rasterises differently from a Mac — a body block that sits one word away from
 * wrapping would swing a whole line height and blow any sane tolerance. The
 * fixture is the place to remove that flake, not the tolerance.
 */

/** Every theme shipped in `themes/`, each getting its own baseline file. */
export const BUILTIN_THEMES = [
  'brand',
  'corporate',
  'deckyard',
  'editorial',
  'midnight',
  'playful',
];

/**
 * The `background` variant the calibration slide renders with (the registry
 * default for `content-slide`). It selects which theme token paints the frame:
 * `--t-slide-bg-<variant>`, which is *not* `--t-color-background` — in the
 * midnight theme those are `#18181b` and `#09090b` respectively.
 */
export const CALIBRATION_BACKGROUND_VARIANT = 'lime';

/**
 * The calibration slide. `content-slide` is used because it exposes the three
 * measured roles as plain `.heading` / `.subheading` / `.body` elements.
 */
export function calibrationSlide() {
  return {
    type: 'content-slide',
    content: {
      title: 'Structural metrics',
      subheading: 'One calibration slide',
      body: 'Short body line.\n\nSecond short line.',
    },
  };
}

/** A single-slide deck around the calibration slide, for the PDF pass. */
export function calibrationDeck(theme) {
  return { title: 'Calibration', theme, slides: [calibrationSlide()] };
}

/**
 * A deck touching every field kind in the registry.
 *
 * `fieldKinds` names what each slide is here to cover, so a future reader can
 * tell an intentional fixture from an accumulated one.
 */
export const ALL_FIELD_TYPES_SLIDES = [
  {
    fieldKinds: ['string', 'enum', 'number'],
    titleSelector: '.slide .title',
    slide: {
      type: 'title-slide',
      content: {
        title: 'All field types',
        subheading: 'One pass over the registry',
        meta: '2026-08-03',
        background: 'lime',
        slideBgFocusX: 50,
        slideBgFocusY: 50,
      },
    },
  },
  {
    fieldKinds: ['markdown', 'items'],
    titleSelector: '.slide .heading',
    slide: {
      type: 'content-slide',
      content: {
        title: 'Markdown and items',
        subheading: 'Body plus actions',
        body: 'A **bold** word and a *slanted* one.\n\n- First point\n- Second point',
        actions: [{ label: 'Read on', url: 'https://example.org', style: 'primary' }],
      },
    },
  },
  {
    fieldKinds: ['items'],
    titleSelector: '.slide .heading',
    slide: {
      type: 'table-slide',
      content: {
        title: 'Table rows',
        colCount: '2',
        rows: [
          { c1: 'Column A', c2: 'Column B' },
          { c1: 'One', c2: 'Two' },
          { c1: 'Three', c2: 'Four' },
        ],
      },
    },
  },
  {
    fieldKinds: ['csv'],
    titleSelector: '.slide .chart-title',
    slide: {
      type: 'chart-slide',
      content: {
        title: 'Chart data',
        chartType: 'bar',
        data: 'Label,Value\nAlfa,3\nBravo,5\nCharlie,2',
      },
    },
  },
  {
    fieldKinds: ['code'],
    titleSelector: '.slide .probe',
    slide: {
      type: 'custom-html-slide',
      content: {
        html: '<div class="probe">Custom HTML</div>',
        css: '.probe { font-size: 48px; padding: 40px; }',
      },
    },
  },
  {
    fieldKinds: ['image', 'boolean'],
    titleSelector: '.slide .img-title',
    slide: {
      type: 'image-slide',
      content: {
        title: 'Image and flag',
        image: '/assets/images/logo-placeholder.svg',
        alt: 'Placeholder logo',
        caption: 'A local asset, so the fixture needs no network',
        bleed: false,
      },
    },
  },
];

/** The all-field-types deck, rendered in one theme (the layout is the subject). */
export function allFieldTypesDeck(theme = 'deckyard') {
  return {
    title: 'All field types',
    theme,
    slides: ALL_FIELD_TYPES_SLIDES.map((entry) => entry.slide),
  };
}
