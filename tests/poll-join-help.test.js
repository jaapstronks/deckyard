/**
 * The poll's join line names the real follow URL when there are no codes
 * (B583, D299).
 *
 * Outside a live session no follow code is minted, so every export, thumbnail
 * and share view renders the poll without codes. That line used to print the
 * placeholder "Go to /follow/<presentationId>" verbatim. It now names the
 * follow path for the version on screen, built by the same `followPath()` the
 * invite's and feedback's QR encode, and prints nothing when there is no deck
 * id to name.
 *
 * Run with: node --test tests/poll-join-help.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import poll from '../shared/slide-types/types/poll-slide.js';
import feedback from '../shared/slide-types/types/feedback-slide.js';
import { followPath } from '../shared/slide-types/helpers.js';
import { SLIDE_COPY } from '../shared/slide-types/slide-copy.js';

const content = { ...poll.defaults, pollId: 'p1' };

test('no copy table carries the placeholder', () => {
  for (const [lang, table] of Object.entries(SLIDE_COPY))
    assert.doesNotMatch(
      table.pollJoinHelpWithoutCodes,
      /<presentationId>/,
      `${lang} still prints the placeholder`,
    );
});

test('without codes the poll prints the follow path for the version shown', () => {
  const html = poll.renderHtml(
    content,
    {},
    { presentationId: 'deck 1', lang: 'nl' },
  );
  assert.match(html, /Ga naar \/follow\/deck%201\?lang=nl/);
  assert.doesNotMatch(html, /<presentationId>|&lt;presentationId&gt;/);
});

test('the poll and feedback name the same follow path', () => {
  const ctx = { presentationId: 'd1', lang: 'en-GB' };
  const path = followPath('d1', 'en-GB');
  assert.ok(poll.renderHtml(content, {}, ctx).includes(path));
  assert.ok(feedback.renderHtml(feedback.defaults, {}, ctx).includes(path));
});

test('without a deck id there is no join line at all', () => {
  const html = poll.renderHtml(content, {}, { lang: 'en' });
  assert.doesNotMatch(html, /Go to \/follow/);
  assert.doesNotMatch(html, /<div class="help">/);
});

test('with codes the line still points at /go', () => {
  const html = poll.renderHtml(
    content,
    {},
    { presentationId: 'd1', lang: 'en', followCodes: { en: 'ABCD' } },
  );
  assert.match(html, /Go to \/go and enter the code/);
  assert.doesNotMatch(html, /\/follow\//);
});
