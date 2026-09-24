/**
 * A blank presentation without a title is refused at the title field (B444).
 *
 * "Create" with an empty title used to write one footer status line and look
 * like it did nothing. A refusal of the form the user is filling in is a state
 * of that form (docs/reference/feedback-surfaces.md): the inline error under
 * the title field, the field marked invalid and focused, nothing toasted, and
 * the refusal gone at the start of the next attempt. The field is marked
 * required before anyone presses anything. A server refusal marks the title
 * only when it names it; anything else goes beside Create.
 *
 * Run with: node --test tests/new-presentation-title-inline.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;

const { openCreationView } =
  await import('../client/views/list/modals/creation-view/index.js');

/**
 * Open the creation view with an api that records what it was asked.
 * @param {(opts: Object) => any} [onCreate] - What POST /api/presentations does.
 */
function open(onCreate = () => ({ id: 'p-new' })) {
  const calls = [];
  const api = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url === '/api/presentations' && opts.method === 'POST') {
      return onCreate(opts);
    }
    return [];
  };
  const root = document.createElement('div');
  document.body.replaceChildren(root);
  openCreationView({
    api,
    root,
    readLangMode: () => 'en',
    writeLangMode: () => {},
    getSupportedLangs: () => ['en'],
  });
  const panel = document.querySelector('[data-method="blank"]');
  const field = panel.querySelector('.is-field');
  const input = field.querySelector('input');
  const create = [...document.querySelectorAll('button')].find(
    (b) => b.textContent === 'Create',
  );
  return { calls, field, input, create };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('the title field is marked required when the dialog opens', () => {
  const { field, input } = open();
  assert.ok(field.classList.contains('is-required'));
  assert.equal(input.getAttribute('aria-required'), 'true');
  assert.ok(field.querySelector('.field-label .field-required-mark'));
});

test('Create with an empty title refuses inline at the field', async () => {
  const { calls, field, input, create } = open();
  assert.ok(create, 'no Create button');

  create.click();
  await tick();

  const error = field.querySelector('.inline-error');
  assert.ok(error && !error.hidden, 'no inline error under the title');
  assert.equal(error.textContent, 'Enter a title first.');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.ok(input.getAttribute('aria-describedby').includes(error.id));
  assert.equal(document.activeElement, input, 'focus did not go to the title');
  assert.equal(document.querySelector('.toast'), null, 'refusal was toasted');
  assert.equal(
    calls.some((c) => c.url === '/api/presentations'),
    false,
    'an untitled deck reached the server',
  );
});

test('the next attempt clears the refusal before it runs', async () => {
  const { calls, field, input, create } = open();
  create.click();
  await tick();

  input.value = 'Quarterly review';
  create.click();
  await tick();

  const error = field.querySelector('.inline-error');
  assert.ok(error.hidden, 'refusal stayed after a titled attempt');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  const post = calls.find((c) => c.url === '/api/presentations');
  assert.equal(post?.opts.body.title, 'Quarterly review');
});

/**
 * A server refusal: an Error carrying `details`, the shape client/lib/api.js
 * throws for `{ ok:false, message, details }`.
 */
function refusal(message, details) {
  return () => {
    throw Object.assign(new Error(message), details ? { details } : {});
  };
}

test('a server refusal naming no field goes beside Create, not on the title', async () => {
  const { field, input, create } = open(refusal('Something went wrong.'));
  input.value = 'x';
  create.click();
  await tick();
  await tick();

  assert.ok(field.querySelector('.inline-error').hidden, 'title was blamed');
  assert.equal(input.hasAttribute('aria-invalid'), false);
  const callout = document.querySelector(
    '.creation-view-footer .inline-error.is-callout',
  );
  assert.ok(callout && !callout.hidden, 'no callout beside Create');
  assert.equal(callout.textContent, 'Something went wrong.');
  assert.equal(input.disabled, false, 'form stayed busy');

  // The next attempt starts clean.
  create.click();
  assert.ok(callout.hidden, 'callout stayed into the next attempt');
});

test('a server refusal naming the title lands on the title field', async () => {
  const { field, input, create } = open(
    refusal('Title is too long.', { field: 'title' }),
  );
  input.value = 'x';
  create.click();
  await tick();
  await tick();

  const error = field.querySelector('.inline-error');
  assert.equal(error.textContent, 'Title is too long.');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.ok(
    document.querySelector('.creation-view-footer .inline-error').hidden,
    'the title refusal was also shown beside Create',
  );
  assert.equal(input.disabled, false, 'form stayed busy');
});
