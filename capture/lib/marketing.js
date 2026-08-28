/**
 * Helpers the marketing capture recipes need and the docs recipes do not.
 *
 * Three things separate a marketing shot from a docs screenshot, and each one
 * is a mechanism rather than a setting:
 *
 * 1. **The UI language is an account setting, not a URL parameter.** `?lang=`
 *    switches the *deck content*; the app chrome follows `uiLocale` on the
 *    signed-in user, which `app.js` re-applies over any URL hint once settings
 *    load. So an `-nl` shot has to write the setting before navigating —
 *    `setUiLocale()` lives in `./api.js`, because the docs recipes turned out
 *    to need it too.
 * 2. **A poll only has votes inside a presentation session.** The editor
 *    preview always renders zeroes because `getPollInteractionAggregate` is
 *    session-scoped — so a live-result shot seeds a session, pushes live state
 *    onto the poll slide, and casts real votes through the same route an
 *    audience phone uses.
 * 3. **Both languages live in one deck.** The sample deck carries `nl` and
 *    `en-GB` in `i18n.versions` with shared slide ids, which the plain
 *    `seedDeck()` does not know how to write.
 *
 * See capture/README.md § Marketing shots.
 */

import { randomUUID } from 'node:crypto';

/**
 * Create a deck that carries both language versions, and return its id.
 *
 * `seedDeck()` writes a single-language deck. This one additionally fills the
 * `i18n` envelope, so `?lang=nl` and `?lang=en-GB` resolve to the two versions
 * of the *same* deck rather than to two decks that happen to look alike.
 *
 * @param {import('./api.js').ApiClient} api
 * @param {object} spec
 * @param {string} spec.title Deck title in the dominant language.
 * @param {string} spec.theme Theme id to pin (never left to the default: a
 *   marketing shot must not change colour when the default theme changes).
 * @param {'nl'|'en-GB'} spec.dominant
 * @param {Record<string, string>} spec.titles Title per language.
 * @param {Record<string, Array<object>>} spec.versions Slides per language.
 * @returns {Promise<string>} deck id
 */
export async function seedBilingualDeck(
  api,
  { title, theme, dominant, titles, versions },
) {
  const created = await api.post('/api/presentations', { title, theme });
  const id = created?.id || created?.presentation?.id;
  if (!id) throw new Error(`No id returned creating deck "${title}"`);

  const full = await api.get(`/api/presentations/${id}`);
  full.theme = theme;
  full.title = titles[dominant];
  full.lang = dominant;
  full.slides = versions[dominant];
  full.i18n = {
    dominant,
    active: dominant,
    versions: Object.fromEntries(
      Object.keys(versions).map((lang) => [
        lang,
        { title: titles[lang], slides: versions[lang] },
      ]),
    ),
  };
  await api.put(`/api/presentations/${id}`, full, {
    'If-Match': String(full.revision ?? 0),
  });
  return id;
}

/**
 * Open a live presentation session and park it on one slide.
 *
 * The session is what makes votes exist at all, and the pushed state is what
 * decides which slide those votes attach to — `handleFollowInteractionVote`
 * rejects a vote for any slide other than the session's current one.
 *
 * @param {import('./api.js').ApiClient} api
 * @param {object} spec
 * @param {string} spec.deckId
 * @param {string} spec.slideId
 * @param {string} spec.slideType
 * @param {number} spec.slideIndex Zero-based position of the slide in the deck.
 * @returns {Promise<{sessionId: string, followCodes: object}>}
 */
export async function startLiveSession(
  api,
  { deckId, slideId, slideType, slideIndex },
) {
  const session = await api.post('/api/live-sessions', {
    presentationId: deckId,
  });
  const sessionId = session?.sessionId;
  if (!sessionId) throw new Error(`No sessionId returned for deck ${deckId}`);
  await api.post(`/api/live-sessions/${sessionId}/state`, {
    presentationId: deckId,
    slideId,
    slideType,
    slideIndex,
    stepIdx: 0,
  });
  return { sessionId, followCodes: session.followCodes || {} };
}

/**
 * Cast real votes on a live poll, one per option per count.
 *
 * Deliberately goes through the public vote route rather than the storage
 * helper: that route is what an audience phone hits, so a result seeded this
 * way is a result the app can actually produce. One vote per device is
 * enforced on the `sb_int` cookie, so each vote carries a fresh device id.
 *
 * @param {string} base Dev server base URL.
 * @param {object} spec
 * @param {string} spec.deckId
 * @param {string} spec.slideId
 * @param {number[]} spec.votes Vote count per option, index 0 = options[0].
 * @returns {Promise<number>} total votes cast
 */
export async function seedPollVotes(base, { deckId, slideId, votes }) {
  let cast = 0;
  for (let option = 0; option < votes.length; option += 1) {
    for (let n = 0; n < votes[option]; n += 1) {
      const res = await fetch(
        `${base}/api/follow/${deckId}/interactions/${slideId}/vote`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Cookie: `sb_int=${randomUUID()}`,
          },
          body: JSON.stringify({ optionIndex: option }),
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `Vote ${cast + 1} (option ${option}) failed: ${res.status} ${text}`.trim(),
        );
      }
      cast += 1;
    }
  }
  await waitForPollTotal(base, { deckId, slideId, total: cast });
  return cast;
}

/**
 * Block until the server itself reports the expected tally.
 *
 * Without this the recipe hands a race to the browser: the page waits for the
 * total to appear on screen, which is a wall-clock bet on the interaction poll
 * landing inside the screenshot timeout. In a batch run that bet loses often
 * enough to fail one shot in six. Confirming server-side first turns the
 * browser's job back into "fetch a number that already exists".
 *
 * @param {string} base
 * @param {{deckId: string, slideId: string, total: number, timeoutMs?: number}} spec
 * @returns {Promise<void>}
 */
async function waitForPollTotal(
  base,
  { deckId, slideId, total, timeoutMs = 15_000 },
) {
  const deadline = Date.now() + timeoutMs;
  let seen = null;
  while (Date.now() < deadline) {
    const res = await fetch(
      `${base}/api/follow/${deckId}/interactions/${slideId}/state`,
    );
    if (res.ok) {
      const body = await res.json().catch(() => null);
      seen = Number(body?.interactionState?.total ?? NaN);
      if (seen === total) return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Poll tally never reached ${total} (last saw ${seen}) for slide ${slideId}`,
  );
}

/**
 * Dismiss the presenter's start gate, which otherwise blurs the whole view
 * behind a "Start in fullscreen / Start in window" dialog.
 *
 * Picks the *window* option on purpose: headless Chrome grants the Fullscreen
 * API inconsistently, and a shot that sometimes catches the request dialog is
 * not a deterministic shot.
 *
 * @param {import('puppeteer-core').Page} page
 * @returns {Promise<void>}
 */
export async function dismissPresenterStartGate(page) {
  await page.waitForSelector(START_CURTAIN, { visible: true, timeout: 15_000 });
  // Click the class, not the label: the curtain is translated, and matching on
  // its text would make each recipe's selector depend on its own language.
  await page.click(`${START_CURTAIN} .presenter-start-windowed`);
  await page.waitForFunction(
    (sel) => !document.querySelector(sel),
    { timeout: 10_000 },
    START_CURTAIN,
  );
}

/** The presenter's start curtain — see client/views/presenter/start-curtain.js. */
const START_CURTAIN = '.presenter-start-curtain';

/**
 * Target time seeded on the presenter console, in seconds.
 *
 * The console reads this from localStorage on start-up, so it renders as a
 * "Target 20:00" hint beside a stopped clock. Twenty minutes is a plausible
 * slot for the sample deck; the number matters only in that it is fixed.
 */
export const PRESENTER_CONSOLE_TARGET_SECONDS = 20 * 60;

/**
 * Answer the slide-translation call with the deck's own other-language text,
 * without reaching a model.
 *
 * The fill-from-translation preview is a network-driven surface: the modal
 * posts the source fields to `/api/presentations/:id/translate/fields` and only
 * renders once the response is in hand. A capture cannot let that call through
 * — it needs a provider key, it costs money, and it comes back slightly
 * different every run, which is three ways to fail the determinism rules at
 * once.
 *
 * So the request is intercepted and answered from the deck itself: the deck is
 * already bilingual, and the other version of the slide *is* the translation of
 * this one. Nothing on screen is invented; the model is simply not asked a
 * question the deck already answers.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {Record<string, unknown>} targetContent The slide's content in the
 *   language being filled — the field values the response should carry.
 * @returns {Promise<void>}
 */
export async function stubTranslateFields(page, targetContent) {
  await page.setRequestInterception(true);
  page.on('request', (request) => {
    if (
      !/\/api\/presentations\/[^/]+\/translate\/fields$/.test(request.url())
    ) {
      request.continue().catch(() => {});
      return;
    }
    let requested = {};
    try {
      requested = JSON.parse(request.postData() || '{}')?.fields || {};
    } catch {
      requested = {};
    }
    const translations = {};
    for (const key of Object.keys(requested)) {
      const value = targetContent?.[key];
      if (typeof value === 'string') translations[key] = value;
    }
    request
      .respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ translations }),
      })
      .catch(() => {});
  });
}

/**
 * The public origin a join screen should advertise. Overridable for a fork.
 */
export const MARKETING_PUBLIC_ORIGIN =
  process.env.CAPTURE_PUBLIC_ORIGIN || 'https://deckyard.eu';

/**
 * Rewrite the join screen's advertised origin, for the shot only.
 *
 * **This is not `APP_URL`.** The follow-invite slide builds its short URL in the
 * browser with `new URL('/go', location.origin)` (see
 * `client/lib/slide-runtime/follow-invite-runtime.js`), which is correct at
 * runtime — the presenter's own address *is* the address the room should type —
 * and is exactly why no server setting can change it. Captured on a dev box it
 * therefore reads `http://localhost:4177/go`, which is the one thing the shot
 * list rules out.
 *
 * So the substitution happens here, after render, in the open: the
 * human-readable URL is swapped. **The QR is not this function's concern.**
 * It must never be re-encoded to a *deck* URL — that would produce a scannable
 * code pointing at a deck id that exists on nobody's deckyard.eu, a worse lie
 * than a decorative code. {@link pinJoinCode}, which every shot calls right
 * after this one, re-encodes it to the public `/go` page instead, so the QR
 * says the same thing as the text this function writes. A shot with a
 * genuinely resolvable QR has to be taken on a real deckyard.eu instance;
 * nothing here can fake that.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} origin e.g. "https://deckyard.eu"
 * @returns {Promise<void>}
 */
export async function rewriteJoinOrigin(page, origin) {
  const rewrote = await page.evaluate((publicOrigin) => {
    const base = String(publicOrigin).replace(/\/+$/, '');
    let touched = 0;
    for (const el of document.querySelectorAll('[data-follow-go-url="1"]')) {
      el.textContent = `${base}/go`;
      if (el.tagName === 'A') el.setAttribute('href', `${base}/go`);
      touched += 1;
    }
    return touched;
  }, origin);
  if (!rewrote) {
    throw new Error(
      'Join-screen origin rewrite matched nothing — [data-follow-go-url] moved.',
    );
  }
}

/**
 * The join codes every marketing shot is pinned to, keyed the way the session
 * files them (`nl`/`en`, one per follow URL).
 *
 * Both are five letters from `CODE_ALPHABET` in `server/storage/follow-codes.js`
 * — the reduced alphabet that drops the lookalikes — so a pinned code is
 * shaped exactly like a minted one. `tests/capture-join-code-pin.test.js` pins
 * that agreement, because a code the mint could never produce would read as a
 * typo in a marketing shot.
 *
 * The words are the Dutch and English names for the thing this project is named
 * after; there is no deeper meaning, and nothing resolves them. See
 * {@link pinJoinCode} for why an unresolvable code is the honest choice.
 */
export const MARKETING_FOLLOW_CODES = { nl: 'HAVEN', en: 'WHARF' };

/**
 * Pin the join code — and the QR beside it — so a shot reproduces byte for byte.
 *
 * **Why this exists.** A follow code is minted per session, so two capture runs
 * of the same recipe differ in the code region and in the QR that encodes the
 * session. Measured on 2026-08-28 (capture/README.md § *What two runs on one
 * host actually produce*): 8 of the 16 shots differed in exactly that region
 * and nowhere else. Eight PNGs churning in every weekly refresh PR say nothing,
 * and a signal that always fires gets ignored.
 *
 * **Why here rather than in the comparison.** The alternative was to loosen the
 * refresh gate for these eight. That trades a precise signal for a blind spot
 * in the shots that carry the live-session story — the ones most worth
 * watching. So the non-determinism is removed at the source instead, in the
 * same layer and the same after-render moment as {@link rewriteJoinOrigin}.
 *
 * **What it substitutes.** Every element the renderers mark with
 * `data-follow-code="<nl|en>"` — the invite slide's code, the poll slide's two,
 * the feedback slide's two — gets its language's pinned code. The marker exists
 * for the same reason `data-follow-go-url` does: a capture hook that is not a
 * style class and cannot be renamed by a CSS tidy-up.
 *
 * **The QR.** {@link rewriteJoinOrigin} deliberately leaves it alone, on the
 * grounds that re-encoding would produce a scannable code pointing at a deck id
 * that exists on nobody's deckyard.eu. That argument still holds, and this
 * function does not contradict it: the QR is re-encoded to the *public `/go`
 * page* — `https://deckyard.eu/go`, a page that genuinely exists — not to a
 * fabricated deck URL. It therefore says the same thing as the text beside it
 * ("go to deckyard.eu/go"), which is strictly more truthful than the localhost
 * follow URL it encoded before, and it is deterministic. What remains untrue is
 * that the pinned code is not live; typing it yields "code not found", which is
 * the same untruth the printed code already carried and cannot be fixed from a
 * capture box. A shot with a genuinely scannable, resolvable QR has to be taken
 * on a real deckyard.eu instance.
 *
 * **Why it keeps enforcing.** `follow-invite-runtime.js` fills a `----`
 * placeholder from an async `POST /api/follow-codes`, which can land *after*
 * this call — that is how the editor-side shots (the invite thumbnail in the
 * slide rail) get their code at all. A one-shot substitution would lose that
 * race intermittently, which is the churn this function exists to remove, so
 * each pinned element keeps a MutationObserver that re-applies the code for the
 * rest of the page's life.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} origin e.g. "https://deckyard.eu"
 * @returns {Promise<void>}
 */
export async function pinJoinCode(page, origin) {
  const pinned = await page.evaluate(
    async (codes, publicOrigin) => {
      const base = String(publicOrigin).replace(/\/+$/, '');
      const goUrl = `${base}/go`;

      const marked = Array.from(
        document.querySelectorAll('[data-follow-code]'),
      );
      for (const el of marked) {
        const code = codes[el.dataset.followCode];
        if (!code) continue;
        const apply = () => {
          if (el.textContent !== code) el.textContent = code;
        };
        apply();
        new MutationObserver(apply).observe(el, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }

      // Only canvases the runtime actually drew. One it skipped has no follow
      // URL to encode, and drawing it here would put a QR in the shot that the
      // app does not show — inventing UI rather than pinning it.
      const canvases = Array.from(
        document.querySelectorAll('canvas[data-follow-qr="1"]'),
      ).filter((canvas) => canvas.width > 0);
      if (canvases.length) {
        // The app's own renderer, not a second implementation of it: a QR the
        // capture drew differently from the product would be a shot of
        // something that does not ship. The specifier is not a path on this
        // side of the wire — this body runs in the page, and the string is the
        // URL the server publishes the module at.
        // eslint-disable-next-line import-x/no-unresolved
        const qr = await import('/client/lib/slide-runtime/poll.js');
        const { renderQrToCanvas } = qr;
        for (const canvas of canvases) {
          // Also the source of truth for any later re-render (the runtime
          // redraws on resize).
          canvas.dataset.followUrl = goUrl;
          const cardW =
            Number(canvas.parentElement?.clientWidth || 0) ||
            Number(canvas.getBoundingClientRect?.().width || 0) ||
            0;
          const maxPx = Math.min(
            560,
            Math.max(160, Math.floor((cardW || window.innerWidth) - 28)),
          );
          if (!renderQrToCanvas(canvas, goUrl, { maxPx })) {
            return { codes: -1, qrs: -1 };
          }
        }
      }

      return { codes: marked.length, qrs: canvases.length };
    },
    MARKETING_FOLLOW_CODES,
    origin,
  );

  if (pinned.codes < 0) {
    throw new Error('Join-code pin could not redraw a follow QR canvas.');
  }
  if (!pinned.codes && !pinned.qrs) {
    throw new Error(
      'Join-code pin matched nothing — [data-follow-code] and the follow QR both moved.',
    );
  }
}

/**
 * Viewport every marketing shot uses: 1280×800 at 2× → a 2560×1600 PNG.
 *
 * Deliberately not the harness default (1440×900 @2x). Rule 6 of the shot list
 * in deckyard-website `planning/marketing-beeld.md` fixes this size, because
 * the site's layout is built around it; a docs screenshot has no such caller.
 */
export const MARKETING_VIEWPORT = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
};

/** The rendered slide inside the presenter stage — the "pure slide" clip target. */
export const PRESENTER_SLIDE = '.deck-stage-inner .deck-slide';

/**
 * Theme every marketing shot is pinned to.
 *
 * Pinned rather than left to `DEFAULT_THEME_ID` on purpose: a marketing shot
 * must not silently change colour the day someone changes the default. When
 * the brand theme moves, this constant moves with it and every shot is
 * flagged stale by its recipe hash.
 */
export const MARKETING_THEME = 'brand';

/**
 * Language pair every marketing shot ships in.
 *
 * The two codes differ on purpose, and mixing them up is the trap here:
 *
 * - **`deckLang`** is a *presentation* language. `normalizeLang()` accepts only
 *   `nl` and `en-GB`, so `?lang=en` silently falls back to the deck's dominant
 *   language and the "English" shot comes out Dutch.
 * - **`uiLocale`** is a *UI* locale id from `client/i18n/manifest.json`, where
 *   English is plain `en` (the dictionary lives in `client/i18n/en/`). There is
 *   no `en-GB` entry, and an unknown id leaves the chrome on its previous
 *   language rather than erroring.
 */
export const MARKETING_LANGS = {
  nl: { suffix: 'nl', deckLang: 'nl', uiLocale: 'nl' },
  en: { suffix: 'en', deckLang: 'en-GB', uiLocale: 'en' },
};
