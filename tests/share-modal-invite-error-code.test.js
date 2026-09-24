/**
 * The share modal's invite failure branch reads the machine code, not the
 * message.
 *
 * `api()` turns the canonical envelope (`{ ok:false, error:'<code>',
 * message:'<human>' }`) into an Error with `err.code` for branching and
 * `err.message` for display. The collaborators section used to test
 * `message.includes('already_exists')`, which only ever worked because this
 * particular 409 sends no `message` — so `errorText()` fell back to the code
 * itself. The moment the route grows a friendly message the friendly branch
 * dies silently and the user gets a raw code on screen.
 *
 * A refusal of the invite form is a state of that form (B309,
 * docs/reference/feedback-surfaces.md): it shows in the inline error beside
 * the Invite button, never in a toast. The tests read that element.
 *
 * Pinned here, driven through the real `api()` against a stubbed `fetch`:
 *  1. a 409 *with* a human message still shows "already collaborators";
 *  2. a 409 without a message (today's shape) behaves identically;
 *  3. an unrelated failure whose message merely mentions the string does not
 *     get mistaken for it.
 *
 * Run with: node --test tests/share-modal-invite-error-code.test.js
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

const PRESENTATION_ID = 'p1';
const INVITEE = { email: 'sarah@example.com', name: 'Sarah' };

const flush = () => new Promise((r) => setTimeout(r, 0));
/** The autocomplete debounces its search by 300 ms. */
const afterDebounce = () => new Promise((r) => setTimeout(r, 350));

/** JSON response the stubbed `fetch` hands back. */
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

/**
 * Mount the collaborators section with a `fetch` stub, so the invite failure
 * travels the real path: envelope → `api()` → `err.code` → inline refusal.
 * @param {{ status: number, body: object }} inviteFailure
 */
function mount(inviteFailure) {
  const toasts = [];
  globalThis.fetch = async (path, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (path.startsWith('/api/users/search')) {
      return jsonResponse(200, { users: [INVITEE] });
    }
    if (path === `/api/presentations/${PRESENTATION_ID}/collaborators`) {
      if (method === 'POST') {
        return jsonResponse(inviteFailure.status, inviteFailure.body);
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
    toast: {
      // Mirror the real toast's coercion (client/lib/dom/toast.js toText):
      // the canonical call passes the caught Error itself.
      error: (m) =>
        toasts.push({
          level: 'error',
          message: m instanceof Error ? String(m.message || m) : m,
        }),
      success: (message) => toasts.push({ level: 'success', message }),
    },
    isOwner: true,
    modalRoot: document.body,
  });
  document.body.append(section.el);
  return { section, toasts };
}

/** Type a query, pick the single result, then press Invite. */
async function inviteOne(section) {
  const input = section.el.querySelector('.user-autocomplete input');
  input.value = 'sarah';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await afterDebounce();

  const item = section.el.querySelector(
    `.user-autocomplete-item[data-email="${INVITEE.email}"]`,
  );
  assert.ok(item, 'the autocomplete offered the invitee');
  item.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  const addBtn = [...section.el.querySelectorAll('button')].find((b) =>
    b.classList.contains('btn-primary'),
  );
  assert.ok(addBtn, 'the invite button is present');
  addBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await flush();
  await flush();
  await flush();
}

/** The invite form's inline refusal, or null while it is hidden. */
function refusal(section) {
  const el = section.el.querySelector('.inline-error');
  return el && !el.hidden ? el.textContent : null;
}

test.afterEach(() => {
  document.body.innerHTML = '';
});

test('a 409 that carries a friendly message still shows the already-collaborators refusal', async () => {
  const { section, toasts } = mount({
    status: 409,
    body: {
      ok: false,
      error: 'already_exists',
      message: 'Sarah is already a collaborator on this deck',
    },
  });
  await inviteOne(section);
  const message = refusal(section);
  section.detach();

  assert.deepEqual(toasts, [], 'a refusal of the form is not toasted');
  assert.match(message, /already collaborators/i);
  assert.doesNotMatch(
    message,
    /already_exists/,
    'the raw machine code never reaches the user',
  );
});

test('the same 409 without a message behaves identically', async () => {
  const { section, toasts } = mount({
    status: 409,
    body: { ok: false, error: 'already_exists' },
  });
  await inviteOne(section);
  const message = refusal(section);
  section.detach();

  assert.deepEqual(toasts, []);
  assert.match(message, /already collaborators/i);
});

test('an unrelated failure that merely mentions the string is not mistaken for it', async () => {
  const { section, toasts } = mount({
    status: 500,
    body: {
      ok: false,
      error: 'database_error',
      message: 'insert failed: already_exists constraint on collaborators_pkey',
    },
  });
  await inviteOne(section);
  const message = refusal(section);
  section.detach();

  assert.deepEqual(toasts, []);
  assert.match(message, /insert failed/);
  assert.doesNotMatch(
    message,
    /already collaborators/i,
    'the friendly branch belongs to the code, not to the substring',
  );
});

test('a batch that invites nobody names the address beside the button, not in a toast', async () => {
  const { section, toasts } = mount({
    status: 201,
    body: {
      results: [{ email: INVITEE.email, ok: false, reason: 'user_not_found' }],
      summary: { total: 1, successful: 0, failed: 1 },
    },
  });
  await inviteOne(section);
  const message = refusal(section);
  section.detach();

  assert.deepEqual(toasts, []);
  assert.match(message, /0 of 1 invitations sent/);
  assert.match(message, new RegExp(INVITEE.email));
});
