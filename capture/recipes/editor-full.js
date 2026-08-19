/**
 * Recipe: the full three-panel editor with a populated sample deck.
 * Registry id: shot-editor-full → public/images/screenshots/editor-full.png
 * Doc page: docs/editing/index.md
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
  id: 'editor-full',
  output: 'editor-full.png',
  registryPath: 'public/images/screenshots/editor-full.png',
  fullPage: false,

  // Suppress the one-time inline-edit coach mark so the shot is clean.
  localStorage: { 'editor.inline.coachSeen': '1' },

  async state(api) {
    // The docs this illustrates are English, and `uiLocale` is a sticky account
    // setting — inheriting it would make the shot's language depend on which
    // recipe ran before it.
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
    return { deckId, firstSlideId: slides[0].id };
  },

  // No `&lang=`: the sample deck is single-language, and `en` is not a valid
  // presentation language anyway (`normalizeLang` takes `nl` and `en-GB` only).
  navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.firstSlideId}`,

  // Editor is fully rendered once the shell mounts and the add-slide button
  // (left panel) exists; the loading skeleton is removed by then.
  waitFor: '.app-shell.editor-shell .slides-add-btn',

  async action(page) {
    // Make sure the loading skeleton is gone before the shot.
    await page
      .waitForFunction(
        () => !document.querySelector('.editor-loading-skeleton'),
        {
          timeout: 15_000,
        },
      )
      .catch(() => {});
  },
};
