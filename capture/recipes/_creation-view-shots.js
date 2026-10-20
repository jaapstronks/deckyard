/** Shared setup for the three documentation states of the creation view. */

import {
  CAPTURE_ACCOUNT_NAME,
  deleteDecksByPrefix,
  seedDeck,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
import { sampleDeckSlides, SAMPLE_DECK_TITLE } from './_sample-content.js';

const SECOND_DECK_TITLE = 'Product launch overview';

/** Seed only fictional demo content behind the dialog, even on a repeat run. */
export async function seedCreationView(api) {
  await setUiLocale(api, 'en');
  await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
  await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
  await deleteDecksByPrefix(api, SECOND_DECK_TITLE);
  await seedDeck(api, { title: SAMPLE_DECK_TITLE, slides: sampleDeckSlides() });
  await seedDeck(api, { title: SECOND_DECK_TITLE, slides: sampleDeckSlides() });
  return {};
}

/** Open the real view and select a method by its stable panel key. */
export async function showCreationMethod(page, method) {
  await page.click('.sidebar-new-btn');
  await page.waitForSelector('.creation-panel[data-method="blank"]', {
    visible: true,
  });
  if (method !== 'blank') {
    const selected = await page.evaluate((key) => {
      const rail = document.querySelector('.creation-rail');
      const items = [...rail.querySelectorAll('.creation-rail-item')];
      const index = [
        ...document.querySelectorAll('.creation-pane > .creation-panel'),
      ].findIndex((panel) => panel.dataset.method === key);
      return index >= 0 && items[index] ? index : -1;
    }, method);
    if (selected < 0)
      throw new Error(`Creation method "${method}" is unavailable`);
    await page.evaluate((index) => {
      document.querySelectorAll('.creation-rail-item')[index].click();
    }, selected);
  }
  await page.waitForSelector(
    `.creation-panel[data-method="${method}"]:not(.is-hidden)`,
    { visible: true },
  );
  await page.waitForSelector('.theme-picker-grid .theme-picker-item', {
    visible: true,
  });
}
