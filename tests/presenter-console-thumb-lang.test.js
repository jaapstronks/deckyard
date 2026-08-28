/**
 * The presenter console's next-slide thumbnail renders in the deck language.
 *
 * The thumb is a render surface like the stage, and it renders the *same*
 * slide types — so every `SLIDE_COPY` string in it (admonition eyebrows,
 * poll/likert/feedback copy, the image placeholder) has to come from the
 * deck's language. `createPresenterConsole` used to mount the thumb without
 * `lang`, which is the quiet failure mode: not "wrong language" but "always
 * `DEFAULT_SLIDE_COPY_LANG`", under a stage that was already correct.
 *
 * The callout eyebrow is the fixture because it is unconditional — an
 * unlabelled callout always shows the per-variant word, in one language or
 * the other, with no interaction state or network to arrange.
 *
 * Run with: node --test tests/presenter-console-thumb-lang.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/present/deck-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { createPresenterConsole } = await import(
  '../client/views/presenter/console.js'
);
const { SLIDE_COPY, DEFAULT_SLIDE_COPY_LANG } = await import(
  '../shared/slide-types/slide-copy.js'
);
const { resolveDeckLang } = await import('../shared/i18n-utils.js');

const calloutSlide = {
  id: 's2',
  type: 'callout-slide',
  content: { variant: 'insight', body: 'Een deck is geen document.' },
};

/** Mount a console for `lang` and return the next-slide thumb's text. */
const thumbTextFor = (lang) => {
  const ctl = createPresenterConsole({ presentationId: 'deck-1', lang });
  document.body.append(ctl.el);
  ctl.update({ current: { id: 's1' }, next: calloutSlide, idx: 0, total: 2 });
  const text = ctl.el.querySelector('.presenter-console-thumb').textContent;
  ctl.detach();
  ctl.el.remove();
  return text;
};

test('the next-slide thumb renders its built-in copy in the deck language', () => {
  assert.match(thumbTextFor('nl'), new RegExp(SLIDE_COPY.nl.admonitionInsight));
  assert.match(
    thumbTextFor('en-GB'),
    new RegExp(SLIDE_COPY['en-GB'].admonitionInsight),
  );
});

test('a Dutch deck does not get the default language in the thumb', () => {
  // The regression itself: before the fix both languages produced this string,
  // because the thumb was mounted without `lang` at all.
  const dutch = thumbTextFor('nl');
  assert.doesNotMatch(
    dutch,
    new RegExp(SLIDE_COPY[DEFAULT_SLIDE_COPY_LANG].admonitionInsight),
  );
});

test('the console takes the same language source as the stage', () => {
  // `resolveDeckLang(pres)` is the one decider (slide-copy-language.md), and
  // `active` outranks `lang`: a deck authored in English but being read in
  // Dutch gets Dutch copy in the thumb, exactly as it does on the stage.
  const pres = { lang: 'en-GB', i18n: { dominant: 'en-GB', active: 'nl' } };
  assert.match(
    thumbTextFor(resolveDeckLang(pres)),
    new RegExp(SLIDE_COPY.nl.admonitionInsight),
  );
});
