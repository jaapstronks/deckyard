/**
 * The three home-page marketing shot shapes, each a factory over the language
 * pair. The four `/features` shapes live in `_features-shots.js`.
 *
 * The six recipe modules for these are thin: they name a language and a shape,
 * and the body lives here. That keeps the `-nl` and `-en` halves of a pair
 * provably identical apart from the two language codes — the failure mode a
 * copy-pasted pair invites is one half drifting silently.
 *
 * A change *in this file* moves the registry hash of all six shots:
 * `hashRecipeGraph()` walks each recipe's imports within `capture/`, so the
 * factory is part of what they hash. See `capture/README.md` § Known limits.
 */

import { seedDeck, setUiLocale } from '../lib/api.js';
import {
  MARKETING_LANGS,
  MARKETING_PUBLIC_ORIGIN,
  MARKETING_THEME,
  MARKETING_VIEWPORT,
  PRESENTER_SLIDE,
  dismissPresenterStartGate,
  rewriteJoinOrigin,
  seedPollVotes,
  startLiveSession,
} from '../lib/marketing.js';
import {
  MARKETING_POLL_VOTES,
  clearMarketingDecks,
  marketingDeckVersions,
  seedMarketingDeck,
} from './_marketing-deck.js';

/**
 * `editor-form-{nl,en}` — the editor's bulk-edit view on a typed slide: named
 * fields on the left, live preview on the right.
 *
 * The funnel slide rather than a title slide, and the bulk-edit modal rather
 * than the inspector, because the claim being illustrated is "a slide is a
 * form": the inspector shows background and accessibility, while this view
 * shows *Stage label / Value / Description* per funnel stage. That is the
 * difference between filling in fields and typing into a box.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function editorFormShot(lang) {
  const { suffix, deckLang, uiLocale } = MARKETING_LANGS[lang];
  return {
    id: `editor-form-${suffix}`,
    output: `editor-form-${suffix}.png`,
    registryPath: `public/images/marketing/editor-form-${suffix}.png`,
    viewport: MARKETING_VIEWPORT,
    fullPage: false,
    // The inline-edit coach mark ("Click any text on the slide to edit it")
    // otherwise sits across the preview on a first visit.
    localStorage: { 'editor.inline.coachSeen': '1' },

    async state(api) {
      // Single-language deck, unlike the other two shots. A bilingual deck puts
      // a "from EN" translation-provenance chip on every field, which reads as
      // "this text was machine-translated" — the opposite of the claim the shot
      // is making about authoring in named fields.
      await clearMarketingDecks(api);
      await setUiLocale(api, uiLocale);
      const deck = marketingDeckVersions();
      const deckId = await seedDeck(api, {
        title: deck.titles[deckLang],
        theme: MARKETING_THEME,
        slides: deck.versions[deckLang],
      });
      return { deckId, slideId: deck.slideIds.funnel };
    },

    navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,
    waitFor: '.app-shell.editor-shell .slides-add-btn',

    async action(page) {
      await page
        .waitForFunction(
          () => !document.querySelector('.editor-loading-skeleton'),
          { timeout: 15_000 }
        )
        .catch(() => {});
      await page.click('.editor-bulk-edit-btn');
      await page.waitForSelector('.modal.bulk-edit-modal', {
        visible: true,
        timeout: 10_000,
      });
    },
  };
}

/**
 * `poll-live-{nl,en}` — the poll slide mid-presentation with a real, uneven
 * result and the counter showing.
 *
 * Cannot be shot from the editor: the editor preview of a `poll-slide` always
 * renders `Total: 0` with empty bars, because `getPollInteractionAggregate` is
 * scoped to a presentation session. So this one opens a session, parks it on
 * the poll slide, and casts {@link MARKETING_POLL_VOTES} through the same
 * public route an audience phone uses.
 *
 * Clipped to the slide: the presenter toolbar around it is a different shot.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function pollLiveShot(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  return {
    id: `poll-live-${suffix}`,
    output: `poll-live-${suffix}.png`,
    registryPath: `public/images/marketing/poll-live-${suffix}.png`,
    viewport: MARKETING_VIEWPORT,
    clip: PRESENTER_SLIDE,

    async state(api) {
      const { deckId, deck } = await seedMarketingDeck(api, lang);
      const slideId = deck.slideIds.poll;
      const slideIndex = deck.slideIds.all.indexOf(slideId);
      await startLiveSession(api, {
        deckId,
        slideId,
        slideType: 'poll-slide',
        slideIndex,
      });
      await seedPollVotes(api.base, {
        deckId,
        slideId,
        votes: MARKETING_POLL_VOTES,
      });
      return { deckId, slideId };
    },

    navigate: (ctx) =>
      `/present/${ctx.deckId}?slideId=${ctx.slideId}&lang=${deckLang}`,
    waitFor: '.presenter-start-curtain',

    async action(page) {
      await dismissPresenterStartGate(page);
      // Results arrive over the interaction poll after the stage renders, so
      // wait for the tally itself rather than for the slide element: shooting
      // early yields the zero state this shot exists to replace.
      await page.waitForFunction(
        (expected) => {
          const el = document.querySelector('.deck-stage-inner [data-poll-total]');
          if (!el) return false;
          const n = Number((el.textContent || '').replace(/\D+/g, ''));
          return n === expected;
        },
        { timeout: 20_000 },
        MARKETING_POLL_VOTES.reduce((a, b) => a + b, 0)
      );
    },
  };
}

/**
 * `join-screen-{nl,en}` — the follow-along invite on the big screen: QR, the
 * short URL and the access code.
 *
 * Needs a live session for the code to exist, and needs `APP_URL` set on the
 * capture run so the URL reads `deckyard.eu` rather than `localhost:4177`.
 *
 * **The invite copy follows the deck's dominant language, not the viewing
 * one.** `follow-invite-slide` declares no translatable fields (deliberately —
 * so translation cannot flip the invite), and the server rewrites
 * `content.sourceLang` to the deck's dominant on every save. A deck whose
 * dominant is `nl` therefore renders a Dutch invite in *both* versions, so the
 * English shot seeds a deck whose dominant is `en-GB`.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function joinScreenShot(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  return {
    id: `join-screen-${suffix}`,
    output: `join-screen-${suffix}.png`,
    registryPath: `public/images/marketing/join-screen-${suffix}.png`,
    viewport: MARKETING_VIEWPORT,
    clip: PRESENTER_SLIDE,

    async state(api) {
      // The invite renders in the dominant language, so the dominant *is* the
      // shot's language here — unlike the other two shapes in this file, where
      // the deck keeps its natural dominant and `?lang=` does the switching.
      const { deckId, deck } = await seedMarketingDeck(api, lang, {
        dominant: deckLang,
      });
      const slideId = deck.slideIds.followInvite;
      const slideIndex = deck.slideIds.all.indexOf(slideId);
      await startLiveSession(api, {
        deckId,
        slideId,
        slideType: 'follow-invite-slide',
        slideIndex,
      });
      return { deckId, slideId };
    },

    navigate: (ctx) =>
      `/present/${ctx.deckId}?slideId=${ctx.slideId}&lang=${deckLang}`,
    waitFor: '.presenter-start-curtain',

    async action(page) {
      await dismissPresenterStartGate(page);
      // The QR is drawn into a canvas after the slide mounts, and the access
      // code arrives with the session state. Both have to be there or the shot
      // shows an empty card.
      await page.waitForFunction(
        () => {
          const qr = document.querySelector('.deck-stage-inner canvas.sfi-qr');
          const code = document.querySelector('.deck-stage-inner .sfi-code');
          const drawn = qr instanceof HTMLCanvasElement && qr.width > 0;
          return drawn && !!code && (code.textContent || '').trim().length > 0;
        },
        { timeout: 20_000 }
      );
      // Last, so the runtime cannot overwrite it: the slide would otherwise
      // advertise the capture box. See rewriteJoinOrigin for why this is not
      // an APP_URL setting.
      await rewriteJoinOrigin(page, MARKETING_PUBLIC_ORIGIN);
    },
  };
}
