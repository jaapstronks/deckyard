/**
 * Recipe: the full three-panel editor with a populated sample deck.
 * Registry id: shot-editor-full → public/images/screenshots/editor-full.png
 * Doc page: docs/editing/index.md
 */

import { deleteDecksByPrefix, seedDeck } from '../lib/api.js';
import { sampleDeckSlides, SAMPLE_DECK_TITLE } from './_sample-content.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'editor-full',
  output: 'editor-full.png',
  registryPath: 'public/images/screenshots/editor-full.png',
  fullPage: false,

  // Suppress the one-time inline-edit coach mark so the shot is clean.
  localStorage: { 'editor.inline.coachSeen': '1' },

  async state(api) {
    await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
    const slides = sampleDeckSlides();
    const deckId = await seedDeck(api, {
      title: SAMPLE_DECK_TITLE,
      theme: 'deckyard',
      slides,
    });
    return { deckId, firstSlideId: slides[0].id };
  },

  navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.firstSlideId}&lang=en`,

  // Editor is fully rendered once the shell mounts and the add-slide button
  // (left panel) exists; the loading skeleton is removed by then.
  waitFor: '.app-shell.editor-shell .slides-add-btn',

  async action(page) {
    // Make sure the loading skeleton is gone before the shot.
    await page
      .waitForFunction(() => !document.querySelector('.editor-loading-skeleton'), {
        timeout: 15_000,
      })
      .catch(() => {});
  },
};
