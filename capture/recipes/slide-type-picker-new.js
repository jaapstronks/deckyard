/**
 * Recipe: the slide-type picker modal, opened from the editor.
 * Registry id: shot-slide-type-picker-new
 *   → public/images/screenshots/slide-type-picker-new.png
 * Doc pages: docs/slide-types/index.md, docs/creating/new-presentation.md
 */

import { deleteDecksByPrefix, seedDeck } from '../lib/api.js';
import { sampleDeckSlides, SAMPLE_DECK_TITLE } from './_sample-content.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'slide-type-picker-new',
  output: 'slide-type-picker-new.png',
  registryPath: 'public/images/screenshots/slide-type-picker-new.png',
  fullPage: false,

  // Suppress the one-time inline-edit coach mark (harmless behind the modal,
  // but keeps the seeded editor state identical to the other editor shot).
  localStorage: { 'editor.inline.coachSeen': '1' },

  async state(api) {
    await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
    const slides = sampleDeckSlides();
    const deckId = await seedDeck(api, {
      title: SAMPLE_DECK_TITLE,
      theme: 'deckyard',
      slides,
    });
    return { deckId };
  },

  navigate: (ctx) => `/app/${ctx.deckId}?lang=en`,

  waitFor: '.app-shell.editor-shell .slides-add-btn',

  async action(page) {
    await page
      .waitForFunction(() => !document.querySelector('.editor-loading-skeleton'), {
        timeout: 15_000,
      })
      .catch(() => {});
    // Open the "Add slide" modal — the slide-type picker.
    await page.click('button.slides-add-btn');
    await page.waitForSelector('.slide-type-modal', { visible: true, timeout: 15_000 });
  },
};
