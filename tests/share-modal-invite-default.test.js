/**
 * The invite form starts at "Can edit", and its button names the level it
 * hands out (DY-876).
 *
 * Among colleagues in one organization, working together is the ordinary
 * intent: a colleague meaning to share editing sent "view and comment" because
 * the form opened on "View only" and nothing on the button said which role was
 * going out. Pinned here, through the real `api()` against a stubbed `fetch`:
 *  1. the select opens on `DEFAULT_INVITE_PERMISSION` (edit), carries an
 *     accessible name, and the button reads "Invite as editor";
 *  2. inviting without touching the select POSTs `edit`, and the form comes
 *     back on edit afterwards, not on view;
 *  3. choosing another level changes the button text with it.
 *
 * Run with: node --test tests/share-modal-invite-default.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/p1',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const { api } = await import('../client/lib/api.js');
const { createCollaboratorsSection } =
  await import('../client/views/editor/modals/share-modal/collaborators-section.js');

const { DEFAULT_INVITE_PERMISSION, PERMISSIONS } =
  await import('../shared/constants/permissions.js');

const PRESENTATION_ID = 'p1';
const INVITEE = { email: 'sarah@example.com', name: 'Sarah' };

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The autocomplete debounces its search by 300 ms. */
const afterDebounce = () => new Promise((r) => setTimeout(r, 350));

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/** Mount the section; every invite POST body lands in `posts`. */
function mount() {
  const posts = [];
  globalThis.fetch = async (path, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (path.startsWith('/api/users/search')) {
      return jsonResponse(200, { users: [INVITEE] });
    }
    if (path === `/api/presentations/${PRESENTATION_ID}/collaborators`) {
      if (method === 'POST') {
        const body = JSON.parse(opts.body);
        posts.push(body);
        return jsonResponse(200, {
          ok: true,
          summary: { successful: 1, failed: 0, total: 1 },
          results: [{ ok: true, email: INVITEE.email }],
        });
      }
      return jsonResponse(200, { collaborators: [] });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };

  const section = createCollaboratorsSection({
    api,
    presentationId: PRESENTATION_ID,
    pres: { id: PRESENTATION_ID, ownerEmail: 'owner@example.com' },
    currentUserEmail: 'owner@example.com',
    toast: { error: () => {}, success: () => {} },
    modalRoot: document.body,
  });
  document.body.append(section.el);
  const select = section.el.querySelector('.share-collaborator-permission');
  const button = section.el.querySelector(
    '.share-collaborator-form-row .btn-primary',
  );
  return { section, posts, select, button };
}

/** Type a query, pick the single result, then press Invite. */
async function inviteOne(section, button) {
  const input = section.el.querySelector('.user-autocomplete input');
  input.value = 'sarah';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await afterDebounce();
  const item = section.el.querySelector(
    `.user-autocomplete-item[data-email="${INVITEE.email}"]`,
  );
  assert.ok(item, 'the autocomplete offered the invitee');
  item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  for (let i = 0; i < 5; i++) await flush();
}

test.afterEach(() => {
  document.body.innerHTML = '';
});

test('the default is a constant of its own, and it is edit', () => {
  assert.equal(DEFAULT_INVITE_PERMISSION, PERMISSIONS.EDIT);
});

test('the invite form opens on edit, named, with the role on the button', () => {
  const { section, select, button } = mount();
  assert.equal(select.value, 'edit');
  assert.ok(
    select.getAttribute('aria-label'),
    'the role select has an accessible name',
  );
  assert.equal(button.textContent, 'Invite as editor');
  section.detach();
});

test('inviting without touching the select gives edit, and the form stays on edit', async () => {
  const { section, posts, select, button } = mount();
  await inviteOne(section, button);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].permission, 'edit');
  assert.equal(select.value, 'edit', 'the reset goes back to the default');
  assert.equal(button.textContent, 'Invite as editor');
  section.detach();
});

test('choosing another level changes the button with it', async () => {
  const { section, posts, select, button } = mount();
  const expected = {
    view: 'Invite as viewer',
    comment: 'Invite as commenter',
    admin: 'Invite as administrator',
    edit: 'Invite as editor',
  };
  for (const [level, label] of Object.entries(expected)) {
    select.value = level;
    select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(button.textContent, label, `button for ${level}`);
  }
  select.value = 'view';
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await inviteOne(section, button);
  assert.equal(posts[0].permission, 'view', 'a deliberate choice is sent');
  assert.equal(
    select.value,
    'edit',
    'and the next invite starts at edit again',
  );
  section.detach();
});
