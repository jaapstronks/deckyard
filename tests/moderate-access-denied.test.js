/**
 * The moderator route refuses without crashing (B144).
 *
 * `renderModerate` used to `throw` when the user was not an admin. app.js
 * catches a mount failure with `renderFatal()`, so a plain member who followed
 * a `/moderate/:id` link landed on "Something went wrong" with a stack trace in
 * a `<pre>` — a crash screen for an ordinary permission answer.
 *
 * The gate is now `isOrganizationAdmin()` (so an admin of another workspace is
 * refused too, matching the rest of the client) and it renders a plain refusal.
 *
 * Run with: node --test tests/moderate-access-denied.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/moderate/deck-1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;

const { renderModerate } = await import('../client/views/moderate.js');

/** A fresh mount point. @returns {HTMLElement} */
function mountPoint() {
  const root = dom.window.document.createElement('div');
  dom.window.document.body.append(root);
  return root;
}

const REFUSED = [
  ['no user at all', undefined],
  ['a signed-in non-admin', { isAdmin: false }],
  // The case the workspace gate exists for: instance admin, plain member in
  // the workspace this deck belongs to.
  [
    'an instance admin who is a plain member here',
    {
      isAdmin: true,
      organizationRole: 'member',
    },
  ],
];

for (const [label, user] of REFUSED) {
  test(`moderator route refuses ${label} without a crash screen`, async () => {
    const root = mountPoint();
    const detach = await renderModerate(root, 'deck-1', { user });

    assert.equal(root.querySelector('.moderate-list'), null, 'no live list');
    const help = root.querySelector('.help');
    assert.ok(help, 'a plain refusal is rendered');
    assert.match(help.textContent, /admin/i);
    assert.equal(root.querySelector('pre'), null, 'no stack trace');
    // The mount contract: app.js does `(await mounting) || null`, so whatever
    // comes back must be safe to call.
    assert.doesNotThrow(() => detach?.());
  });
}

test('the moderator route still refuses a missing presentation id by throwing', async () => {
  // A missing id *is* a programming error, so that path is unchanged.
  await assert.rejects(
    () => renderModerate(mountPoint(), '   ', { user: { isAdmin: true } }),
    /presentationId/i,
  );
});
