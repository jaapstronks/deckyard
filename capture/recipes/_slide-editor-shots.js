/**
 * The five slide-editor docs shots (`{chart,table,kpi,likert,process}-slide-editor`),
 * one factory over the slide each one photographs.
 *
 * Every shot is the same picture of a different type: the shared sample deck
 * with one typed slide inserted after the opener and selected, so the editor
 * shows that type's inspector beside its live preview. The recipe modules only
 * name the type and its content; keeping the body here is what stops five
 * copies from drifting apart (the reason `_marketing-shots.js` exists too).
 *
 * The content is spelled out rather than taken from the type's defaults: a
 * default that changes in `shared/` would change the shot without moving the
 * recipe hash, which stops at `capture/` (README § Known limits).
 *
 * A change *in this file* moves the registry hash of all five shots.
 */

import { randomUUID } from 'node:crypto';

import {
  CAPTURE_ACCOUNT_NAME,
  deleteDecksByPrefix,
  seedDeck,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
import { sampleDeckSlides, SAMPLE_DECK_TITLE } from './_sample-content.js';

/**
 * @param {{
 *   id: string,
 *   type: string,
 *   content: object,
 *   action?: import('../lib/recipe.js').Recipe['action'],
 * }} spec - `id` is the registry id without `shot-`; `type` the registry key
 *   of the slide type; `content` the slide's full content; `action` an extra
 *   step after the editor settled (open a panel the docs page talks about).
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function slideEditorShot({ id, type, content, action }) {
  return {
    id,
    output: `${id}.png`,
    registryPath: `public/images/screenshots/${id}.png`,
    fullPage: false,

    // Suppress the one-time inline-edit coach mark so the shot is clean.
    localStorage: { 'editor.inline.coachSeen': '1' },

    async state(api) {
      // Sticky account settings, pinned for the reasons in editor-full.js.
      await setUiLocale(api, 'en');
      await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
      await deleteDecksByPrefix(api, SAMPLE_DECK_TITLE);
      const typed = {
        id: randomUUID(),
        type,
        content,
        notes: '',
        visibility: {},
      };
      const [opener, ...rest] = sampleDeckSlides();
      const deckId = await seedDeck(api, {
        title: SAMPLE_DECK_TITLE,
        // English slide copy to match the English chrome; see seedDeck().
        lang: 'en-GB',
        slides: [opener, typed, ...rest],
      });
      return { deckId, slideId: typed.id };
    },

    navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,

    waitFor: '.app-shell.editor-shell .slides-add-btn',

    async action(page, ctx) {
      await page
        .waitForFunction(
          () => !document.querySelector('.editor-loading-skeleton'),
          { timeout: 15_000 },
        )
        .catch(() => {});
      if (action) await action(page, ctx);
    },
  };
}
