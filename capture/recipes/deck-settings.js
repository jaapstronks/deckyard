/**
 * Recipe: the deck settings dialog, opened from the editor's "More options"
 * menu, clipped to the dialog.
 * Registry id: shot-deck-settings → public/images/screenshots/deck-settings.png
 * Doc page: docs/editing/index.md § Settings
 *
 * The docs name Q&A, Builds, Presenter transition, Document language, Tags and
 * Description. The dialog is capped at 80vh and scrolls below that, so the
 * viewport is tall enough (2000px) for the whole form to render unscrolled.
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
  viewport: { ...DEFAULT_VIEWPORT, height: 2000 },
  clip: '.modal',

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

  navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,

  waitFor: '.app-shell.editor-shell .slides-add-btn',

  async action(page) {
    await page
      .waitForFunction(
        () => !document.querySelector('.editor-loading-skeleton'),
        { timeout: 15_000 },
      )
      .catch(() => {});
    // The menu item has no class of its own; its label is the stable handle,
    // and the UI locale is pinned to English above.
    await page.click(
      'button[aria-label="More options"], summary[aria-label="More options"]',
    );
    const item = await page.waitForSelector(
      '::-p-xpath(//*[contains(@class,"dropdown-item")][normalize-space()="Settings"])',
      { visible: true },
    );
    await item.click();
    await page.waitForSelector('.modal .settings-modal-grid', {
      visible: true,
    });
  },
};
