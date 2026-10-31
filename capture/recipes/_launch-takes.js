/**
 * The launch video's app takes, each a factory over the language pair.
 *
 * Five clips of the launch script (deckyard-planning
 * `briefs/launch-video-script.md`, rows 5, 7, 9, 10 and 11), each one idea
 * and one camera move. Every factory starts from the state a marketing shot
 * already reaches — same deck, same seeding, same readiness — and adds only
 * the motion a still cannot show. Where a shot's setup fits as it is, the take
 * takes it by reference, so the clip and the photograph cannot drift into two
 * different screens.
 *
 * Shot in both languages because the launch video ships in both: the overlay
 * is the only layer the composition swaps, so English words over Dutch app
 * chrome would be the one thing in the English video that is not English. The
 * composition resolves `<take>-<lang>` first (deckyard-video
 * `spec/takes.ts`), so the spec names these as `editor-tour`, `theme-colours`
 * and so on.
 *
 * The thin `<id>.js` modules beside this one only name a language and a
 * factory, like the marketing pairs: the `-nl` and `-en` halves stay provably
 * identical apart from the language.
 */

import {
  CAPTURE_ACCOUNT_NAME,
  setDisplayName,
  setUiLocale,
} from '../lib/api.js';
import {
  MARKETING_LANGS,
  MARKETING_PUBLIC_ORIGIN,
  PRESENTER_CONSOLE_TARGET_SECONDS,
  castPollVote,
  dismissPresenterStartGate,
  pinJoinCode,
  seedPollVotes,
  startLiveSession,
  waitForStageTally,
} from '../lib/marketing.js';
import { VIDEO_VIEWPORT } from '../lib/record.js';
import { commentsShot } from './_features-shots.js';
import { MARKETING_POLL_VOTES, seedMarketingDeck } from './_marketing-deck.js';
import { editorCanvasShot } from './_marketing-shots.js';

/**
 * The parts of a shot that say *how to reach the state*. `output`,
 * `registryPath`, `clip`, `fullPage` and `viewport` describe one PNG in the
 * website registry and have no meaning for a take.
 *
 * @param {import('../lib/recipe.js').Recipe} shot
 */
function setupOf(shot) {
  const { localStorage, state, navigate, waitFor, action, cleanup } = shot;
  return { localStorage, state, navigate, waitFor, action, cleanup };
}

/**
 * A thumbnail in the editor's slide rail, by position.
 * @param {number} n 1-based
 */
const railThumb = (n) =>
  `.slides-panel .slide-item:nth-child(${n} of .slide-item) .thumb`;

/**
 * Row 5, "Presentations on your own server" — the editor, moving through the
 * deck. The opening clip after the hook, so it shows the whole product at
 * rest and then one step of work: two slides picked from the rail, the canvas
 * following each.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').VideoRecipe}
 */
export function editorTourTake(lang) {
  return {
    id: `editor-tour-${MARKETING_LANGS[lang].suffix}`,
    kind: 'video',
    viewport: VIDEO_VIEWPORT,
    ...setupOf(editorCanvasShot(lang)),

    record: {
      fps: 30,
      /** @param {import('../lib/recipe.js').Recorder} rec */
      async sequence(rec) {
        // Three bars: the first second is the editor as a whole.
        await rec.hold(900);
        // The funnel: the slide with the most to look at.
        await rec.click(railThumb(3), { label: 'slide' });
        await rec.hold(1500);
        await rec.click(railThumb(4));
        await rec.hold(2800);
      },
    },
  };
}

/** The first two colour fields of the theme editor: primary, background. */
const THEME_COLOUR = (/** @type {number} */ n) =>
  `.theme-colors-grid > .theme-color-picker:nth-child(${n}) .theme-color-picker-text`;

/** The live preview column of the theme editor. */
const THEME_PREVIEW = '.theme-editor .theme-editor-preview';

/**
 * Row 7, "Your brand, in JSON" — a new theme taking a brand's colours, the
 * preview recolouring as the hex codes are typed. Nothing is saved: the
 * editor is left open and the take ends before Save.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').VideoRecipe}
 */
export function themeColoursTake(lang) {
  const { suffix, uiLocale } = MARKETING_LANGS[lang];
  return {
    id: `theme-colours-${suffix}`,
    kind: 'video',
    viewport: VIDEO_VIEWPORT,

    async state(api) {
      await setUiLocale(api, uiLocale);
      await setDisplayName(api, CAPTURE_ACCOUNT_NAME);
      return {};
    },

    navigate: '/settings#themes',
    // The Create button is the primary action in the themes list header;
    // matched by place rather than by its label, which is in two languages.
    waitFor: '.themes-list-header .btn-primary',

    async action(page) {
      await page.click('.themes-list-header .btn-primary');
      await page.waitForSelector('.theme-editor', { visible: true });
      // The colour card in the middle of the frame, the preview beside it.
      await page.$eval(THEME_COLOUR(1), (el) =>
        el.scrollIntoView({ block: 'center' }),
      );
    },

    record: {
      fps: 30,
      /** @param {import('../lib/recipe.js').Recorder} rec */
      async sequence(rec) {
        await rec.hold(500);
        await rec.type(THEME_COLOUR(1), '#C2410C', {
          clear: true,
          label: 'primary',
        });
        await rec.type(THEME_COLOUR(2), '#FFF7ED', { clear: true });
        await rec.hold(300);
        // The payoff is the preview, not the field.
        await rec.move(THEME_PREVIEW, { label: 'preview' });
        await rec.hold(1600);
      },
    },
  };
}

/** Votes on the stage when the take starts: the result already leaning. */
const POLL_OPENING_VOTES = [1, 1, 4, 1];

/**
 * The votes still to come, one option index per vote, spread so every bar
 * grows at its own rate instead of option A filling up before B starts.
 * Each option's votes are placed at evenly spaced fractions of the run and
 * the whole list is ordered by place: a fixed order, so two runs agree.
 *
 * @param {number[]} from votes per option already cast
 * @param {number[]} to votes per option at the end
 * @returns {number[]}
 */
export function pollArrivals(from, to) {
  const placed = [];
  to.forEach((total, option) => {
    const count = total - (from[option] ?? 0);
    for (let k = 0; k < count; k += 1)
      placed.push({ at: (k + 0.5) / count, option });
  });
  placed.sort((a, b) => a.at - b.at || a.option - b.option);
  return placed.map((p) => p.option);
}

/** Milliseconds between two arriving votes: 40 votes in under two seconds. */
const POLL_VOTE_GAP_MS = 45;

/** The results card on the stage: bars and total. */
const POLL_RESULTS = '.deck-stage-inner .deck-slide .poll-results';

/**
 * Row 9, "The room follows along. And votes." — the poll on the presenter's
 * stage while votes come in. The take opens on the result already leaning
 * and casts the rest through the public vote route while it records, one
 * fresh device per vote, so the bars move because an audience moved them.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').VideoRecipe}
 */
export function pollVotesTake(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  /** Set by `action`; `sequence` gets only the recorder. */
  let live =
    /** @type {null | {base: string, deckId: string, slideId: string}} */ (
      null
    );
  return {
    id: `poll-votes-${suffix}`,
    kind: 'video',
    viewport: VIDEO_VIEWPORT,

    async state(api) {
      const { deckId, deck } = await seedMarketingDeck(api, lang);
      const slideId = deck.slideIds.poll;
      await startLiveSession(api, {
        deckId,
        slideId,
        slideType: 'poll-slide',
        slideIndex: deck.slideIds.all.indexOf(slideId),
      });
      await seedPollVotes(api.base, {
        deckId,
        slideId,
        votes: POLL_OPENING_VOTES,
      });
      return { deckId, slideId, base: api.base };
    },

    navigate: (ctx) =>
      `/present/${ctx.deckId}?slideId=${ctx.slideId}&lang=${deckLang}`,
    waitFor: '.presenter-start-curtain',

    async action(page, ctx) {
      await dismissPresenterStartGate(page);
      await waitForStageTally(
        page,
        POLL_OPENING_VOTES.reduce((a, b) => a + b, 0),
        ctx,
      );
      await pinJoinCode(page, MARKETING_PUBLIC_ORIGIN);
      live = /** @type {any} */ (ctx);
    },

    record: {
      fps: 30,
      /** @param {import('../lib/recipe.js').Recorder} rec */
      async sequence(rec) {
        if (!live) throw new Error('poll-votes: action did not run');
        const { base, deckId, slideId } = live;
        const arrivals = pollArrivals(POLL_OPENING_VOTES, MARKETING_POLL_VOTES);
        // Votes run beside the schedule, not in it: the recorder keeps its
        // own clock, and the audience does not wait for the camera.
        // Each vote is sent at its own fixed moment, not after the previous
        // one returns: a run of round trips is as slow as the host, and the
        // last votes would land after the cut.
        const voting = Promise.all(
          arrivals.map(
            (optionIndex, i) =>
              new Promise((resolve, reject) => {
                setTimeout(() => {
                  castPollVote(base, { deckId, slideId, optionIndex }).then(
                    resolve,
                    reject,
                  );
                }, i * POLL_VOTE_GAP_MS);
              }),
          ),
        );
        await rec.hold(400);
        await rec.move(POLL_RESULTS, { label: 'results' });
        await rec.hold(3600);
        await voting;
      },
    },
  };
}

/**
 * Row 10, "Review without the email thread" — the comments pane on the
 * funnel slide, and the open thread being resolved. Built on the comments
 * marketing shot (two people, one thread open and one resolved, filter on
 * All), so the resolved card stays in view instead of leaving the list.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').VideoRecipe}
 */
export function commentResolveTake(lang) {
  const resolve = '.comments-panel-list .comment-thread .comment-resolve';
  return {
    id: `comment-resolve-${MARKETING_LANGS[lang].suffix}`,
    kind: 'video',
    viewport: VIDEO_VIEWPORT,
    ...setupOf(commentsShot(lang)),

    record: {
      fps: 30,
      /** @param {import('../lib/recipe.js').Recorder} rec */
      async sequence(rec) {
        await rec.hold(600);
        // The camera goes to the thread; the click is the payoff.
        await rec.move(resolve, { label: 'thread' });
        await rec.hold(400);
        await rec.click(resolve);
        await rec.hold(2400);
      },
    },
  };
}

/**
 * Row 11, "Notes where only you see them" — the presenter console on the KPI
 * slide: the talk starts (the stopwatch runs from 0:00) and the camera goes
 * to the speaker notes. Not the poll slide the presenter-view shot uses: the
 * poll is row 9's clip, and two clips of one screen read as one.
 *
 * @param {'nl'|'en'} lang
 * @returns {import('../lib/recipe.js').VideoRecipe}
 */
export function presenterNotesTake(lang) {
  const { suffix, deckLang } = MARKETING_LANGS[lang];
  return {
    id: `presenter-notes-${suffix}`,
    kind: 'video',
    viewport: VIDEO_VIEWPORT,
    localStorage: {
      'deckyard:presenterConsole': '1',
      'deckyard:presenterConsoleTargetSeconds': String(
        PRESENTER_CONSOLE_TARGET_SECONDS,
      ),
    },

    async state(api) {
      const { deckId, deck } = await seedMarketingDeck(api, lang);
      return { deckId, slideId: deck.slideIds.kpi };
    },

    navigate: (ctx) =>
      `/present/${ctx.deckId}?slideId=${ctx.slideId}&lang=${deckLang}`,
    waitFor: '.presenter-start-curtain',

    async action(page) {
      await dismissPresenterStartGate(page);
      await page.waitForFunction(
        () => {
          const notes = document.querySelector('.presenter-console-notes-body');
          const thumb = document.querySelector('.presenter-console-thumb');
          return (
            (notes?.textContent || '').trim().length > 20 &&
            !!thumb &&
            !thumb.classList.contains('is-empty')
          );
        },
        { timeout: 20_000 },
      );
      // Starting the presentation started the stopwatch; stop and zero it,
      // so the take starts the talk on camera rather than mid-way.
      await page.click('.presenter-console-timer-toggle');
      await page.click('.presenter-console-timer-reset');
      await page.waitForFunction(
        () =>
          document
            .querySelector('.presenter-console-clock')
            ?.textContent?.trim() === '0:00',
        { timeout: 5_000 },
      );
    },

    record: {
      fps: 30,
      /** @param {import('../lib/recipe.js').Recorder} rec */
      async sequence(rec) {
        await rec.hold(500);
        await rec.click('.presenter-console-timer-toggle');
        await rec.hold(400);
        await rec.move('.presenter-console-notes-body', { label: 'notes' });
        await rec.hold(2600);
      },
    },
  };
}
