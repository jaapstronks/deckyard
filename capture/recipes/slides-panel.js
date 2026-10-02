/**
 * Recipe: the slides panel of a seven-slide deck, clipped to the panel.
 * Registry id: shot-slides-panel → public/images/screenshots/slides-panel.png
 * Doc page: docs/editing/slides-panel.md
 *
 * The sample deck plus four typed slides, so the thumbnails fill the panel and
 * differ enough to read as a deck. The viewport is taller than the docs default
 * so all seven fit: a clip that hid slides behind the panel's own scrollbar
 * would photograph less than the page says it shows.
 */

import { randomUUID } from 'node:crypto';

import {
  CAPTURE_ACCOUNT_NAME,
  deleteDecksByPrefix,
  seedDeck,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
import { DEFAULT_VIEWPORT } from '../lib/browser.js';
import { sampleDeckSlides, SAMPLE_DECK_TITLE } from './_sample-content.js';

/**
 * @param {string} type
 * @param {object} content
 */
function typedSlide(type, content) {
  return { id: randomUUID(), type, content, notes: '', visibility: {} };
}

/** @type {import('../lib/recipe.js').Recipe} */
export default {
  id: 'slides-panel',
  output: 'slides-panel.png',
  registryPath: 'public/images/screenshots/slides-panel.png',
  viewport: { ...DEFAULT_VIEWPORT, height: 1600 },
  clip: '.panel.slides-panel',

  localStorage: { 'editor.inline.coachSeen': '1' },

  async state(api) {
    // Sticky account settings, pinned for the reasons in editor-full.js.
    await setUiLocale(api, 'en');
    await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
    await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
    const [opener, moved, next] = sampleDeckSlides();
    const slides = [
      opener,
      typedSlide('kpi-metrics-slide', {
        title: 'This quarter in numbers',
        background: 'mist',
        metrics: [
          { value: '1.2', unit: 'k', label: 'Active teams', note: '+18%' },
          { value: '64', unit: '%', label: 'Presented live', note: '+6pp' },
          { value: '4.6', unit: '', label: 'Average rating', note: '+0.3' },
        ],
      }),
      moved,
      typedSlide('chart-slide', {
        title: 'Active teams per quarter',
        chartType: 'bar',
        data: 'Quarter,Teams\nQ1,120\nQ2,165\nQ3,210\nQ4,260',
        showValues: 'yes',
        background: 'mist',
      }),
      typedSlide('process-slide', {
        title: 'From draft to launch',
        direction: 'horizontal',
        items: [
          { title: 'Draft', text: 'Outline the story' },
          { title: 'Review', text: 'Collect comments' },
          { title: 'Rehearse', text: 'Present to the team' },
          { title: 'Launch', text: 'Share the public link' },
        ],
        background: 'mist',
      }),
      typedSlide('likert-slide', {
        question: 'The new review process saves us time.',
        options: [
          { text: 'Strongly disagree' },
          { text: 'Disagree' },
          { text: 'Neutral' },
          { text: 'Agree' },
          { text: 'Strongly agree' },
        ],
        background: 'mist',
      }),
      next,
    ];
    const deckId = await seedDeck(api, {
      title: SAMPLE_DECK_TITLE,
      lang: 'en-GB',
      slides,
    });
    return { deckId, slideId: opener.id };
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
