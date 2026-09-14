/**
 * Auto-start countdowns start when their slide is shown, not when mounted.
 *
 * The presenter mounts every slide of the deck at once. A countdown with
 * auto-start used to start at mount, so a deck with six timer slides in a row
 * ran all six in parallel: arriving on slide 3 after ten seconds on slide 2
 * showed 08:50 instead of 09:00.
 *
 * Three rules:
 *   1. **Inactive deck slides wait.** A countdown in a `section.deck-slide`
 *      that is not `is-active` does not run.
 *   2. **Activation starts it.** The moment its section becomes `is-active`,
 *      the countdown runs from its full duration.
 *   3. **No deck section, start at once.** Outside the presenter the slide on
 *      screen is the one being initialised, so auto-start runs immediately.
 *
 * Run with: node --test tests/countdown-autostart-on-arrival.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.MutationObserver = dom.window.MutationObserver;

const { initCountdownSlides } =
  await import('../client/lib/slide-runtime/countdown-runtime.js');

const countdownEl = () => {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="slide slide-countdown" data-countdown-seconds="540"
      data-countdown-autostart="1" data-countdown-sound="0">
      <div data-countdown-display="1"></div>
      <div data-countdown-controls="1">
        <button data-countdown-action="start"></button>
        <button data-countdown-action="pause" hidden></button>
        <button data-countdown-action="reset"></button>
      </div>
    </div>`;
  return wrap.firstElementChild;
};

// The start button hides while the timer runs.
const isRunning = (el) =>
  el.querySelector('[data-countdown-action="start"]').hidden === true;

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

test('mounted deck: only the active slide auto-starts, the next one on arrival', async (t) => {
  // Mirror the presenter: render, then wrap in a section, then mark active.
  const slides = [countdownEl(), countdownEl()];
  const cleanups = slides.map((el) => initCountdownSlides(el));
  t.after(() => {
    for (const fn of cleanups) fn();
    document.body.innerHTML = '';
  });
  const sections = slides.map((el) => {
    const section = document.createElement('section');
    section.className = 'deck-slide';
    section.append(el);
    document.body.append(section);
    return section;
  });
  sections[0].classList.add('is-active');

  await flushMicrotasks();
  assert.equal(isRunning(slides[0]), true, 'active slide runs');
  assert.equal(isRunning(slides[1]), false, 'next slide waits');

  sections[0].classList.remove('is-active');
  sections[1].classList.add('is-active');
  await flushMicrotasks();
  assert.equal(isRunning(slides[1]), true, 'next slide runs on arrival');
  assert.equal(
    slides[1].querySelector('[data-countdown-display="1"]').textContent,
    '09:00',
  );
});

test('no deck section: auto-start runs at once', async (t) => {
  const el = countdownEl();
  document.body.append(el);
  const cleanup = initCountdownSlides(el);
  t.after(() => {
    cleanup();
    document.body.innerHTML = '';
  });
  await flushMicrotasks();
  assert.equal(isRunning(el), true);
});

test('cleanup before activation: the countdown never starts', async (t) => {
  const el = countdownEl();
  const section = document.createElement('section');
  section.className = 'deck-slide';
  const cleanup = initCountdownSlides(el);
  section.append(el);
  document.body.append(section);
  t.after(() => {
    cleanup();
    document.body.innerHTML = '';
  });
  await flushMicrotasks();
  cleanup();
  section.classList.add('is-active');
  await flushMicrotasks();
  assert.equal(isRunning(el), false);
});
