/**
 * Video plumbing for the capture runner: a screencast plus the event log that
 * makes the recording composable.
 *
 * A screenshot recipe ends at `page.screenshot()`. A video recipe instead hands
 * its `record.sequence` a recorder — the `rec` object built here — and every
 * step it drives is written to `events/<id>.json` alongside the WebM. The
 * composition (deckyard-video) reads that log and derives the camera from it:
 * a labelled step is a zoom candidate, its coordinate is the focus point. That
 * is the whole reason the log exists — without it the zooms would be timed by
 * hand against a video file, and a restyled UI would silently break them.
 *
 * Three properties this module exists to guarantee:
 *
 * 1. **`t = 0` is the first recorded frame, not `page.goto()`.**
 *    `page.screencast()` resolves only after CDP has delivered the first
 *    `Page.screencastFrame` (see `Page._startScreencast`), so the clock starts
 *    where the video starts. The "~1 second of white frames" that plagues
 *    Playwright's `recordVideo` is a symptom of the opposite: an encoder that
 *    starts at navigation. Here the page is already rendered and settled.
 *
 * 2. **Every step is scheduled against an absolute deadline.** `hold(400)`
 *    does not mean "sleep 400ms", it means "be at t=400ms". A slow step is
 *    absorbed by the next wait instead of shifting the whole rest of the take,
 *    so two runs stay on the same grid rather than drifting apart step by step.
 *    When a step overruns its budget the schedule is reported as slipped —
 *    a take that could not keep its own timing is not a reproducible take.
 *
 * 3. **Coordinates come from `boundingBox()`, never from pixel positions.**
 *    A restyle moves the button; the recipe still names the button, so the
 *    coordinate moves with it and the zoom follows. That is what makes these
 *    clips survive a UI change instead of quietly framing the wrong thing.
 *
 * The cursor is deliberately *not* in the recording (headless Chrome does not
 * draw one). The composition draws it from these events, which is what lets
 * the camera anticipate a click by starting its zoom before the click happens.
 */

/** @typedef {'hold' | 'move' | 'click' | 'type'} EventKind */

/**
 * One recorded step.
 *
 * `t` and `tEnd` are milliseconds from the first screencast frame. They are
 * equal for an instantaneous step (a click) and differ for one that occupies
 * time (a move, a hold, a burst of typing) — the composition needs the span to
 * animate the cursor along it rather than teleporting it.
 *
 * @typedef {object} RecordedEvent
 * @property {number} t         Start, ms from the first frame.
 * @property {number} tEnd      End, ms from the first frame.
 * @property {EventKind} kind
 * @property {number} [x]       Viewport CSS px, element centre.
 * @property {number} [y]       Viewport CSS px, element centre.
 * @property {string} [selector]
 * @property {string} [label]   Present = this step is a zoom candidate.
 * @property {string} [text]    For `type`, what was typed.
 *
 * @typedef {object} TakeLog
 * @property {string} id
 * @property {number} fps
 * @property {{width: number, height: number, deviceScaleFactor: number}} viewport
 * @property {number} durationMs  Scripted length of the sequence.
 * @property {boolean} slipped    A step overran its scheduled slot.
 * @property {RecordedEvent[]} events
 */

/**
 * Viewport every take is recorded at: **1280×720 CSS px at 3× → a 3840×2160
 * master.** Exactly 4K, with no downscale step between the browser and the
 * file.
 *
 * The oversampling is in `deviceScaleFactor`, never in the viewport, and that
 * distinction is the point: a 3840-px-wide *viewport* would film a different
 * UI than users have — other responsive breakpoints, a three-panel editor that
 * folds differently. The CSS viewport stays a size someone actually works at;
 * only the pixel density goes up. At 3× a 3× zoom on a 1080p output is still
 * 1:1 pixels, so the camera can push in without softening.
 *
 * 1280 rather than the 1440×810 reserve option (see
 * `briefs/screencast-video-factory.md` § D1): decided by looking at both. The
 * editor is not cramped at 720 — the bulk-edit modal fits with room to spare —
 * and at 1280 every CSS pixel is 1.5 output pixels at 1080p instead of 1.33,
 * which is ~13% larger text. In a video with no voice-over, reading time is the
 * floor under every clip's length, so legibility buys duration back.
 */
export const VIDEO_VIEWPORT = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 3,
};

/** Milliseconds the pointer takes to travel to a target. */
export const MOVE_MS = 420;

/** Pointer positions emitted per second while travelling. */
const MOVE_HZ = 60;

/** Milliseconds per character while typing. */
export const TYPE_CHAR_MS = 55;

/** Milliseconds a click occupies (press + release settle). */
export const CLICK_MS = 90;

/**
 * Where the pointer starts. Off the interesting part of the frame, so the
 * first move reads as an approach rather than a jump from wherever the
 * previous recipe happened to leave the mouse.
 */
const POINTER_ORIGIN = { x: 40, y: 40 };

/**
 * Sleep until an absolute wall-clock deadline.
 *
 * Deliberately not `sleep(delta)`: relative sleeps accumulate the timer's
 * overshoot, so a hundred steps drift by hundreds of milliseconds and the two
 * runs the acceptance test compares are no longer on the same grid.
 *
 * @param {number} deadline `Date.now()` value to wake at
 */
function sleepUntil(deadline) {
  const delta = deadline - Date.now();
  if (delta <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, delta));
}

/**
 * Centre of an element, in viewport CSS pixels.
 * @param {import('puppeteer-core').Page} page
 * @param {string} selector
 * @returns {Promise<{x: number, y: number}>}
 */
async function centreOf(page, selector) {
  const handle = await page.waitForSelector(selector, {
    visible: true,
    timeout: 10_000,
  });
  if (!handle) throw new Error(`Selector matched nothing: ${selector}`);
  const box = await handle.boundingBox();
  if (!box) throw new Error(`Selector has no box (hidden?): ${selector}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Build the recorder handed to `record.sequence`.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {number} t0 `Date.now()` of the first screencast frame
 * @returns {{ rec: object, log: () => { events: RecordedEvent[], durationMs: number, slipped: boolean } }}
 */
function createRecorder(page, t0) {
  /** @type {RecordedEvent[]} */
  const events = [];
  /** Scripted position on the timeline, ms from t0. */
  let cursorMs = 0;
  /** Where the pointer is, in viewport CSS px. */
  let pointer = { ...POINTER_ORIGIN };
  let slipped = false;

  /**
   * Advance the scripted clock by `ms` and wait for the wall clock to catch up.
   * @param {number} ms
   */
  async function advance(ms) {
    cursorMs += ms;
    const deadline = t0 + cursorMs;
    if (Date.now() > deadline + 1000 / 30) slipped = true;
    await sleepUntil(deadline);
  }

  /**
   * Move the pointer along a straight line over `MOVE_MS`, one position per
   * frame of a 60Hz grid. Real travel time rather than a jump, because hover
   * states in the recording have to match the cursor the composition draws
   * over it.
   * @param {{x: number, y: number}} to
   */
  async function travel(to) {
    const from = pointer;
    const steps = Math.max(1, Math.round((MOVE_MS * MOVE_HZ) / 1000));
    const startMs = cursorMs;
    for (let i = 1; i <= steps; i += 1) {
      const p = i / steps;
      await page.mouse.move(
        from.x + (to.x - from.x) * p,
        from.y + (to.y - from.y) * p,
      );
      await sleepUntil(t0 + startMs + (MOVE_MS * i) / steps);
    }
    cursorMs = startMs + MOVE_MS;
    if (Date.now() > t0 + cursorMs + 1000 / 30) slipped = true;
    pointer = { ...to };
  }

  const rec = {
    /**
     * Hold still. Not dead time: it is the breath that makes an action legible,
     * and it is where the composition lands its overlay.
     * @param {number} ms
     */
    async hold(ms) {
      const t = cursorMs;
      await advance(ms);
      events.push({ t, tEnd: cursorMs, kind: 'hold' });
    },

    /**
     * Move the pointer onto an element without clicking it.
     * @param {string} selector
     * @param {{ label?: string }} [opts]
     */
    async move(selector, { label } = {}) {
      const to = await centreOf(page, selector);
      const t = cursorMs;
      await travel(to);
      events.push({
        t,
        tEnd: cursorMs,
        kind: 'move',
        x: to.x,
        y: to.y,
        selector,
        ...(label ? { label } : {}),
      });
    },

    /**
     * Travel to an element and click it. The travel is logged as its own
     * `move` event so the composition can animate the approach and still put
     * the ripple on the click instant.
     * @param {string} selector
     * @param {{ label?: string }} [opts]
     */
    async click(selector, { label } = {}) {
      await rec.move(selector);
      const t = cursorMs;
      await page.mouse.click(pointer.x, pointer.y);
      await advance(CLICK_MS);
      events.push({
        t,
        tEnd: t,
        kind: 'click',
        x: pointer.x,
        y: pointer.y,
        selector,
        ...(label ? { label } : {}),
      });
    },

    /**
     * Click into a field and type, one character per {@link TYPE_CHAR_MS}.
     *
     * Typing is what this whole clip is about — the slide following the form —
     * so the rhythm is fixed rather than left to Puppeteer's default, which
     * would make two runs different lengths.
     *
     * @param {string} selector
     * @param {string} text
     * @param {{ label?: string, clear?: boolean }} [opts] `clear` selects the
     *   field's existing content first, so the typing replaces rather than
     *   appends.
     */
    async type(selector, text, { label, clear = false } = {}) {
      await rec.click(selector);
      if (clear) {
        await page.$eval(selector, (el) => {
          if (
            el instanceof HTMLInputElement ||
            el instanceof HTMLTextAreaElement
          )
            el.select();
        });
      }
      const t = cursorMs;
      for (let i = 0; i < text.length; i += 1) {
        await page.keyboard.type(text[i]);
        await sleepUntil(t0 + t + TYPE_CHAR_MS * (i + 1));
      }
      cursorMs = t + TYPE_CHAR_MS * text.length;
      if (Date.now() > t0 + cursorMs + 1000 / 30) slipped = true;
      events.push({
        t,
        tEnd: cursorMs,
        kind: 'type',
        x: pointer.x,
        y: pointer.y,
        selector,
        text,
        ...(label ? { label } : {}),
      });
    },
  };

  return {
    rec,
    log: () => ({ events, durationMs: cursorMs, slipped }),
  };
}

/**
 * Id of the frame ticker, so the same element is installed and removed.
 */
const FRAME_TICKER_ID = '__capture-screencast-tick';

/**
 * Install a 1×1 px element whose compositor animation never stops.
 *
 * **This is not decoration; without it takes silently lose their payoff.**
 * `page.screencast()` is fed by `Page.screencastFrame`, and Chromium only
 * emits that event when the page produces a new compositor frame. A page that
 * is *changing* (a caret blinking, text being typed, a hover moving) produces
 * them continuously; a page that has just settled produces none. So a change
 * that lands while nothing else is moving — a modal opening at the end of a
 * `hold`, which is exactly where a clip puts its payoff — can be coalesced
 * away, and because the page is then static no further frame is ever emitted.
 * The recording ends on a stale image, at full length, with no error anywhere.
 * Measured: the second take's fill-preview modal opened 10ms after its click
 * and appeared in **zero** of the take's 134 frames, while `page.screenshot()`
 * right after showed it.
 *
 * A compositor-only animation (opacity on its own layer) forces a frame every
 * vsync, so every change is captured within a frame of happening. The element
 * is one CSS pixel at ~1% alpha in the bottom-left corner: present in the
 * master, invisible at any output resolution.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {string} id
 */
async function installFrameTicker(page, id) {
  await page.evaluate((tickerId) => {
    const style = document.createElement('style');
    style.id = `${tickerId}-style`;
    style.textContent =
      `@keyframes ${tickerId} { from { opacity: 0.01 } to { opacity: 0.02 } }` +
      `#${tickerId} { position: fixed; left: 0; bottom: 0; width: 1px;` +
      ` height: 1px; background: #000; pointer-events: none;` +
      ` z-index: 2147483647; will-change: opacity;` +
      ` animation: ${tickerId} 0.5s linear infinite alternate }`;
    document.head.appendChild(style);
    const dot = document.createElement('div');
    dot.id = tickerId;
    document.body.appendChild(dot);
  }, id);
}

/**
 * Remove the frame ticker again, so nothing the recorder added outlives it.
 * @param {import('puppeteer-core').Page} page
 * @param {string} id
 */
async function removeFrameTicker(page, id) {
  await page
    .evaluate((tickerId) => {
      document.getElementById(tickerId)?.remove();
      document.getElementById(`${tickerId}-style`)?.remove();
    }, id)
    .catch(() => {
      /* page already gone — nothing to clean up */
    });
}

/**
 * Record one video recipe: start the screencast, run its sequence, stop, and
 * return the event log.
 *
 * The screencast is started *after* the recipe's `waitFor`/`action`/`settle`
 * have already run, so the first frame is a fully rendered page.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {import('./recipe.js').VideoRecipe} recipe
 * @param {{ takePath: string, viewport: {width: number, height: number, deviceScaleFactor: number} }} opts
 * @returns {Promise<TakeLog>}
 */
export async function recordTake(page, recipe, { takePath, viewport }) {
  const fps = recipe.record.fps ?? 30;
  await page.mouse.move(POINTER_ORIGIN.x, POINTER_ORIGIN.y);
  await installFrameTicker(page, FRAME_TICKER_ID);
  const recorder = await page.screencast({
    path: /** @type {`${string}.webm`} */ (takePath),
    fps,
    overwrite: true,
  });
  // `screencast()` resolves once the first frame has arrived, so this is the
  // video's own zero — see the module header.
  const t0 = Date.now();
  const { rec, log } = createRecorder(page, t0);
  try {
    await recipe.record.sequence(rec);
  } finally {
    await recorder.stop();
    await removeFrameTicker(page, FRAME_TICKER_ID);
  }
  const { events, durationMs, slipped } = log();
  return {
    id: recipe.id,
    fps,
    viewport,
    durationMs,
    slipped,
    events,
  };
}
