/**
 * Recipe: the slide-type picker modal, opened from the editor.
 * Registry id: shot-slide-type-picker-new
 *   → public/images/screenshots/slide-type-picker-new.png
 * Doc pages: docs/slide-types/index.md, docs/creating/new-presentation.md
 */

import {
  CAPTURE_ACCOUNT_NAME,
  deleteDecksByPrefix,
  seedDeck,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
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
    // See editor-full.js: `uiLocale` is sticky, so an English docs shot has to
    // say so rather than inherit whatever ran before it.
    await setUiLocale(api, 'en');
    // Pinned for the same reason as the locale: both are account settings that
    // survive from one recipe to the next, so an unset name would leave the
    // dev bypass's "Dev" in the chrome of whichever shot ran first.
    await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
    await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
    const slides = sampleDeckSlides();
    const deckId = await seedDeck(api, {
      title: SAMPLE_DECK_TITLE,
      slides,
    });
    return { deckId };
  },

  navigate: (ctx) => `/app/${ctx.deckId}`,

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
