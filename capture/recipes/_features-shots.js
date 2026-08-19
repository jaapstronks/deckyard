/**
 * The four `/features` marketing shot shapes, each a factory over the language
 * pair. The three home-page shapes live in `_marketing-shots.js`; everything
 * they share (viewport, pinned theme, the bilingual sample deck, the UI-locale
 * rule) is the same here.
 *
 * These four differ from the home-page three in what they photograph: not a
 * slide but a *surface* — the presenter's own screen, the comments pane, the
 * share dialog, the fill-from-translation preview. Each one therefore has a
 * state that only exists after something happened (a session, two people
 * commenting, a link with rules on it, a translation), and the interesting
 * part of every recipe below is how that state is produced honestly.
 *
 * A change *in this file* moves the registry hash of the eight shots built on
 * it, same as the home-page shapes: `hashRecipeGraph()` walks each recipe's
 * imports within `capture/`. See `capture/README.md` § Known limits.
 */

import { createShareLink } from '../lib/api.js';
import {
  MARKETING_LANGS,
  MARKETING_PUBLIC_ORIGIN,
  MARKETING_VIEWPORT,
  PRESENTER_CONSOLE_TARGET_SECONDS,
  dismissPresenterStartGate,
  rewriteJoinOrigin,
  seedPollVotes,
  stubTranslateFields,
  startLiveSession,
} from '../lib/marketing.js';
import {
  closeCommentSeedStorage,
  seedCommentThreads,
} from '../lib/comments-seed.js';
import {
  MARKETING_COMMENT_THREADS,
  MARKETING_POLL_VOTES,
  MARKETING_SHARE_LINK,
  seedMarketingDeck,
} from './_marketing-deck.js';

/** Suppresses the inline-edit coach mark, which otherwise sits over the preview. */
const EDITOR_LOCAL_STORAGE = { 'editor.inline.coachSeen': '1' };

/**
 * The presenter shot's own viewport, wider than {@link MARKETING_VIEWPORT}.
 * On a poll slide the topbar gains the poll controls (state pill, Download,
 * Open/Close/Reset) and measures 1492px in English and 1614px in Dutch, so at
 * 1280 it overflows and any click on the console scrolls the page sideways.
 * Same 16:10 as the others.
 */
const PRESENTER_VIEWPORT = { width: 1760, height: 1100, deviceScaleFactor: 2 };

/**
 * Wait until the editor has finished its first render.
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<void>}
 */
async function editorReady(page) {
  await page
    .waitForFunction(
      () => !document.querySelector('.editor-loading-skeleton'),
      {
        timeout: 15_000,
      },
    )
    .catch(() => {});
}

/**
 * `presenter-view-{nl,en}` — the presenter's own screen during a talk: the
 * stage on the left, the console beside it with the timer, the next slide and
 * the speaker notes for the slide that is up.
 *
 * Three deliberate choices:
 *
 * - **Console mode is a stored preference, not a URL.** `presenter-console.js`
 *   reads `deckyard:presenterConsole` on start-up, so the recipe seeds it in
 *   localStorage rather than clicking the toggle after the fact.
 * - **The timer is stopped and zeroed**, so the clock reads `0:00` under a
 *   "Target 20:00" hint. Starting the presentation starts the stopwatch, and a
 *   running stopwatch is the one thing on this screen that cannot be captured
 *   deterministically — two runs differ by whatever the page took to settle.
 *   Faking an elapsed time would be staging a number rather than photographing
 *   a state, so the recipe pauses and resets instead.
 * - **Windowed, not fullscreen.** The chrome auto-hide only runs in fullscreen
 *   (see `chrome-autohide.js`), so windowed mode keeps the presenter toolbar in
 *   frame instead of racing it.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function presenterViewShot(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  return {
    id: `presenter-view-${suffix}`,
    output: `presenter-view-${suffix}.png`,
    registryPath: `public/images/marketing/presenter-view-${suffix}.png`,
    viewport: PRESENTER_VIEWPORT,
    localStorage: {
      'deckyard:presenterConsole': '1',
      'deckyard:presenterConsoleTargetSeconds': String(
        PRESENTER_CONSOLE_TARGET_SECONDS,
      ),
    },

    async state(api) {
      const { deckId, deck } = await seedMarketingDeck(api, lang);
      // The poll slide: /features hangs this shot on "the audience answers on
      // the slide itself", so the slide that is up has to be one being
      // answered — with a real, uneven tally on the bars. Its notes are worth
      // reading, and the end slide after it makes a legible "Next" thumbnail.
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
      // The console fills in after the deck resolves: notes come from the
      // slide, the thumbnail is rendered by the slide runtime. Waiting for
      // both means the shot cannot catch a half-built panel.
      await page.waitForFunction(
        () => {
          const notes = document.querySelector('.presenter-console-notes-body');
          const thumb = document.querySelector('.presenter-console-thumb');
          const hasNotes =
            !!notes && (notes.textContent || '').trim().length > 20;
          const hasNext = !!thumb && !thumb.classList.contains('is-empty');
          return hasNotes && hasNext;
        },
        { timeout: 20_000 },
      );
      // The tally arrives over the interaction poll after the stage renders,
      // so wait for the seeded total on the stage itself: shooting early gets
      // the zero state, and a poll at zero is the timeline slide with bars.
      await page.waitForFunction(
        (expected) => {
          const el = document.querySelector(
            '.deck-stage-inner [data-poll-total]',
          );
          if (!el) return false;
          const n = Number((el.textContent || '').replace(/\D+/g, ''));
          return n === expected;
        },
        { timeout: 20_000 },
        MARKETING_POLL_VOTES.reduce((a, b) => a + b, 0),
      );
      // Stop the stopwatch the presentation started, then zero it: reset alone
      // restarts a running timer (see console-timer.js), and a running clock
      // makes the shot a race against its own settle time.
      await page.click('.presenter-console-timer-toggle');
      await page.click('.presenter-console-timer-reset');
      await page.waitForFunction(
        () =>
          document
            .querySelector('.presenter-console-clock')
            ?.textContent?.trim() === '0:00',
        { timeout: 5_000 },
      );
      // page.click scrolls its target into view; if anything overflowed after
      // all, that scroll would crop the frame. Pin the origin before the shot.
      await page.evaluate(() => window.scrollTo(0, 0));
    },
  };
}

/**
 * `comments-{nl,en}` — the comments pane beside the live preview, with one
 * thread still open and one already resolved.
 *
 * The status filter has to be moved to "All": the pane opens on Open, which is
 * right for working and wrong for a photograph — a shot of only open threads
 * cannot show that resolving is where a thread ends up.
 *
 * The authors are seeded through storage rather than the API; see
 * `capture/lib/comments-seed.js` for why the REST route cannot express two
 * people under a dev-bypass session.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function commentsShot(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  return {
    id: `comments-${suffix}`,
    output: `comments-${suffix}.png`,
    registryPath: `public/images/marketing/comments-${suffix}.png`,
    viewport: MARKETING_VIEWPORT,
    localStorage: EDITOR_LOCAL_STORAGE,

    async state(api) {
      // Dominant = the shot's language. The editor opens the deck's *active*
      // version, which is its dominant one, so a Dutch-dominant deck would put
      // Dutch slide text and Dutch notes under English chrome — the one thing
      // rule 3 of the shot list rules out.
      const { deckId, deck } = await seedMarketingDeck(api, lang, {
        dominant: deckLang,
      });
      const slideId = deck.slideIds.funnel;
      await seedCommentThreads(
        deckId,
        MARKETING_COMMENT_THREADS[lang].map((thread) => ({
          ...thread,
          slideId,
        })),
      );
      return { deckId, slideId };
    },

    navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,
    waitFor: '.app-shell.editor-shell .slides-add-btn',

    async action(page) {
      await editorReady(page);
      await page.click('.pane-tabs .pane-tab[data-value="comments"]');
      await page.waitForSelector('.comments-panel .comments-panel-list', {
        visible: true,
        timeout: 10_000,
      });
      // Status "All" — the dropdown is a <details>, so open it, pick, close.
      const filter = await page.$('.comments-filter-dropdown');
      if (!filter) throw new Error('Comments filter dropdown not found');
      await page.click('.comments-filter-dropdown .comments-filter-trigger');
      await page.click('.comments-filter-menu [data-status="all"]');
      await page.evaluate(() => {
        const el = document.querySelector('.comments-filter-dropdown');
        if (el instanceof HTMLDetailsElement) el.open = false;
      });
      // Both threads land before the shot: one resolved card, one open card.
      await page.waitForFunction(
        () => {
          const threads = document.querySelectorAll(
            '.comments-panel-list .comment-thread',
          );
          const resolved = document.querySelectorAll(
            '.comments-panel-list .comment-item.comment-resolved',
          );
          return threads.length >= 2 && resolved.length >= 1;
        },
        { timeout: 10_000 },
      );
      // The slide rail renders the invite slide as a thumbnail, and that
      // thumbnail carries the same client-built join URL the join-screen shot
      // has to rewrite — small in frame, but it is still the capture box's
      // address. Same substitution, same reason (see rewriteJoinOrigin).
      await rewriteJoinOrigin(page, MARKETING_PUBLIC_ORIGIN);
    },

    async cleanup() {
      await closeCommentSeedStorage();
    },
  };
}

/**
 * `share-link-rules-{nl,en}` — the share dialog on its Link tab: the rules a
 * link can carry, and one live link carrying them.
 *
 * Both halves are needed. The form alone is a set of empty controls; the list
 * alone is a lock icon and a date whose origin you cannot see. Together they
 * read as "you set this, and this is what you set".
 *
 * The link in the list is created over the API before the page opens, so it is
 * a real record with a real expiry, not a rendered mock. The form's controls
 * are then set to the same rules — no click on Create, because a second link
 * would appear mid-shot.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function shareLinkRulesShot(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  const copy = MARKETING_SHARE_LINK[lang];
  return {
    id: `share-link-rules-${suffix}`,
    output: `share-link-rules-${suffix}.png`,
    registryPath: `public/images/marketing/share-link-rules-${suffix}.png`,
    // Taller than the marketing default on purpose: the dialog is capped at
    // 80vh and scrolls internally, so on an 800-high viewport the shot ends
    // halfway through the very link it is meant to show. The shot is clipped
    // to the dialog anyway, so the window behind it is never in frame.
    viewport: { ...MARKETING_VIEWPORT, height: 1200 },
    clip: '.modal.share-modal',
    localStorage: EDITOR_LOCAL_STORAGE,

    async state(api) {
      // Dominant follows the shot's language for the same reason the comments
      // shot pins it: the dialog is clipped out of the editor, but the deck
      // behind it should not be in the other language regardless.
      const { deckId, deck } = await seedMarketingDeck(api, lang, {
        dominant: deckLang,
      });
      await createShareLink(api, deckId, {
        permission: 'comment',
        label: copy.label,
        password: copy.password,
        expiresAt: copy.expiresAt(),
      });
      return { deckId, slideId: deck.slideIds.funnel };
    },

    navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,
    waitFor: '.app-shell.editor-shell .slides-add-btn',

    async action(page) {
      await editorReady(page);
      await page.click('.editor-share-btn');
      await page.waitForSelector('.modal.share-modal .share-tabs', {
        visible: true,
        timeout: 10_000,
      });
      await page.click('.share-tabs [data-value="link"]');
      await page.waitForSelector(
        '.share-tab-panel[data-tab="link"] .share-link-item',
        {
          visible: true,
          timeout: 10_000,
        },
      );
      // Set the create form to the same rules the listed link carries. Native
      // setters + an input event, because the selects and inputs are plain DOM
      // with change listeners on them.
      await page.evaluate((password) => {
        const set = (el, value, event) => {
          if (!el) return;
          el.value = value;
          el.dispatchEvent(new Event(event, { bubbles: true }));
        };
        set(
          document.querySelector('.share-permission-select'),
          'comment',
          'change',
        );
        set(
          document.querySelector('.share-expiration-select'),
          '30d',
          'change',
        );
        set(document.querySelector('.share-password-input'), password, 'input');
      }, copy.password);
    },
  };
}

/**
 * `ai-fills-fields-{nl,en}` — the fill-from-translation preview: per declared
 * field, its label, the source text and what the model produced for it.
 *
 * This is the surface where the AI claim is literally visible. The field names
 * are the app's, not the model's; the model is handed one named field at a
 * time and hands text back; nothing is applied until the Apply button is
 * pressed. A generation wizard would have shown a prompt box, which proves the
 * opposite of "it fills in, it does not design".
 *
 * **No model is called.** `/api/presentations/:id/translate/fields` is
 * intercepted and answered with the deck's *own* other-language text, which is
 * both deterministic and true: the response says what the field says in the
 * other version of this deck. A live call would need a key, cost money, and
 * come back slightly different every run.
 *
 * The English shot seeds a deck whose dominant language is `en-GB`: the modal
 * fills the deck's *active* version from the other one, so the direction of the
 * arrow in the title follows the dominant.
 *
 * The funnel slide, for two reasons that both come down to the labels. Only
 * top-level string fields are translatable (`translatable.js`), so a slide with
 * eight of them — the comparison — makes a preview three times taller than it
 * is wide, unusable as a figure. And the funnel's field labels are among the
 * ones `client/i18n/nl/slide-types.json` actually carries; on a type with no
 * Dutch field labels the preview would name its fields in English inside a
 * Dutch dialog, which is precisely the sloppiness this shot is claiming the
 * product avoids.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').Recipe}
 */
export function aiFillsFieldsShot(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  const sourceLang = deckLang === 'nl' ? 'en-GB' : 'nl';
  return {
    id: `ai-fills-fields-${suffix}`,
    output: `ai-fills-fields-${suffix}.png`,
    registryPath: `public/images/marketing/ai-fills-fields-${suffix}.png`,
    viewport: MARKETING_VIEWPORT,
    clip: '.modal.translate-slide-modal',
    localStorage: EDITOR_LOCAL_STORAGE,

    async state(api) {
      // Dominant = the shot's language, so the preview fills *this* version.
      const { deckId, deck } = await seedMarketingDeck(api, lang, {
        dominant: deckLang,
      });
      const slideId = deck.slideIds.funnel;
      const target = deck.versions[deckLang].find((s) => s.id === slideId);
      const source = deck.versions[sourceLang].find((s) => s.id === slideId);
      return { deckId, slideId, target, source };
    },

    navigate: (ctx) => `/app/${ctx.deckId}?slideId=${ctx.slideId}`,
    waitFor: '.app-shell.editor-shell .slides-add-btn',

    async action(page, ctx) {
      // The stub has to be in place before the menu item is clicked: the modal
      // only renders once the response is in hand.
      await stubTranslateFields(page, ctx.target.content);
      await editorReady(page);
      await page.click('.slide-actions-btn');
      await page.waitForSelector(
        '.slide-actions-menu .slide-fill-translation-item',
        {
          visible: true,
          timeout: 10_000,
        },
      );
      await page.click('.slide-actions-menu .slide-fill-translation-item');
      await page.waitForSelector(
        '.modal.translate-slide-modal .translate-preview-list',
        {
          visible: true,
          timeout: 15_000,
        },
      );
    },
  };
}
