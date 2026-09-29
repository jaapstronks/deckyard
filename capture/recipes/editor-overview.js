/**
 * Recipe: the whole editor on an ordinary content slide - slides panel, the
 * slide with its inline fields, and the inspector - as the opener of the
 * basic-editing docs.
 * Registry id: shot-editor-overview
 *   → public/images/screenshots/editor-overview.png
 * Doc page: docs/editing/basic-editing.md
 *
 * Close to `editor-full`, not the same picture: this one opens the two-column
 * content slide rather than the opener, and seeds the deck in English so the
 * deck-language control matches the English docs around it.
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
  id: 'editor-overview',
  output: 'editor-overview.png',
  registryPath: 'public/images/screenshots/editor-overview.png',
  fullPage: false,

  // Suppress the one-time inline-edit coach mark so the shot is clean.
  localStorage: { 'editor.inline.coachSeen': '1' },

  async state(api) {
    // Sticky account settings, pinned for the reasons in editor-full.js.
    await setUiLocale(api, 'en');
    await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
    await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
    const slides = sampleDeckSlides();
    const deckId = await seedDeck(api, {
      title: SAMPLE_DECK_TITLE,
      lang: 'en-GB',
      slides,
    });
    return { deckId, slideId: slides[1].id };
  },

  navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,

  waitFor: '.app-shell.editor-shell .slides-add-btn',

  async action(page) {
    await page
      .waitForFunction(
        () => !document.querySelector('.editor-loading-skeleton'),
        { timeout: 15_000 },
      )
      .catch(() => {});
  },
};
