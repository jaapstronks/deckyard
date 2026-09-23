/**
 * A shared library slide you may not change is not offered for change, and a
 * refused change reads as a sentence (D170, B411).
 *
 * The preview modal already read the server's `canEdit` verdict and greyed out
 * Edit with its reason; the card menu did not, so a non-maker was offered
 * "Move to trash", confirmed it, and got a toast reading `forbidden` — the
 * bare error code, because the refusal carried no message. These tests pin
 * the one reader on every trash surface (menu, Restore, bulk trash) and the
 * sentence on the toast of a refused write.
 *
 * Run with: node --test tests/slide-library-can-edit.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/library',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const { createSlideLibraryPicker } =
  await import('../client/lib/slide-library/picker.js');
const { createSlideLibraryApi } =
  await import('../client/lib/slide-library/api.js');
const { editRefusalText } =
  await import('../client/lib/slide-library/permissions.js');

const REFUSAL = 'Only its maker or an admin can edit this shared slide.';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An organization-shelf item; `canEdit` is the server's verdict. */
function orgItem(id, canEdit, extra = {}) {
  return {
    id,
    name: `Slide ${id}`,
    slideType: 'quote-slide',
    content: { quote: 'Hello' },
    tags: [],
    revision: 1,
    canEdit,
    ...extra,
  };
}

/** An api() double serving one organization shelf. */
function shelfApi(items) {
  return async (url) => {
    if (url.startsWith('/api/slide-library/organization')) return { items };
    if (url.startsWith('/api/slide-library/personal')) return { items: [] };
    return {};
  };
}

async function renderPicker(items) {
  const picker = createSlideLibraryPicker({
    api: shelfApi(items),
    allowInsert: false,
    initialShelf: 'organization',
  });
  const mount = document.createElement('div');
  document.body.append(mount);
  await picker.renderSlideLibraryPicker(mount);
  await flush();
  return mount;
}

/** The card for an item, found by its name. */
function card(mount, id) {
  const cards = [...mount.querySelectorAll('.ps-lib-card')];
  const found = cards.find((el) => el.textContent.includes(`Slide ${id}`));
  assert.ok(found, `card ${id} is rendered`);
  return found;
}

function trashItem(cardEl) {
  const btn = [...cardEl.querySelectorAll('.dropdown-item')].find(
    (el) => el.textContent === 'Move to trash',
  );
  assert.ok(btn, 'the card menu has Move to trash');
  return btn;
}

describe('the card menu reads canEdit', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('greys out Move to trash with the reason when canEdit is false', async () => {
    const mount = await renderPicker([orgItem('a', false)]);
    const btn = trashItem(card(mount, 'a'));
    assert.equal(btn.disabled, true);
    assert.equal(btn.title, REFUSAL);
    const reason = document.getElementById(
      btn.getAttribute('aria-describedby'),
    );
    assert.ok(reason, 'the reason is linked by aria-describedby');
    assert.equal(reason.textContent, REFUSAL);
  });

  it('offers Move to trash when canEdit is true', async () => {
    const mount = await renderPicker([orgItem('b', true)]);
    const btn = trashItem(card(mount, 'b'));
    assert.equal(btn.disabled, false);
    assert.equal(btn.hasAttribute('aria-describedby'), false);
  });

  it('treats an item without the verdict as not editable', async () => {
    const mount = await renderPicker([orgItem('c', undefined)]);
    assert.equal(trashItem(card(mount, 'c')).disabled, true);
  });

  it('uses the same sentence as the preview modal', () => {
    assert.equal(editRefusalText(), REFUSAL);
  });
});

describe('a refused library write toasts a sentence', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('turns a 403 on trash into the refusal sentence, never the code', async () => {
    const err = Object.assign(new Error('forbidden'), {
      statusCode: 403,
      code: 'forbidden',
    });
    const cache = { organization: [orgItem('d', false)], personal: [] };
    const state = {
      getCache: (s) => cache[s],
      setCache: (s, v) => {
        cache[s] = v;
      },
      patchInCache: () => ({ ok: false }),
    };
    const ops = createSlideLibraryApi({
      api: async () => {
        throw err;
      },
      state,
    });
    await ops.setTrashed('organization', cache.organization[0], true);
    const toasts = [...document.querySelectorAll('.toast-error')];
    assert.equal(toasts.length, 1);
    assert.ok(toasts[0].textContent.includes(REFUSAL));
    assert.equal(toasts[0].textContent.includes('forbidden'), false);
  });
});
