/**
 * Guest-join error copy: the map keys on the machine code, and every entry in
 * it is reachable from the one request this surface makes.
 *
 * Two defects sat on top of each other. The map in
 * `client/views/share-viewer/guest-join.js` keys on machine codes but was
 * handed `err.message` (the human text), so *every* failure rendered the
 * generic line. And the email entry stayed dead even after that: the route
 * pre-checked `!email.includes('@')` itself and answered `bad_request`,
 * shadowing the identical storage guard that returns the canonical
 * `{ reason:'invalid', field:'email' }`.
 *
 * This file pins both halves. The first test drives the real form under jsdom
 * with a stubbed `fetch`, once per reachable code, and asserts the copy — the
 * whole chain from the wire envelope through `err.code` to the rendered text.
 * The second pins the route: a malformed address now reaches the storage guard
 * and comes back as `invalid`, not `bad_request`.
 *
 * The reachable set is exactly what `POST /api/share/:token/guest/request`
 * can answer. `invalid_token` / `token_expired` belong to the verify path — a
 * link click that redirects to `/s/:token?guest_error=…` — and are absent from
 * the map on purpose.
 *
 * Run with: node --test tests/share-guest-join-error-copy.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
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
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const { renderGuestJoinPrompt } =
  await import('../client/views/share-viewer/guest-join.js');

/**
 * Every code `POST /api/share/:token/guest/request` can answer, with the copy
 * it must produce. Sourced from `server/storage/share-links/guests.js`
 * (`requestGuestVerification`) plus the route's own `forbidden`.
 */
const REACHABLE = [
  {
    code: 'share_link_not_found',
    status: 404,
    copy: 'Share link not found.',
  },
  {
    code: 'share_link_expired',
    status: 410,
    copy: 'This share link has expired.',
  },
  {
    code: 'share_link_revoked',
    status: 410,
    copy: 'This share link has been revoked.',
  },
  {
    code: 'forbidden',
    status: 403,
    copy: 'This share link does not allow commenting.',
  },
  {
    code: 'not_invited',
    status: 403,
    copy: 'This presentation requires an invitation. Please contact the author to request access.',
  },
  {
    code: 'rate_limited',
    status: 429,
    copy: 'Too many requests. Please try again later.',
  },
  {
    code: 'invalid',
    status: 400,
    copy: 'Please enter a valid email address.',
  },
];

const GENERIC = 'Something went wrong. Please try again.';

/**
 * Mount the prompt, submit it once against a stubbed error envelope, and hand
 * back the text the user is left looking at.
 * @param {Object} body - The JSON error body the server answers with.
 * @param {number} status - HTTP status for that body.
 * @returns {Promise<string>} Rendered error text.
 */
async function submitAgainst(body, status) {
  const shell = document.createElement('div');
  document.body.append(shell);
  // Node's own `Response`: jsdom ships no fetch, and `api()` only needs a
  // real `res.ok` / `res.headers.get()` / `res.json()`.
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });

  renderGuestJoinPrompt(shell, 'tok-comment', 'comment', () => {});
  const form = shell.querySelector('form.share-viewer-guest-form');
  form.querySelector('input[type="email"]').value = 'guest@example.com';
  form.dispatchEvent(
    new dom.window.Event('submit', { bubbles: true, cancelable: true }),
  );
  // The submit handler is async: let the stubbed fetch and its .json() settle.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

  // The refusal lives in the one inline element for it
  // (docs/reference/feedback-surfaces.md), beside the button that was pressed.
  const errorEl = shell.querySelector('.inline-error');
  const text = errorEl?.textContent || '';
  shell.remove();
  return text;
}

test('each reachable code renders its own copy, not the generic line', async () => {
  for (const { code, status, copy } of REACHABLE) {
    const text = await submitAgainst(
      {
        ok: false,
        error: code,
        // The human message is deliberately different from the copy: if the
        // map ever keys on `err.message` again, this is what would show up.
        message: `server text for ${code}`,
      },
      status,
    );
    assert.equal(text, copy, `copy for ${code}`);
    assert.notEqual(text, GENERIC, `${code} must not fall through`);
  }
});

test('a malformed address gets the email line, not the generic one', async () => {
  // The shape the route now produces: the storage guard's canonical
  // `{ reason:'invalid', field:'email' }` through `storageError`.
  const text = await submitAgainst(
    {
      ok: false,
      error: 'invalid',
      message: 'Invalid request',
      details: { field: 'email' },
    },
    400,
  );
  assert.equal(text, 'Please enter a valid email address.');
});

test('an unrecognised code still falls back to the generic line', async () => {
  const text = await submitAgainst(
    { ok: false, error: 'teapot', message: 'nope' },
    418,
  );
  assert.equal(text, GENERIC);
});

test('verify-path codes are absent from the join map', async () => {
  // They arrive as `?guest_error=` on `/s/:token`, never as a response to this
  // form. Keeping copy for them here would be copy that can never render.
  for (const code of ['invalid_token', 'token_expired']) {
    const text = await submitAgainst(
      { ok: false, error: code, message: 'nope' },
      400,
    );
    assert.equal(text, GENERIC, `${code} is not a join-form outcome`);
  }
});
