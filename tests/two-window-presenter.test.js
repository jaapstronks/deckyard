/**
 * Tests for the two-window presenter view.
 *
 * Covers:
 *  - present-channel: state/hello/bye messages fan out to other instances on the
 *    same channel name (mock BroadcastChannel), and postState carries the state.
 *  - deck-controller: onStateChange fires on navigation with the live state, and
 *    applyRemoteState mirrors an authoritative slide index (the projector path).
 *
 * Run with: node --test tests/two-window-presenter.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

import { createPresentChannel } from '../client/lib/net/present-channel.js';

// --- Mock BroadcastChannel --------------------------------------------------
// Instances sharing a name form a bus; postMessage delivers to the *others*.
function installMockBroadcastChannel() {
  const buses = new Map();
  class MockBroadcastChannel {
    constructor(name) {
      this.name = name;
      this.onmessage = null;
      this._closed = false;
      const set = buses.get(name) || new Set();
      set.add(this);
      buses.set(name, set);
    }
    postMessage(data) {
      if (this._closed) return;
      const set = buses.get(this.name);
      if (!set) return;
      for (const peer of set) {
        if (peer === this || peer._closed) continue;
        peer.onmessage?.({ data });
      }
    }
    close() {
      this._closed = true;
      buses.get(this.name)?.delete(this);
    }
  }
  const prev = globalThis.BroadcastChannel;
  globalThis.BroadcastChannel = MockBroadcastChannel;
  return () => {
    globalThis.BroadcastChannel = prev;
  };
}

describe('present-channel', () => {
  let restore;
  before(() => {
    restore = installMockBroadcastChannel();
  });
  after(() => restore());

  it('delivers state to another instance on the same presentation', () => {
    const master = createPresentChannel('deck-1');
    const projector = createPresentChannel('deck-1');
    const received = [];
    projector.onState((s) => received.push(s));

    master.postState({ slideIndex: 3, stepIdx: 1, stepParagraphs: true });

    assert.deepEqual(received, [
      { slideIndex: 3, stepIdx: 1, stepParagraphs: true },
    ]);
    master.close();
    projector.close();
  });

  it('routes hello and bye to the right handlers', () => {
    const master = createPresentChannel('deck-2');
    const projector = createPresentChannel('deck-2');
    let hello = 0;
    let bye = 0;
    master.onHello(() => (hello += 1));
    projector.onBye(() => (bye += 1));

    projector.sendHello();
    assert.equal(hello, 1);

    // close() emits a final 'bye' before tearing down.
    master.close();
    assert.equal(bye, 1);
    projector.close();
  });

  it('delivers highlighter mirror events on their own kind', () => {
    const master = createPresentChannel('deck-hl');
    const projector = createPresentChannel('deck-hl');
    const hl = [];
    const state = [];
    projector.onHighlighter((ev) => hl.push(ev));
    projector.onState((s) => state.push(s));

    master.postHighlighter({ t: 'laser', sx: 800, sy: 450 });
    master.postState({ slideIndex: 1, stepIdx: 0, stepParagraphs: false });

    // 'hl' events reach onHighlighter only; 'state' reaches onState only.
    assert.deepEqual(hl, [{ t: 'laser', sx: 800, sy: 450 }]);
    assert.equal(state.length, 1);
    master.close();
    projector.close();
  });

  it('delivers follow codes on their own kind', () => {
    const master = createPresentChannel('deck-codes');
    const projector = createPresentChannel('deck-codes');
    const codes = [];
    const hl = [];
    projector.onCodes((c) => codes.push(c));
    projector.onHighlighter((ev) => hl.push(ev));

    master.postCodes({ nl: 'ABCD', en: 'WXYZ' });

    assert.deepEqual(codes, [{ nl: 'ABCD', en: 'WXYZ' }]);
    assert.equal(hl.length, 0);
    master.close();
    projector.close();
  });

  it('isolates channels by presentation id', () => {
    const a = createPresentChannel('deck-A');
    const b = createPresentChannel('deck-B');
    let got = 0;
    b.onState(() => (got += 1));
    a.postState({ slideIndex: 1, stepIdx: 0, stepParagraphs: false });
    assert.equal(got, 0);
    a.close();
    b.close();
  });

  it('no-ops without BroadcastChannel support', () => {
    const prev = globalThis.BroadcastChannel;
    globalThis.BroadcastChannel = undefined;
    const ch = createPresentChannel('deck-x');
    // Should not throw even though nothing is wired.
    assert.doesNotThrow(() => {
      ch.postState({ slideIndex: 0, stepIdx: 0, stepParagraphs: false });
      ch.sendHello();
      ch.close();
    });
    globalThis.BroadcastChannel = prev;
  });
});

describe('deck-controller two-window hooks', () => {
  let dom;
  let cleanupGlobals;

  before(async () => {
    dom = new JSDOM('<!doctype html><html><body></body></html>');
    const g = globalThis;
    const prev = {
      window: g.window,
      document: g.document,
      requestAnimationFrame: g.requestAnimationFrame,
    };
    g.window = dom.window;
    g.document = dom.window.document;
    g.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
    cleanupGlobals = () => {
      g.window = prev.window;
      g.document = prev.document;
      g.requestAnimationFrame = prev.requestAnimationFrame;
    };
  });
  after(() => cleanupGlobals());

  // Lazily import after globals are set (dom.js/h use `document`).
  async function makeController() {
    const { h } = await import('../client/lib/dom.js');
    const { createPresenterDeckController } = await import(
      '../client/views/presenter/deck-controller.js'
    );
    const stage = h('div', { class: 'deck-stage-inner' });
    document.body.appendChild(stage);

    const noop = () => {};
    const stateEvents = [];
    const ctl = createPresenterDeckController({
      h,
      api: async () => ({}),
      presentationId: 'p1',
      stage,
      theme: {},
      renderSlideElement: (s) => h('div', { class: 'slide', text: s.id }),
      cleanupSlideRuntimes: noop,
      animator: { runSlideAnimations: noop, cancel: noop },
      pauseVideoEmbeds: noop,
      activateVideoEmbeds: noop,
      step: {
        applyCardsVisibility: noop,
        applyChartVisibility: noop,
        applyFragmentsVisibility: noop,
        applyImageZoomStep: noop,
        collectCardsForSlide: () => [],
        collectChartFragmentsForSlide: () => [],
        collectFragmentsForSlide: () => [],
        collectImageZoomSteps: () => [],
        getStepMode: () => null,
      },
      onStateChange: (s) => stateEvents.push(s),
      getSessionReady: () => false,
      getFollowCodes: () => null,
      getStepParagraphs: () => false,
      setStepParagraphs: noop,
    });
    const slides = [
      { id: 'a', type: 'title-slide', content: {} },
      { id: 'b', type: 'title-slide', content: {} },
      { id: 'c', type: 'title-slide', content: {} },
    ];
    ctl.setPresentation({ slides });
    return { ctl, stateEvents };
  }

  it('onStateChange fires with the live slide index on navigation', async () => {
    const { ctl, stateEvents } = await makeController();
    stateEvents.length = 0;
    ctl.next();
    assert.ok(stateEvents.length >= 1);
    const last = stateEvents[stateEvents.length - 1];
    assert.equal(last.slideIndex, 1);
    assert.equal(last.stepParagraphs, false);
  });

  it('applyRemoteState mirrors an authoritative slide index', async () => {
    const { ctl } = await makeController();
    ctl.applyRemoteState({ slideIndex: 2, stepIdx: 0, stepParagraphs: false });
    assert.equal(ctl.getState().idx, 2);
    ctl.applyRemoteState({ slideIndex: 0, stepIdx: 0, stepParagraphs: false });
    assert.equal(ctl.getState().idx, 0);
  });

  it('applyRemoteState clamps out-of-range indices', async () => {
    const { ctl } = await makeController();
    ctl.applyRemoteState({ slideIndex: 99, stepIdx: 0, stepParagraphs: false });
    assert.equal(ctl.getState().idx, 2); // last slide
  });
});
