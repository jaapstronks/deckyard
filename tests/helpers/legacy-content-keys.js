/**
 * The retired content keys the B2 measurement found in stored decks, as a
 * fixture for migration 102 (B257 B5-rest): one slide per type that carried
 * one, with declared content beside it and, on the title slide, a raw key the
 * read funnel still folds (`bgImage` -> `slideBgImage`). Shared by the
 * DB-less test and the real-PostgreSQL one.
 */

/** The B2 legacy keys, by type, as the fixture stores them. */
export const LEGACY = {
  'title-slide': { byline: 'Jaap', attribution: 'CIIIC' },
  'process-slide': {
    step1Title: 'Een',
    step1Body: 'Eerst',
    step2Title: 'Twee',
    step2Body: 'Dan',
  },
  'countdown-slide': { minutes: 5 },
  'matrix-slide': { heading: 'Oud' },
  'comparison-slide': { leftItems: ['a'], rightItems: ['b'] },
  'payoff-slide': { tagline: 'Bedankt' },
};

/** Declared content beside the legacy keys, per type. */
export const DECLARED = {
  'title-slide': { title: 'Titel', bgImage: '/uploads/bg.jpg' },
  'process-slide': { title: 'Proces' },
  'countdown-slide': { title: 'Pauze' },
  'matrix-slide': { title: 'Matrix' },
  'comparison-slide': { title: 'Vergelijk', leftTitle: 'Links' },
  'payoff-slide': {},
};

/** A deck with one slide per legacy type, in two language versions. */
export function legacyDeck() {
  const slides = Object.keys(LEGACY).map((type, i) => ({
    id: `slide-${i}`,
    type,
    content: { ...DECLARED[type], ...LEGACY[type] },
  }));
  return {
    slides,
    i18n: {
      dominant: 'nl',
      versions: {
        nl: { slides: structuredClone(slides) },
        'en-GB': { slides: structuredClone(slides) },
      },
    },
  };
}
