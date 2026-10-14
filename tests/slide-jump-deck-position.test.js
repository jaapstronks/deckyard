/**
 * `#N` means the same slide everywhere (B695): the Nth slide of the deck in its
 * stored order, the order the portable export writes it in. The presenter
 * (which skips slides hidden in presentation) and the reader and print
 * documents (which leave out slides hidden in export, and live-only ones)
 * translate it through that order to a slide id, so a skipped slide before the
 * target does not shift the jump, and a skipped target is no jump at all.
 *
 * Run with: node --test tests/slide-jump-deck-position.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

import { initSanitizer } from '../shared/sanitize.js';
import { slideJumpId } from '../shared/slide-types/helpers.js';
import { slideJumpsFor } from '../shared/slide-types/semantic-projection.js';

await initSanitizer();

const { buildReaderHtml } = await import('../server/export/reader.js');
const { buildPrintHtml } = await import('../server/export/print.js');

describe('slideJumpId', () => {
  const deck = ['a', 'b', 'c'];

  it('reads #N against the deck order and passes an id through', () => {
    assert.equal(slideJumpId({ index: 2 }, deck), 'b');
    assert.equal(slideJumpId({ id: 'c' }, deck), 'c');
  });

  it('is no target past the deck, without a deck, or without a jump', () => {
    assert.equal(slideJumpId({ index: 4 }, deck), '');
    assert.equal(slideJumpId({ index: Number.NaN }, deck), '');
    assert.equal(slideJumpId({ index: 1 }, undefined), '');
    assert.equal(slideJumpId(null, deck), '');
  });
});

/** A content slide whose one action button jumps to `url`. */
const jumpSlide = (id, url) => ({
  id,
  type: 'content-slide',
  content: { title: `Slide ${id}`, actions: [{ label: 'Go', url }] },
});
const plainSlide = (id, visibility) => ({
  id,
  type: 'content-slide',
  content: { title: `Slide ${id}` },
  ...(visibility ? { visibility } : {}),
});

/** The `href` of the "Go" action in `html`, or `null` when it is no link. */
function goHref(html) {
  const m = /<a href="([^"]*)">Go<\/a>/.exec(html);
  return m ? m[1] : null;
}

describe('reader: #N through the deck order', () => {
  const build = (slides) =>
    buildReaderHtml('/repo', { title: 'T', lang: 'en-GB', slides });

  it('a slide hidden in export before the target does not shift the jump', () => {
    // Deck: a (jump to #3 = c), b (hidden), c. Document: a, c.
    const html = build([
      jumpSlide('a', '#3'),
      plainSlide('b', { hideInExport: true }),
      plainSlide('c'),
    ]);
    assert.equal(goHref(html), '#slide-2');
  });

  it('a target the document leaves out is no link', () => {
    const html = build([
      jumpSlide('a', '#2'),
      plainSlide('b', { hideInExport: true }),
      plainSlide('c'),
    ]);
    assert.equal(goHref(html), null);
  });

  it('#N and #slide:<id> to the same slide land on the same section', () => {
    const slides = [
      plainSlide('x', { hideInExport: true }),
      jumpSlide('a', '#3'),
      plainSlide('c'),
    ];
    const byId = build([slides[0], jumpSlide('a', '#slide:c'), slides[2]]);
    assert.equal(goHref(build(slides)), '#slide-2');
    assert.equal(goHref(byId), '#slide-2');
  });
});

describe('print: #N counts live-only slides the document strips', () => {
  it('an invite before the target does not shift the jump', async () => {
    const html = await buildPrintHtml('/repo', {
      title: 'T',
      lang: 'en-GB',
      slides: [
        { id: 'inv', type: 'follow-invite-slide', content: {} },
        jumpSlide('a', '#3'),
        plainSlide('c'),
      ],
    });
    assert.equal(goHref(html), '#slide-2');
  });
});

describe('slideJumpsFor', () => {
  it('names the deck and the document; one argument when they are one', () => {
    const deck = [{ id: 'a' }, { id: 'b' }];
    assert.deepEqual(slideJumpsFor(deck, [deck[1]]), {
      deck: ['a', 'b'],
      document: ['b'],
    });
    assert.deepEqual(slideJumpsFor(deck), {
      deck: ['a', 'b'],
      document: ['a', 'b'],
    });
  });
});

describe('presenter: #N through the deck order', () => {
  let cleanupGlobals;

  before(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
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

  /**
   * A controller over a deck a, b, c, d where b is hidden in presentation; a
   * carries one jump anchor per test (`data-card-nav` or `-id`).
   */
  async function present(navAttrs) {
    const { h } = await import('../client/lib/dom/index.js');
    const { createPresenterDeckController } =
      await import('../client/views/presenter/deck-controller.js');
    const stage = h('div', { class: 'deck-stage-inner' });
    document.body.appendChild(stage);
    const noop = () => {};
    const ctl = createPresenterDeckController({
      api: async () => ({}),
      presentationId: 'p1',
      stage,
      theme: {},
      renderSlideElement: (s) =>
        h('div', { class: 'slide' }, [
          s.id === 'a' ? h('a', { href: '#', ...navAttrs, text: 'go' }) : null,
        ]),
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
      getSessionReady: () => false,
      getFollowCodes: () => null,
      getStepParagraphs: () => false,
      setStepParagraphs: noop,
    });
    ctl.setPresentation({
      slides: [
        { id: 'a', type: 'title-slide', content: {} },
        {
          id: 'b',
          type: 'title-slide',
          content: {},
          visibility: { hideInPresentation: true },
        },
        { id: 'c', type: 'title-slide', content: {} },
        { id: 'd', type: 'title-slide', content: {} },
      ],
    });
    const click = () =>
      stage
        .querySelector('a')
        .dispatchEvent(
          new window.MouseEvent('click', { bubbles: true, cancelable: true }),
        );
    const shownId = () =>
      stage.querySelectorAll('.deck-slide')[ctl.getState().idx]?.dataset
        .slideId;
    return { click, shownId, done: () => stage.remove() };
  }

  it('a hidden slide before the target does not shift #N', async () => {
    const { click, shownId, done } = await present({ 'data-card-nav': '3' });
    click();
    assert.equal(shownId(), 'c');
    done();
  });

  it('a jump to a hidden slide, or past the deck, does nothing', async () => {
    for (const n of ['2', '9']) {
      const { click, shownId, done } = await present({ 'data-card-nav': n });
      click();
      assert.equal(shownId(), 'a', `#${n}`);
      done();
    }
  });

  it('#slide:<id> keeps landing on its slide', async () => {
    const { click, shownId, done } = await present({
      'data-card-nav-id': 'd',
    });
    click();
    assert.equal(shownId(), 'd');
    done();
  });
});
