/**
 * Markup that arrives after the inits have run still gets its runtime (B391).
 *
 * `renderSlideElement()` runs the markup-reading inits on the markup it built.
 * For a server-rendered type that markup is a `slide-loading` placeholder, and
 * the real markup is swapped in later by `triggerServerRender()`. That swap
 * used to re-run only the theme vars and code/math, so a custom type whose
 * template carries `.slide-countdown` ticked in an export — the server's
 * `detectSlideRuntimeNeeds()` reads the finished markup — and stayed dead in
 * the app. One shared list (`MARKUP_RUNTIMES`) now serves both call sites.
 *
 * The server is simulated the way `tests/inline-ghost-server-rendered.test.js`
 * does it: core `countdown-slide` is listed as a fork override in the head
 * global the app shell injects, and the render request is answered
 * asynchronously with the shared renderer's markup. That exercises the real
 * render path and the real countdown runtime.
 *
 * Run with: node --test tests/slide-runtime-after-server-render.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/present/p1',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle;
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver =
  dom.window.IntersectionObserver || NoopObserver;
globalThis.ResizeObserver = dom.window.ResizeObserver || NoopObserver;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = clearTimeout;

const { renderSlideHtml } = await import('../shared/slide-types.js');
const { renderSlideElement, slideRendered, NO_DECK_LANG } =
  await import('../client/lib/slide-runtime/slide-render.js');

// A fork override of a core name renders server-side, so `renderSlideElement`
// returns a placeholder for it — exactly the shape a fork's own custom type has.
window.__DECK_SERVER_RENDERED_TYPES__ = ['countdown-slide'];

/** Resolve once `fn()` is truthy, or fail after `ms`. */
async function waitFor(fn, ms = 3000) {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * Mount one server-rendered countdown into the document and wait for the swap.
 * `content` is the slide content; the rest is the presenter surface.
 */
async function mountServerCountdown(content, { mode = 'present' } = {}) {
  const slide = { id: 'cd1', type: 'countdown-slide', content };
  const requests = [];
  const api = async (url, { body }) => {
    const sent = body;
    requests.push(url);
    await new Promise((r) => setTimeout(r, 10));
    return { html: renderSlideHtml(sent.slide, { mode: sent.mode }) };
  };
  const el = renderSlideElement(slide, {
    mode,
    renderVia: { kind: 'deck', id: 'p1' },
    api,
    lang: NO_DECK_LANG,
  });
  document.body.append(el);
  assert.equal(
    el.dataset.needsServerRender,
    '1',
    'the type must take the server-render path for this test to mean anything',
  );
  assert.equal(
    el.querySelector('.slide-countdown, [data-countdown-display="1"]'),
    null,
    'the placeholder carries none of the markup the runtime reads',
  );
  assert.equal(await slideRendered(el), true);
  assert.ok(requests.length, 'the server was asked to render the slide');
  return { el, slide };
}

test('a server-rendered countdown is live once its markup lands', async () => {
  const { el } = await mountServerCountdown({
    title: 'Break',
    durationMinutes: 0,
    durationSeconds: 45,
  });
  try {
    assert.ok(
      el.classList.contains('slide-countdown'),
      'the swap put the real markup in place',
    );
    assert.equal(
      el.dataset.cdInit,
      '1',
      'the countdown runtime ran against the markup the server delivered',
    );

    const controls = el.querySelector('[data-countdown-controls="1"]');
    assert.equal(
      controls.hidden,
      false,
      'present mode shows the presenter controls — the runtime unhides them',
    );

    const display = el.querySelector('[data-countdown-display="1"]');
    assert.equal(display.textContent, '00:45');

    el.querySelector('[data-countdown-action="start"]').click();
    await waitFor(() => display.textContent !== '00:45');
    assert.match(
      display.textContent,
      /^00:4[0-4]$/,
      'the timer is counting down, not just painted once',
    );
  } finally {
    el.__sbCleanup?.();
    el.remove();
  }
});

test('the runtime of a server-rendered slide is cleaned up with the rest', async () => {
  const { el } = await mountServerCountdown({
    durationMinutes: 0,
    durationSeconds: 45,
  });
  const display = el.querySelector('[data-countdown-display="1"]');
  try {
    el.querySelector('[data-countdown-action="start"]').click();
    await waitFor(() => display.textContent !== '00:45');

    // The cleanups of the second pass land in the row `__sbCleanup` drains,
    // not in a row of their own — otherwise every remount leaks a timer.
    el.__sbCleanup();
    const frozen = display.textContent;
    await new Promise((r) => setTimeout(r, 600));
    assert.equal(
      display.textContent,
      frozen,
      'cleanup stopped the timer the server-rendered markup started',
    );
  } finally {
    el.__sbCleanup?.();
    el.remove();
  }
});

test('a mode-gated runtime keeps its condition across the swap', async () => {
  // `interactive` is false in `thumb`, so the controls stay hidden and the
  // timer never runs. The condition travels with the declaration, so the
  // second pass applies it exactly as the first would have.
  const { el } = await mountServerCountdown(
    { durationMinutes: 0, durationSeconds: 45, autoStart: 'on' },
    { mode: 'thumb' },
  );
  try {
    assert.equal(el.dataset.cdInit, '1');
    assert.equal(
      el.querySelector('[data-countdown-controls="1"]').hidden,
      true,
      'a thumbnail gets the static countdown, not the presenter one',
    );
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(
      el.querySelector('[data-countdown-display="1"]').textContent,
      '00:45',
      'auto-start does not fire in a thumbnail',
    );
  } finally {
    el.__sbCleanup?.();
    el.remove();
  }
});
