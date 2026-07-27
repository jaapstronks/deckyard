/**
 * Card-based Slide Type Examples
 * Icon grids, card stacks, team cards, and content columns
 *
 * Types in the directory form own their examples in their own (server-only)
 * ai.js and are imported here — see docs/reference/slide-type-directory.md.
 */

import { aiExamples as iconCardGridExamples } from '../../../../../shared/slide-types/types/icon-card-grid-slide/ai.js';

export const CARD_SLIDE_EXAMPLES = {
  // Owned by shared/slide-types/types/icon-card-grid-slide/ai.js.
  'icon-card-grid-slide': iconCardGridExamples,

  'team-cards-slide': [{
    title: 'Leadership Team',
    subheading: 'Meet our experts',
    members: [
      { image: '', name: 'Jane Smith', byline: 'CEO' },
      { image: '', name: 'John Doe', byline: 'CTO' },
      { image: '', name: 'Alice Johnson', byline: 'COO' },
    ],
  }],

  'logo-wall-slide': [{
    title: 'Our Partners',
    subheading: 'Trusted collaborators',
    logos: [
      { image: '', name: 'Acme Corporation' },
      { image: '', name: 'Globex Industries' },
      { image: '', name: 'Initech' },
      { image: '', name: 'Umbrella Corp' },
    ],
  }],

  // content-columns-slide examples removed with the deprecated catalog entry
  // (see server/utils/ai/slide-catalog/basic-content-slides.js).
  //
  // card-stack-slide examples removed likewise: the type is deprecated
  // (superseded by icon-card-grid-slide) and has no catalog entry, so its three
  // examples were unreachable dead weight. Both removals are now held in place
  // by tests/slide-type-companion-coverage.test.js instead of by memory.
};