/**
 * Deterministic, PII-free sample slides shared by capture recipes. Keeping the
 * sample content in one place means every re-capture renders the same deck, so
 * screenshots stay visually stable across runs and machines.
 */

import { randomUUID } from 'node:crypto';

/**
 * Title for the shared sample deck. Human-readable (it shows in the editor
 * title bar) yet distinctive enough to serve as the idempotency key: recipes
 * delete any deck whose title starts with this before re-seeding, so re-runs
 * stay clean without a debug-looking marker leaking into the screenshot.
 */
export const SAMPLE_DECK_TITLE = 'Quarterly product review';

/**
 * @param {{title: string, body?: string, subheading?: string, layout?: string}} spec
 * @returns {{id: string, type: string, content: object, notes: string, visibility: object}}
 */
function contentSlide({ title, body = '', subheading = '', layout = 'one-column' }) {
  return {
    id: randomUUID(),
    type: 'content-slide',
    content: {
      title,
      subheading,
      layout,
      density: 'auto',
      body,
      background: 'mist',
      actions: [],
    },
    notes: '',
    visibility: {},
  };
}

/**
 * A small, representative deck: a title-ish opener plus two content slides.
 * Stable content, no personal data — safe to render in public docs.
 * @returns {Array<object>}
 */
export function sampleDeckSlides() {
  return [
    contentSlide({
      title: 'Quarterly product review',
      subheading: 'Team sync — sample deck',
      body:
        '- Where we are this quarter\n' +
        '- What shipped and what slipped\n' +
        '- Decisions we need today',
    }),
    contentSlide({
      title: 'Three things that moved',
      body:
        '- Faster onboarding: median time-to-first-deck down\n' +
        '- New chart slide type in the editor\n' +
        '- Docs now regenerate their own screenshots',
      layout: 'two-column',
    }),
    contentSlide({
      title: 'What we decide next',
      body:
        '- Pick the theme for the launch deck\n' +
        '- Confirm the demo dataset\n' +
        '- Lock the ship date',
    }),
  ];
}
