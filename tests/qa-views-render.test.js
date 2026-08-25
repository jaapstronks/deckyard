/**
 * The Q&A views render the same question (B153).
 *
 * The follow page and the presenter's notes panel both render the live
 * question list, and each used to read the wire object itself rather than one
 * accessor. This drives both against one payload whose two text fields differ
 * and asserts they land on the same string — the assertion that keeps a
 * moderator from deleting a question whose text they never saw.
 *
 * Rendering only: none of these tests connects an SSE stream (the views are fed
 * through the feed's HTTP read, which tests/qa-single-owner.test.js covers on
 * its own).
 *
 * Run with: node --test tests/qa-views-render.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/follow/deck-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { createFollowQaController } =
  await import('../client/views/follow/qa.js');
const { createNotesQaController } = await import('../client/views/notes/qa.js');

// The question the views disagreed about: `text` is the documented
// back-compat alias, `original.text` is what was actually asked.
const ASKED = 'How does the licence work?';
const ALIAS = 'Hoe werkt de licentie?';
const PAYLOAD = {
  status: 'live',
  capabilities: { canUseQa: true },
  questions: [
    {
      id: 'q1',
      text: ALIAS,
      original: { lang: 'nl', text: ASKED },
      authorName: 'Ada',
      upvotes: 2,
      status: 'active',
      createdAt: 100,
    },
  ],
};

/** @param {string} tag @returns {HTMLElement} */
function el(tag = 'div') {
  const node = dom.window.document.createElement(tag);
  dom.window.document.body.append(node);
  return node;
}

/** An api() double that always answers with PAYLOAD. @returns {Function} */
function payloadApi() {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return PAYLOAD;
  };
  fn.calls = calls;
  return fn;
}

test('the follow page renders the question as asked', async () => {
  const qaList = el();
  const controller = createFollowQaController({
    api: payloadApi(),
    presentationId: 'deck-1',
    qaWrap: el(),
    qaHint: el(),
    qaNameBtn: el('button'),
    qaInput: el('input'),
    qaAskBtn: el('button'),
    qaList,
    getCopy: () => ({ qaEmpty: 'none yet', qaUpvote: 'Upvote' }),
    questionsApi: {},
  });

  assert.equal(await controller.refreshQuestionsIfLive(), true);
  const text = qaList.querySelector('.follow-qa-text').textContent;
  assert.equal(text, ASKED);
  assert.equal(qaList.querySelector('.follow-qa-votes').textContent, '2');
  assert.match(qaList.querySelector('.follow-qa-author').textContent, /Ada/);
  controller.destroy();
});

test('the presenter notes panel renders the same question text', async () => {
  const qaBody = el();
  const controller = createNotesQaController({
    api: payloadApi(),
    qaWrap: el(),
    qaBody,
    getPresentationId: () => 'deck-1',
    user: { isAdmin: false },
  });

  await controller.refresh();
  assert.equal(qaBody.querySelector('.notes-qa-body').textContent, ASKED);
  assert.equal(qaBody.querySelector('.notes-qa-who').textContent, 'Ada');
  controller.destroy();
});

test('an unauthored question falls back to the back-compat alias everywhere', async () => {
  // Payloads that predate `original` carry only `text`; both views still read it.
  const legacy = {
    status: 'live',
    capabilities: { canUseQa: true },
    questions: [{ id: 'q9', text: ALIAS, upvotes: 0, createdAt: 1 }],
  };
  const api = async () => legacy;

  const qaList = el();
  const follow = createFollowQaController({
    api,
    presentationId: 'deck-1',
    qaWrap: el(),
    qaHint: el(),
    qaNameBtn: el('button'),
    qaInput: el('input'),
    qaAskBtn: el('button'),
    qaList,
    getCopy: () => ({ qaEmpty: 'none yet' }),
    questionsApi: {},
  });
  await follow.refreshQuestionsIfLive();
  assert.equal(qaList.querySelector('.follow-qa-text').textContent, ALIAS);
  follow.destroy();

  const qaBody = el();
  const notes = createNotesQaController({
    api,
    qaWrap: el(),
    qaBody,
    getPresentationId: () => 'deck-1',
    user: {},
  });
  await notes.refresh();
  assert.equal(qaBody.querySelector('.notes-qa-body').textContent, ALIAS);
  notes.destroy();
});

test('a disabled Q&A hides the notes panel and drops the list', async () => {
  const qaWrap = el();
  const qaBody = el();
  const notes = createNotesQaController({
    api: async () => ({
      status: 'live',
      capabilities: { canUseQa: false },
      questions: PAYLOAD.questions,
    }),
    qaWrap,
    qaBody,
    getPresentationId: () => 'deck-1',
    user: {},
  });

  await notes.refresh();
  assert.equal(qaWrap.style.display, 'none');
  assert.equal(qaBody.querySelector('.notes-qa-body'), null);
  notes.destroy();
});
