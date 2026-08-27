/**
 * The anonymous audience's submit path (B151).
 *
 * `client/views/follow/` is what a not-logged-in audience sees, types into and
 * sends: a live deck, a poll or likert or feedback card, a Q&A strip. It has no
 * session to recover from a mistake with, so this suite is a smoke pass over
 * the three halves of that surface — does it render, does it submit, and does
 * the answer reach the endpoint it should — rather than an affordance matrix
 * like `viewer-affordance-matrix.test.js`.
 *
 * Three of the rows are transcriptions of something written down:
 * `docs/reference/live-sessions.md` § SSE flow fixes the stream endpoints and
 * the event names; `shared/slide-types/runtime.js` § The content contract fixes
 * that an option's *index* is its identity end to end, which is what the vote
 * payload asserts; `docs/reference/analytics-privacy.md` fixes that a follower
 * with an account is not tracked. The rest — the layout, the copy, which
 * element the audience types into, the request bodies of the audience write
 * routes — is not specified anywhere, so those rows are an honestly labelled
 * pin on the current behaviour and not a promise about it.
 *
 * ## The executor choice: how much of `sse.js` is faked
 *
 * None of it. The fake is one level lower — `globalThis.EventSource`, which
 * jsdom does not ship — so `sse.js`, `lib/net/sse-connection.js` and
 * `lib/qa/questions-feed.js` all run for real: the stream URLs, the event
 * names each subscribes to, `JSON.parse` of the event data, the `close`
 * event ending the stream, and `isHealthy()` gating the polling safety net.
 * Faking `createFollowSse` itself would have left exactly those untested while
 * looking like coverage, and the follow view is mostly a state machine driven
 * by those events: with a driveable EventSource a test can push a `state` event
 * and watch a real slide change, which is the behaviour worth pinning.
 *
 * The price is that the stub must be honest about the shape
 * `sse-connection.js` uses — `addEventListener` per event type, the `onopen`
 * and `onerror` properties, `close()` — so `FakeEventSource` below carries
 * exactly that surface and nothing else, and its `open`/`emit` methods are the
 * test-side driver.
 *
 * Transport is the only other fake: `globalThis.fetch` serves the follow API
 * from an in-test scenario object and the locale JSON from disk.
 *
 * Run with: node --test tests/follow-audience-smoke.test.js
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/f/live-deck',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
if (!dom.window.matchMedia) {
  dom.window.matchMedia = () => ({
    matches: false,
    media: '',
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
}
globalThis.matchMedia = dom.window.matchMedia;
dom.window.open = () => null;

// The analytics tracker closes its session with `navigator.sendBeacon`. Node
// ships a `navigator` of its own — a getter-only global whose Navigator has no
// such method, so the tracker's try/catch would swallow the failure and the
// teardown would look clean while sending nothing. Point the global at jsdom's
// navigator and give that one a recording beacon.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
/** @type {string[]} Beacon URLs sent since the last mount. */
let beaconLog = [];
dom.window.navigator.sendBeacon = (url) => {
  beaconLog.push(String(url));
  return true;
};

// ---------------------------------------------------------------------------
// The one fake below the code under test: EventSource
// ---------------------------------------------------------------------------

/**
 * A driveable stand-in for the browser's EventSource.
 *
 * Shaped after what `client/lib/net/sse-connection.js` actually uses, and
 * nothing more: per-type `addEventListener`, the `onopen`/`onerror` properties,
 * and `close()`. Tests drive it through the `open`/`emit`/`fail` helpers.
 */
class FakeEventSource {
  /** @type {FakeEventSource[]} Every stream opened since the last mount. */
  static instances = [];

  constructor(url) {
    this.url = String(url);
    this.readyState = 0;
    this.closed = false;
    /** @type {Map<string, Function[]>} */
    this.listeners = new Map();
    this.onopen = null;
    this.onerror = null;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((f) => f !== fn),
    );
  }

  close() {
    this.readyState = 2;
    this.closed = true;
  }

  // --- test driver -------------------------------------------------------

  /** Report the connection as established, as the browser does on first byte. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  /** Push one server event. `data` is JSON-encoded, exactly as the wire does. */
  emit(type, data) {
    const event = { type, data: JSON.stringify(data ?? {}) };
    for (const fn of this.listeners.get(type) || []) fn(event);
  }
}

globalThis.EventSource = FakeEventSource;

/**
 * The most recent stream whose URL matches, or `undefined`.
 * @param {RegExp} pattern
 * @returns {FakeEventSource|undefined}
 */
function stream(pattern) {
  return [...FakeEventSource.instances]
    .reverse()
    .find((es) => pattern.test(es.url));
}

const followStream = () => stream(/\/api\/follow\/[^/]+\/events$/);
const questionStream = () => stream(/\/questions\/events$/);

// ---------------------------------------------------------------------------
// The deck the audience is looking at
// ---------------------------------------------------------------------------

const DECK_ID = 'live-deck';

const SLIDES = [
  { id: 's-title', type: 'title-slide', title: 'Kickoff', subtitle: 'welkom' },
  {
    id: 's-poll',
    type: 'poll-slide',
    question: 'Welke kleur?',
    options: [{ text: 'Blauw' }, { text: 'Groen' }],
  },
  {
    id: 's-slider',
    type: 'likert-slider-slide',
    question: 'Hoe ging het?',
    minLabel: 'slecht',
    maxLabel: 'goed',
  },
  { id: 's-feedback', type: 'feedback-slide', question: 'Wat viel op?' },
];

/** Deck-language chrome, served from the real locale file rather than stubbed. */
const FOLLOW_NL = readFileSync(
  new URL('../client/i18n/nl/follow.json', import.meta.url),
  'utf8',
);

/**
 * Mutable per-test server state. Reset by `mountFollow`.
 * @type {{
 *   status: string, capabilities: object, slideId: string, slideIndex: number,
 *   slideType: string, questions: object[], interaction: object|null,
 *   interactionState: object|null, analyticsEnabled: boolean, user: object|null,
 * }}
 */
let scenario;

/** Every request the fake transport saw: `{ method, url, body }`. */
let requestLog = [];

const sentTo = (needle) => requestLog.filter((r) => r.url.includes(needle));

/**
 * A request body as the route would see it: JSON when `api()` stringified an
 * object, the raw value otherwise.
 * @param {*} raw
 * @returns {*}
 */
function parseBody(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Serve the follow API from `scenario`. Unknown paths answer an empty object
 * rather than a 404: this suite asserts on the DOM and on the requests it
 * *does* make, so an unrelated new call should not fail every row.
 */
async function fakeFetch(input, init = {}) {
  const url = String(input);
  const method = String(init.method || 'GET').toUpperCase();
  const body = parseBody(init.body);
  requestLog.push({ method, url, body });

  // Node's own Response — jsdom ships none of fetch's classes.
  const json = (payload, status = 200) =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  const path = url.split('?')[0];

  if (path === '/client/i18n/nl/follow.json') {
    return new Response(FOLLOW_NL, {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (path === '/api/track/session/start') {
    return json({ ok: true, sessionToken: 'track-token-1' });
  }

  if (path === '/api/auth/me') {
    if (!scenario.user) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }
    return json({ user: scenario.user });
  }

  const base = `/api/follow/${DECK_ID}`;

  if (path === `${base}/presentation`) {
    if (scenario.status !== 'live') return json({ status: scenario.status });
    return json({
      status: 'live',
      presentation: {
        id: DECK_ID,
        title: 'Kickoff',
        theme: 'default',
        slides: structuredClone(SLIDES),
        settings: { analyticsEnabled: scenario.analyticsEnabled },
      },
      meta: { dominantLang: 'nl', availableLangs: ['nl'] },
      capabilities: scenario.capabilities,
      slideId: scenario.slideId,
      slideIndex: scenario.slideIndex,
      slideType: scenario.slideType,
      stepIdx: 0,
    });
  }

  if (path === `${base}/state`) {
    if (scenario.status !== 'live') return json({ status: scenario.status });
    return json({
      status: 'live',
      capabilities: scenario.capabilities,
      slideId: scenario.slideId,
      slideIndex: scenario.slideIndex,
      slideType: scenario.slideType,
      stepIdx: 0,
    });
  }

  if (path === `${base}/questions` && method === 'GET') {
    return json({
      status: scenario.status,
      capabilities: scenario.capabilities,
      questions: structuredClone(scenario.questions),
    });
  }

  if (path === `${base}/questions` && method === 'POST') {
    const question = {
      id: `q-${scenario.questions.length + 1}`,
      text: String(body?.text || ''),
      authorName: String(body?.authorName || ''),
      upvotes: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    scenario.questions.push(question);
    return json({ status: 'live', question });
  }

  const upvote = path.match(new RegExp(`^${base}/questions/([^/]+)/upvote$`));
  if (upvote) {
    const q = scenario.questions.find((x) => x.id === upvote[1]);
    if (q) q.upvotes += 1;
    return json({ status: 'live' });
  }

  if (path === `${base}/interactions/current`) {
    if (scenario.status !== 'live') return json({ status: scenario.status });
    return json({
      status: 'live',
      capabilities: scenario.capabilities,
      interaction: scenario.interaction,
      interactionState: scenario.interactionState,
    });
  }

  if (/\/interactions\/[^/]+\/vote$/.test(path)) {
    const idx = Number(body?.optionIndex);
    const counts = [...(scenario.interactionState?.counts || [])];
    if (Number.isInteger(idx) && idx >= 0) counts[idx] = (counts[idx] || 0) + 1;
    scenario.interactionState = {
      ...(scenario.interactionState || {}),
      counts,
      myVote: idx,
    };
    return json({
      status: 'live',
      capabilities: scenario.capabilities,
      interactionState: scenario.interactionState,
    });
  }

  if (/\/interactions\/[^/]+\/feedback$/.test(path)) {
    scenario.interactionState = {
      ...(scenario.interactionState || {}),
      myText: String(body?.text || ''),
    };
    return json({
      status: 'live',
      capabilities: scenario.capabilities,
      interactionState: scenario.interactionState,
    });
  }

  return json({});
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

/**
 * Mount the real follow entry — `renderFollow`, the module's declared public
 * seam — and hand back the shell plus its detach.
 *
 * The route that reaches it is pinned separately (`route-dispatch-follow`), so
 * booting the whole client router here would only add a second copy of that.
 *
 * @param {object} [overrides] - fields merged into the default scenario.
 * @returns {Promise<{root: HTMLElement, shell: HTMLElement, detach: Function}>}
 */
async function mountFollow(overrides = {}) {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  localStorage.clear();
  sessionStorage.clear();
  requestLog = [];
  beaconLog = [];
  FakeEventSource.instances = [];

  scenario = {
    status: 'live',
    capabilities: { canUseQa: true },
    slideId: 's-title',
    slideIndex: 0,
    slideType: 'title-slide',
    questions: [],
    interaction: null,
    interactionState: null,
    // Off by default so the request log stays about the follow API; the two
    // analytics rows turn it on deliberately.
    analyticsEnabled: false,
    user: null,
    ...overrides,
  };

  globalThis.fetch = fakeFetch;

  const root = document.createElement('div');
  document.body.append(root);

  const { renderFollow } = await import('../client/views/follow.js');
  const teardown = await renderFollow(root, DECK_ID);
  // Idempotent, and registered for the safety net below: a row that fails its
  // assertion never reaches its own `detach()`, and a follow view left mounted
  // would carry its listeners and its analytics session into the next row.
  let torn = false;
  const detach = () => {
    if (torn) return;
    torn = true;
    teardown();
  };
  mounted.push(detach);
  await settle();

  return { root, shell: root.querySelector('.follow-shell'), detach };
}

/** Detachers for every view mounted during the current test. */
let mounted = [];

afterEach(() => {
  for (const detach of mounted.splice(0)) {
    try {
      detach();
    } catch {
      // a teardown that throws is the row's problem, not the next row's
    }
  }
});

/** Let the microtask queue and any zero-delay timers drain. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Poll `predicate` until it holds. The interaction controller throttles its
 * renders (250ms), so a submit's follow-up render lands a beat later; waiting
 * on the condition beats sleeping on a magic number.
 * @param {() => boolean} predicate
 * @param {string} what - what we are waiting for, for the failure message
 */
async function waitFor(predicate, what) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/**
 * Do what the presenter's server does when a slide becomes current: push the
 * new state, then the capability envelope that says whether an interaction is
 * dominant.
 * @param {object} next - `{ slideId, slideIndex, slideType, capabilities }`
 */
async function pushSlide({ slideId, slideIndex, slideType, capabilities }) {
  scenario.slideId = slideId;
  scenario.slideIndex = slideIndex;
  scenario.slideType = slideType;
  if (capabilities) scenario.capabilities = capabilities;
  const es = followStream();
  es.open();
  es.emit('state', { slideId, slideIndex, slideType, stepIdx: 0 });
  es.emit('status', { status: 'live', capabilities: scenario.capabilities });
  await settle();
}

/** Open the poll on `s-poll` and wait for its card. */
async function openPoll({ open = true } = {}) {
  scenario.interaction = {
    type: 'poll',
    question: 'Welke kleur?',
    options: ['Blauw', 'Groen'],
  };
  scenario.interactionState = { open, counts: [0, 0], total: 0 };
  await pushSlide({
    slideId: 's-poll',
    slideIndex: 1,
    slideType: 'poll-slide',
    capabilities: { canUseQa: false, interaction: true },
  });
  await waitFor(
    () => !!document.querySelector('.follow-interaction-card'),
    'the poll card',
  );
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// ---------------------------------------------------------------------------
// What the anonymous audience sees
// ---------------------------------------------------------------------------

test('a live deck renders the audience chrome, the current slide and the Q&A strip', async () => {
  const { shell, detach } = await mountFollow();

  assert.ok(shell, 'the follow shell mounts');
  assert.ok(
    document.documentElement.classList.contains('is-follow'),
    'the document is flagged as the follow view',
  );
  assert.equal(
    shell.querySelector('.follow-title').textContent,
    'Live meekijken',
    'the topbar title comes from the deck-language copy',
  );
  assert.equal(
    shell.querySelector('.follow-status').textContent,
    '1 / 4',
    'the audience sees where in the deck the presenter is',
  );
  assert.ok(
    shell.querySelector('.follow-slide .slide'),
    'the current slide is mounted on the stage',
  );
  assert.ok(
    shell.querySelector('.follow-qa .follow-qa-input'),
    'the Q&A strip offers an input',
  );
  assert.equal(
    shell.querySelector('.follow-interaction').style.display,
    'none',
    'no interaction card while the current slide is not live',
  );

  detach();
});

test('the anonymous audience only ever addresses the follow surface', async () => {
  // The whole authorization story of this view is the follow code: it carries
  // no session, so a call to a login-gated route would 401 at best and leak a
  // wrong assumption at worst.
  const { detach } = await mountFollow();

  assert.ok(
    requestLog.some(
      (r) => r.url.split('?')[0] === `/api/follow/${DECK_ID}/presentation`,
    ),
    'the deck was actually fetched — otherwise the sweep below is vacuous',
  );
  const strays = requestLog
    .map((r) => r.url.split('?')[0])
    .filter(
      (url) =>
        !url.startsWith(`/api/follow/${DECK_ID}/`) &&
        !url.startsWith('/client/') &&
        !url.startsWith('/themes/'),
    );
  assert.deepEqual(strays, [], 'no request leaves the follow surface');

  assert.ok(
    followStream().url.endsWith(`/api/follow/${DECK_ID}/events`),
    'the state stream is the follow events endpoint',
  );
  assert.ok(
    questionStream().url.endsWith(`/api/follow/${DECK_ID}/questions/events`),
    'the Q&A stream is the follow questions endpoint',
  );

  detach();
});

test('a session that is not live shows a message instead of a submit surface', async () => {
  for (const [status, message] of [
    ['not_started', 'De presentatie is nog niet gestart.'],
    ['ended', 'De presentatie is niet actief (meer).'],
  ]) {
    const { shell, detach } = await mountFollow({ status });
    assert.equal(
      shell.querySelector('.follow-message-box').textContent,
      message,
      `${status} explains itself on the stage`,
    );
    assert.equal(
      shell.querySelector('.follow-interaction-card'),
      null,
      `${status} offers nothing to submit`,
    );
    detach();
  }
});

// ---------------------------------------------------------------------------
// The poll: render, submit, and what goes out
// ---------------------------------------------------------------------------

test('an open poll replaces the slide with a card built from the wire payload', async () => {
  const { shell, detach } = await mountFollow();
  await openPoll();

  assert.equal(
    shell.querySelector('.follow-slide').style.display,
    'none',
    'the slide steps aside for a dominant interaction',
  );
  assert.equal(
    shell.querySelector('.follow-interaction-question').textContent,
    'Welke kleur?',
    'the question is the one the interaction payload carries',
  );
  assert.deepEqual(
    $$('.follow-interaction-option').map((b) => b.textContent),
    ['Blauw', 'Groen'],
    'one button per option, in wire order',
  );
  assert.equal(
    shell.querySelector('.follow-interaction-status').textContent,
    'Stem nu.',
    'an open poll invites a vote',
  );

  detach();
});

test('voting posts the option index to the current slide, and thanks the voter', async () => {
  const { detach } = await mountFollow();
  await openPoll();

  $$('.follow-interaction-option')[1].click();
  await waitFor(
    () => !!$('.follow-interaction-thanks'),
    'the thank-you after voting',
  );

  const votes = sentTo('/interactions/');
  const cast = votes.find((r) => r.method === 'POST');
  assert.ok(cast, 'the vote is a POST');
  assert.equal(
    cast.url,
    `/api/follow/${DECK_ID}/interactions/s-poll/vote`,
    'it is addressed to the slide the audience is looking at',
  );
  assert.deepEqual(
    cast.body,
    { optionIndex: 1 },
    'the index is the option identity on the wire — nothing else is sent',
  );
  assert.equal(
    $('.follow-interaction-thanks').textContent,
    'Dank! Je stem is opgeslagen.',
    'the voter is told the vote landed',
  );
  assert.ok(
    $$('.follow-interaction-option')[1].classList.contains('is-active'),
    'and sees which option they picked',
  );

  detach();
});

test('a closed poll can be read but not answered', async () => {
  const { detach } = await mountFollow();
  await openPoll({ open: false });

  assert.equal(
    $('.follow-interaction-status').textContent,
    'Stemmen is gesloten.',
    'the card says voting is closed',
  );
  const buttons = $$('.follow-interaction-option');
  assert.ok(
    buttons.length && buttons.every((b) => b.disabled),
    'every option is disabled',
  );

  buttons[0].click();
  await settle();
  assert.equal(
    sentTo('/vote').length,
    0,
    'a click on a closed poll sends nothing',
  );

  detach();
});

// ---------------------------------------------------------------------------
// The likert slider and the feedback box: the other two live kinds
// ---------------------------------------------------------------------------

test('a likert-slider slide offers a range, and submits its 0-based index', async () => {
  const { detach } = await mountFollow();
  scenario.interaction = {
    type: 'likert',
    question: 'Hoe ging het?',
    minLabel: 'slecht',
    maxLabel: 'goed',
  };
  scenario.interactionState = { open: true, counts: [], total: 0 };
  await pushSlide({
    slideId: 's-slider',
    slideIndex: 2,
    slideType: 'likert-slider-slide',
    capabilities: { canUseQa: false, interaction: true },
  });
  await waitFor(() => !!$('.follow-interaction-slider'), 'the slider');

  assert.equal(
    $$('.follow-interaction-option').length,
    0,
    'the slider replaces the option buttons rather than joining them',
  );
  const input = $('.follow-interaction-slider');
  assert.equal(input.min, '1', 'the scale the audience reads starts at 1');
  assert.equal(input.max, '10', 'and ends at 10');

  input.value = '8';
  input.dispatchEvent(new dom.window.Event('change'));
  await waitFor(() => sentTo('/vote').length > 0, 'the slider vote');

  const cast = sentTo('/vote')[0];
  assert.equal(
    cast.url,
    `/api/follow/${DECK_ID}/interactions/s-slider/vote`,
    'the slider posts to the current slide',
  );
  assert.deepEqual(
    cast.body,
    { optionIndex: 7 },
    'the drawn score is 1-based, the stored index is not',
  );

  detach();
});

test('a feedback slide collects free text and sends it once', async () => {
  const { detach } = await mountFollow();
  scenario.interaction = {
    type: 'feedback',
    question: 'Wat viel op?',
    maxLength: 400,
  };
  scenario.interactionState = { open: true };
  await pushSlide({
    slideId: 's-feedback',
    slideIndex: 3,
    slideType: 'feedback-slide',
    capabilities: { canUseQa: false, interaction: true },
  });
  await waitFor(
    () => !!$('.follow-interaction-feedback-input'),
    'the feedback box',
  );

  const ta = $('.follow-interaction-feedback-input');
  assert.equal(ta.maxLength, 400, 'the wire cap becomes the input cap');
  assert.equal(
    $$('.follow-interaction-option').length,
    0,
    'free text is offered instead of choices, not beside them',
  );

  ta.value = 'De demo was scherp';
  ta.dispatchEvent(new dom.window.Event('input'));
  $('.follow-interaction-feedback-wrap .btn-primary').click();
  await waitFor(() => sentTo('/feedback').length > 0, 'the feedback POST');

  const sent = sentTo('/feedback')[0];
  assert.equal(
    sent.url,
    `/api/follow/${DECK_ID}/interactions/s-feedback/feedback`,
    'feedback goes to the current slide',
  );
  assert.deepEqual(
    sent.body,
    { text: 'De demo was scherp' },
    'the text is the whole payload',
  );

  await waitFor(
    () => !!$('.follow-interaction-thanks'),
    'the feedback thank-you',
  );
  assert.equal(
    $('.follow-interaction-thanks').textContent,
    'Dank! Je feedback is opgeslagen.',
    'and the audience is told so',
  );

  detach();
});

// ---------------------------------------------------------------------------
// Q&A: the other thing an anonymous audience types into
// ---------------------------------------------------------------------------

test('asking a question posts it and shows it back immediately', async () => {
  const { shell, detach } = await mountFollow();

  const input = shell.querySelector('.follow-qa-input');
  input.value = '  Hoe zit het met de planning?  ';
  shell.querySelector('.follow-qa-form .btn-primary').click();
  await waitFor(
    () => sentTo('/questions').some((r) => r.method === 'POST'),
    'the question POST',
  );

  const asked = sentTo('/questions').find((r) => r.method === 'POST');
  assert.equal(
    asked.url,
    `/api/follow/${DECK_ID}/questions`,
    'a question goes to the follow questions route',
  );
  assert.equal(
    asked.body.text,
    'Hoe zit het met de planning?',
    'trimmed, so leading whitespace is not the audience’s problem',
  );
  assert.equal(asked.body.lang, 'nl', 'tagged with the deck language');
  assert.ok(
    'authorName' in asked.body,
    'the name field is always present — blank means anonymous',
  );

  await waitFor(
    () => !!$('.follow-qa-item'),
    'the optimistic insert of the question',
  );
  assert.equal(
    $('.follow-qa-text').textContent,
    'Hoe zit het met de planning?',
    'the asker sees their own question without waiting for a round trip',
  );
  assert.equal(input.value, '', 'and the box is cleared for the next one');

  detach();
});

test('Enter submits a question, Shift+Enter does not', async () => {
  // The audience is on a phone; the ask button is below the fold as often as
  // not, so the keyboard's own submit has to work.
  const { shell, detach } = await mountFollow();
  const input = shell.querySelector('.follow-qa-input');

  const press = (init) =>
    input.dispatchEvent(
      new dom.window.KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );

  input.value = 'Blijft de opname beschikbaar?';
  press({ shiftKey: true });
  await settle();
  assert.equal(
    sentTo('/questions').filter((r) => r.method === 'POST').length,
    0,
    'Shift+Enter is a newline, not a send',
  );

  press({});
  await waitFor(
    () => sentTo('/questions').some((r) => r.method === 'POST'),
    'the Enter-submitted question',
  );
  assert.equal(
    sentTo('/questions').find((r) => r.method === 'POST').body.text,
    'Blijft de opname beschikbaar?',
    'Enter sends what is in the box',
  );

  detach();
});

test('an upvote is posted once and the button then refuses a second', async () => {
  const { shell, detach } = await mountFollow({
    questions: [
      {
        id: 'q-1',
        text: 'Komt er een handout?',
        upvotes: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  await waitFor(() => !!$('.follow-qa-item'), 'the seeded question');

  assert.equal(
    shell.querySelector('.follow-qa-votes').textContent,
    '2',
    'the current tally is visible',
  );

  const upvoteBtn = shell.querySelector('.follow-qa-actions .btn-secondary');
  upvoteBtn.click();
  await waitFor(() => sentTo('/upvote').length > 0, 'the upvote POST');

  assert.equal(
    sentTo('/upvote')[0].url,
    `/api/follow/${DECK_ID}/questions/q-1/upvote`,
    'the upvote names the question',
  );
  await waitFor(
    () => shell.querySelector('.follow-qa-actions .btn-secondary').disabled,
    'the upvote button to lock',
  );

  shell.querySelector('.follow-qa-actions .btn-secondary').click();
  await settle();
  assert.equal(
    sentTo('/upvote').length,
    1,
    'a device may raise a question once',
  );

  detach();
});

test('a dominant interaction hides the Q&A strip and stops its stream', async () => {
  const { shell, detach } = await mountFollow();
  assert.equal(
    shell.querySelector('.follow-qa').style.display,
    '',
    'Q&A is visible while the deck is just showing slides',
  );

  await openPoll();

  assert.equal(
    shell.querySelector('.follow-qa').style.display,
    'none',
    'the audience is not asked to do two things at once',
  );
  assert.ok(
    questionStream().closed,
    'and the question stream is closed rather than left running',
  );

  detach();
});

// ---------------------------------------------------------------------------
// What leaves the device besides answers
// ---------------------------------------------------------------------------

test('an anonymous viewer is tracked, and is given the control to erase it', async () => {
  const { shell, detach } = await mountFollow({ analyticsEnabled: true });
  await waitFor(
    () => sentTo('/api/track/session/start').length > 0,
    'the tracking session',
  );

  const start = sentTo('/api/track/session/start')[0];
  assert.equal(
    start.body.viewerType,
    'anonymous',
    'the session is opened as anonymous',
  );
  assert.equal(start.body.presentationId, DECK_ID, 'and names the deck');
  assert.ok(
    !start.body.viewerEmail,
    'no identity is attached to an anonymous viewer',
  );

  await waitFor(
    () => !!shell.querySelector('.follow-erase-slot button'),
    'the erase-my-data control',
  );
  assert.equal(
    shell.querySelector('.follow-erase-slot button').textContent.trim(),
    'Vergeet mij',
    'in the deck language, beside the tracking it undoes',
  );

  // Teardown is the other half of the promise: the session the device opened
  // gets closed. The tracker sends that as a beacon, and it may land either
  // from `detach()` or from the tail of a still-in-flight `start()` — both are
  // the same guarantee, so wait for it rather than for one of the two paths.
  detach();
  await waitFor(() => beaconLog.length > 0, 'the session-end beacon');
  assert.deepEqual(
    beaconLog,
    ['/api/track/session/end'],
    'leaving closes the session it opened, exactly once',
  );
});

test('a logged-in viewer following along is not tracked', async () => {
  // Deliberate: the audience of an internal deck is colleagues, and their
  // attention is not the presenter's to measure.
  const { shell, detach } = await mountFollow({
    analyticsEnabled: true,
    user: { id: 'u-1', email: 'collega@example.com' },
  });
  await waitFor(
    () => requestLog.some((r) => r.url === '/api/auth/me'),
    'the auth probe',
  );
  await settle();

  assert.equal(
    sentTo('/api/track/').length,
    0,
    'nothing is tracked for a signed-in viewer',
  );
  assert.equal(
    shell.querySelector('.follow-erase-slot button'),
    null,
    'and no erase control is offered for data that was never collected',
  );

  detach();
});

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

test('detaching closes every stream the audience opened', async () => {
  const { detach } = await mountFollow();
  await openPoll();

  assert.ok(
    FakeEventSource.instances.length >= 2,
    'the view opened the state and question streams',
  );
  detach();

  assert.ok(
    FakeEventSource.instances.every((es) => es.closed),
    'a detached follow view leaves no stream behind',
  );
  assert.ok(
    !document.documentElement.classList.contains('is-follow'),
    'and releases the document flag it set',
  );
});

test('a server-side close ends the stream instead of reconnecting it', async () => {
  const { detach } = await mountFollow();
  const es = followStream();
  es.open();
  es.emit('close', {});
  await settle();

  assert.ok(es.closed, 'the stream the server closed is closed here too');
  assert.equal(
    FakeEventSource.instances.filter(
      (s) => /\/events$/.test(s.url) && !/questions/.test(s.url),
    ).length,
    1,
    'and no replacement is opened behind it',
  );

  detach();
});
