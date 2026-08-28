/**
 * The guest-verification failure banner: `?guest_error=` now has a surface.
 *
 * A guest whose e-mail verification link fails is redirected to
 * `/s/:token?guest_error=<reason>` (`handleShareGuestVerify`). The viewer read
 * that code, `console.warn`ed it, and rendered the deck as if nothing had
 * happened — the click that was supposed to sign them in produced no visible
 * answer at all. The copy that once described these reasons lived in the
 * join-form map, which this path never reaches, and went away with #923.
 *
 * This file drives the real `createGuestVerifyNotice()` under jsdom and asserts
 * what the guest is left looking at, per code and per session state:
 *
 *  1. `invalid_token` and `token_expired` each get their own copy
 *  2. an unrecognised reason still says something, rather than nothing
 *  3. the re-request path is offered — the join prompt *is* "request a new one"
 *  4. …except to a guest who is already signed in, for whom the ordinary cause
 *     is a second click on a link whose token was spent by the first
 *  5. …and except on a link that admits no guests, where there is nothing to
 *     request
 *  6. dismissing removes the banner and reports it, so a re-render cannot
 *     resurrect it
 *
 * The seventh guarantee — that the querystring cannot raise the banner twice —
 * lives in `client/views/share-viewer/index.js`, which strips the parameter
 * with `history.replaceState` in the same breath as it reads it. That is
 * asserted here against the source, since the orchestrator wants a whole share
 * session (validate + verify + guest/me) to run at all.
 *
 * Run with: node --test tests/share-guest-verify-error-notice.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/s/tok-comment',
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

const { createGuestVerifyNotice } =
  await import('../client/views/share-viewer/guest-verify-notice.js');

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * Mount a banner and read back what it says and what it offers.
 * @param {Object} opts - Passed straight to `createGuestVerifyNotice`.
 * @returns {{text: string, actions: string[], el: HTMLElement}}
 */
function render(opts) {
  const el = createGuestVerifyNotice(opts);
  document.body.append(el);
  return {
    el,
    text: el.textContent || '',
    actions: [...el.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label') === null ? b.textContent : '(close)',
    ),
  };
}

test('each verify code says what actually happened', () => {
  const invalid = render({ code: 'invalid_token' });
  assert.match(invalid.text, /That verification link didn't work/);
  assert.match(invalid.text, /already been used/);

  const expired = render({ code: 'token_expired' });
  assert.match(expired.text, /That verification link has expired/);
  assert.match(expired.text, /24 hours/);

  assert.notEqual(
    invalid.text,
    expired.text,
    'the two reasons are told apart, which is the whole point of keying on the code',
  );
});

test('a reason with no copy of its own still produces a visible message', () => {
  // `verifyGuestEmail` can also answer `share_link_revoked` / `unavailable`.
  // Those mean the link itself is dead and the viewer refuses the page before
  // this banner renders — but silence must never be the fallback again.
  const generic = render({ code: 'share_link_revoked' });
  assert.match(generic.text, /couldn't verify your email/);
  assert.notEqual(generic.text.trim(), '');
});

test('the banner carries the re-request path, not just the bad news', () => {
  let opened = 0;
  const { actions, el } = render({
    code: 'token_expired',
    onRequestNewLink: () => opened++,
  });
  assert.deepEqual(actions, ['Request a new link', '(close)']);

  const retry = [...el.querySelectorAll('button')].find(
    (b) => b.textContent === 'Request a new link',
  );
  retry.dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(opened, 1, 'the button opens the join prompt');
});

test('a guest who is already signed in is told that, not told to try again', () => {
  // The verification token is spent on first use, so the second click on the
  // same mail answers `invalid_token` while the session from the first click
  // is perfectly alive. "Request a new link" would be the wrong advice.
  const { text, actions } = render({
    code: 'invalid_token',
    signedInAs: 'Robin',
    onRequestNewLink: () => assert.fail('must not be offered'),
  });
  assert.match(text, /already signed in as Robin/);
  assert.deepEqual(actions, ['(close)']);
});

test('a view-only link offers nothing to request', () => {
  // No join prompt exists on a link that admits no guests, so the banner is
  // purely informational there.
  const { actions } = render({ code: 'token_expired', onRequestNewLink: null });
  assert.deepEqual(actions, ['(close)']);
});

test('dismissing removes the banner and says so', () => {
  let dismissed = 0;
  const { el } = render({
    code: 'invalid_token',
    onDismiss: () => dismissed++,
  });
  const close = el.querySelector('.share-viewer-notice-close');
  close.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(el.isConnected, false, 'the banner is gone from the document');
  assert.equal(dismissed, 1, 'and the orchestrator hears about it');
});

test('the querystring cannot raise the banner a second time', () => {
  // The strip runs in the same breath as the read, so a reload of the landing
  // URL is an ordinary share-viewer visit. Both halves go through the router
  // (B183): `queryParam` reads, `setQueryParams({ guest_error: null })` drops.
  const src = fs.readFileSync(
    path.join(repoRoot, 'client/views/share-viewer/index.js'),
    'utf8',
  );
  const block = src.slice(src.indexOf("queryParam('guest_error')"));
  const stripAt = block.indexOf('setQueryParams({ guest_error: null })');
  const renderAt = block.indexOf('guestVerifyError');
  assert.ok(stripAt > -1, 'the parameter is stripped');
  assert.ok(
    renderAt > -1 && renderAt < stripAt,
    'the code is captured before the URL is rewritten',
  );
});
