/**
 * The third client-side advisory mirror: the share modal's owner gate (B151).
 *
 * `docs/reference/permission-model.md` names three mirrors — "which affordance
 * to show, never whether an operation is allowed". Two of them are pinned by
 * `tests/identity-api-contract.test.js`; this file pins the third:
 * `client/views/editor/modals/share-modal/index.js`, where
 * `const canTransfer = isOwner(currentUser, pres)` decides whether the
 * transfer-ownership button is rendered next to the owner row.
 *
 * The normative behaviour is already written down, so this is transcription:
 * the deck's owner sees the affordance, and nobody else does — not an admin,
 * not the creator who handed the deck over (D43), not a collaborator.
 *
 * Run with: node --test tests/share-modal-owner-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/deck-1',
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
globalThis.ResizeObserver =
  dom.window.ResizeObserver ||
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

const { openShareModal } =
  await import('../client/views/editor/modals/share-modal/index.js');

const OWNER_ID = 'user-owner-0001';
const OTHER_ID = 'user-other-0002';

const PRES = {
  id: 'deck-1',
  ownerId: OWNER_ID,
  ownerEmail: 'owner@example.com',
  createdById: OTHER_ID,
  createdBy: 'former@example.com',
};

/** Stub the endpoints the modal hits on open; nothing else is exercised. */
async function fakeApi(path) {
  if (path.endsWith('/collaborators')) {
    return {
      collaborators: [
        {
          id: 'collab-1',
          userId: OTHER_ID,
          userEmail: 'other@example.com',
          permission: 'edit',
        },
      ],
    };
  }
  if (path.includes('/share-links')) return { links: [] };
  return {};
}

/**
 * Open the modal as `currentUser` and return the rendered owner row.
 * Awaits a macrotask turn so the async collaborator load has painted.
 */
async function openAs(currentUser, { pres = PRES } = {}) {
  document.body.innerHTML = '';
  const handle = openShareModal({
    api: fakeApi,
    pres,
    id: pres.id,
    root: document.body,
    lockDocumentScroll: () => () => {},
    copyToClipboard: () => {},
    toast: { success() {}, error() {}, warning() {} },
    currentUser,
    currentUserEmail: currentUser?.email,
    isAdmin: false,
    isDirty: () => false,
    requestSave: async () => {},
    editorState: { refreshAll: () => {} },
    syncShareUi: () => {},
    notionAvailable: () => false,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const ownerRow = document.querySelector('.share-collaborator-owner');
  return { handle, ownerRow };
}

/** The transfer button is the only button on the owner row. */
function transferButton(ownerRow) {
  return ownerRow?.querySelector('button') || null;
}

test('the owner sees the transfer-ownership affordance', async () => {
  const { handle, ownerRow } = await openAs({
    id: OWNER_ID,
    email: 'owner@example.com',
  });

  assert.ok(ownerRow, 'owner row renders');
  assert.ok(
    transferButton(ownerRow),
    'owner gets the transfer-ownership button',
  );
  handle.close();
});

test('a non-owner collaborator does not', async () => {
  const { handle, ownerRow } = await openAs({
    id: OTHER_ID,
    email: 'other@example.com',
  });

  assert.ok(ownerRow, 'owner row still renders (the address is display)');
  assert.equal(
    transferButton(ownerRow),
    null,
    'no transfer affordance for a collaborator',
  );
  handle.close();
});

test('the creator who handed the deck over does not (D43)', async () => {
  // `createdById` is a display pair, never an identity claim: the server's
  // canTransferOwnership refuses the former creator, so the button would 401.
  const { handle, ownerRow } = await openAs({
    id: OTHER_ID,
    email: 'former@example.com',
  });

  assert.equal(
    transferButton(ownerRow),
    null,
    'the creator stamp does not re-open the gate',
  );
  handle.close();
});

test('an anonymous session does not', async () => {
  const { handle, ownerRow } = await openAs(null);

  assert.equal(
    transferButton(ownerRow),
    null,
    'no current user, no transfer affordance',
  );
  handle.close();
});

test('the gate is decided on the id, not on a matching address', async () => {
  // Same address, different account: the mirror compares `users.id` exactly as
  // the server does (T10), so a shared or recycled address grants nothing.
  const { handle, ownerRow } = await openAs({
    id: OTHER_ID,
    email: 'owner@example.com',
  });

  assert.equal(
    transferButton(ownerRow),
    null,
    'a matching email is not ownership',
  );
  handle.close();
});
