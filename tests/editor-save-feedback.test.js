import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'http://localhost/app/p1?lang=nl#slide=s1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: dom.window.navigator,
});
const { createSaveStatus } =
  await import('../client/views/editor/save-status.js');
const { savedQualityIssues } =
  await import('../client/views/editor/save-feedback.js');
const slideTypes = {
  'text-slide': { fields: [{ key: 'title', type: 'string', maxLength: 5 }] },
};
const pres = () => ({
  id: 'p1',
  revision: 2,
  slides: [{ id: 's1', type: 'text-slide', content: { title: 'Dutch' } }],
  i18n: {
    active: 'nl',
    dominant: 'nl',
    versions: {
      nl: { slides: [] },
      'en-GB': {
        slides: [
          {
            id: 's1',
            type: 'text-slide',
            content: { title: 'English too long' },
          },
        ],
      },
    },
  },
});

test('a failed save preserves focus, URL and language until the recovery action is chosen', async () => {
  const deck = pres();
  const before = structuredClone(deck);
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  const navigations = [];
  const status = createSaveStatus({
    pres: deck,
    slideTypes,
    onReveal: (target) => navigations.push(target),
  });
  document.body.append(status.el);
  const error = Object.assign(new Error('Full server message'), {
    code: 'invalid',
    statusCode: 400,
    details: {
      lang: 'en-GB',
      slideId: 's1',
      field: 'title',
      errors: ['Exact validation diagnostic'],
    },
  });
  const url = window.location.href;
  status.setError(error);
  status.setStatus('error', error.message);
  assert.equal(document.activeElement, input);
  assert.equal(window.location.href, url);
  assert.deepEqual(deck, before);
  assert.deepEqual(navigations, []);
  assert.match(status.el.textContent, /English.*slide 1.*title/);
  const report = status.el.querySelector('textarea');
  assert.equal(report.readOnly, true);
  for (const text of [
    url,
    'Full server message',
    'Exact validation diagnostic',
    'en-GB',
    'Revision: 2',
    'HTTP status: 400',
  ])
    assert.ok(report.value.includes(text), text);
  // Diagnostics are a failure-time snapshot, even if the URL subsequently moves.
  history.replaceState({}, '', '/app/p1?lang=de');
  assert.ok(report.value.includes(url));
  const [go, copy] = status.el.querySelectorAll('button');
  go.click();
  assert.deepEqual(navigations, [error.details]);
  let clipboard = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value) => {
        clipboard = value;
      },
    },
  });
  copy.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(clipboard, report.value);
  // A blocked clipboard leaves a selectable text field for keyboard copying.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error('blocked');
      },
    },
  });
  copy.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(document.activeElement, report);
  assert.equal(report.selectionEnd, report.value.length);
  status.setError(null);
  status.setStatus('saved');
  assert.equal(report.value, '');
  assert.equal(status.el.querySelector('details').hidden, true);
  status.detach();
});

test('network and storage failures also have reports, without a false field target', () => {
  const status = createSaveStatus({ pres: pres(), slideTypes });
  status.setError(new Error('Storage unavailable'));
  status.setStatus('error', 'Storage unavailable');
  assert.equal(status.el.querySelector('button').hidden, true);
  assert.match(
    status.el.querySelector('textarea').value,
    /Storage unavailable/,
  );
  assert.equal(status.el.querySelector('details').hidden, false);
  status.detach();
});

test('retained old prose is saved with a review notice, not a save failure', () => {
  const deck = pres();
  const issues = savedQualityIssues(deck, slideTypes);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].lang, 'en-GB');
  const status = createSaveStatus({ pres: deck, slideTypes, onReveal() {} });
  status.setStatus('saved');
  assert.equal(status.el.hidden, false);
  assert.equal(status.el.classList.contains('is-failure'), false);
  assert.match(status.el.textContent, /Your changes are saved/);
  assert.equal(status.el.querySelector('details').hidden, true);
  deck.i18n.versions['en-GB'].slides[0].content.title = 'Good';
  status.setStatus('saved');
  assert.equal(status.el.hidden, true);
  status.detach();
});

test('a failure interrupts as an alert; a review notice waits as a status (B875)', () => {
  const status = createSaveStatus({ pres: pres(), slideTypes, onReveal() {} });
  status.setStatus('error', 'Refused.');
  assert.equal(status.el.getAttribute('role'), 'alert');
  assert.equal(status.el.getAttribute('aria-live'), 'assertive');
  status.setStatus('saved');
  assert.equal(status.el.getAttribute('role'), 'status');
  assert.equal(status.el.getAttribute('aria-live'), 'polite');
  status.setStatus('disconnected');
  assert.equal(status.el.getAttribute('role'), 'alert');
  status.detach();
});

test('a shortened description stays noted across later saves until reviewed (B875)', () => {
  const deck = pres();
  deck.i18n.versions['en-GB'].slides[0].content.title = 'Good';
  const reveals = [];
  const status = createSaveStatus({
    pres: deck,
    slideTypes,
    onReveal: (target) => reveals.push(target),
  });
  // The form shortened the active version when it rendered; the save that
  // stored it, and an autosave after it, found nothing left to shorten.
  status.addNormalized([{ slideId: 's1', lang: 'nl', field: 'title' }]);
  status.addNormalized([{ slideId: 's1', lang: 'nl', field: 'title' }]);
  status.addNormalized([]);
  status.setStatus('saved');
  status.addNormalized([]);
  status.setStatus('saved');
  assert.equal(status.el.hidden, false);
  assert.match(status.el.textContent, /description was shortened/);

  const go = [...status.el.querySelectorAll('button')].find(
    (b) => b.textContent === 'Go to field',
  );
  go.click();
  assert.deepEqual(reveals, [{ slideId: 's1', lang: 'nl', field: 'title' }]);
  status.setStatus('saved');
  assert.equal(status.el.hidden, true, 'reviewed: the notice is gone');
  status.detach();
});
