/**
 * Recipe: the deck settings pane of the editor's rail, opened on its General
 * section by its own address (B804), clipped to the rail.
 * Registry id: shot-deck-settings → public/images/screenshots/deck-settings.png
 * Doc page: docs/editing/index.md § Settings
 *
 * General holds the source language, Tags and Description; the other sections
 * (Appearance, Playback, Publishing, Analytics, Live video) are one click
 * along the pane's section buttons.
 */

import {
  CAPTURE_ACCOUNT_NAME,
  deleteDecksByPrefix,
  seedDeck,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
import { DEFAULT_VIEWPORT } from '../lib/browser.js';
import { sampleDeckSlides, SAMPLE_DECK_TITLE } from './_sample-content.js';

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'deck-settings',
  output: 'deck-settings.png',
  registryPath: 'public/images/screenshots/deck-settings.png',
  viewport: DEFAULT_VIEWPORT,
  clip: '.inspector-panel',

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
    return { deckId, slideId: slides[0].id };
  },

  navigate: (ctx) =>
    `/app/${ctx.deckId}?slideId=${ctx.slideId}&panel=settings&section=general`,

  waitFor: '.app-shell.editor-shell .slides-add-btn',

  async action(page) {
    await page
      .waitForFunction(
        () => !document.querySelector('.editor-loading-skeleton'),
        { timeout: 15_000 },
      )
      .catch(() => {});
    await page.waitForSelector(
      '.deck-settings-pane.is-active .deck-settings-section:not([hidden])',
      { visible: true },
    );
  },
};
