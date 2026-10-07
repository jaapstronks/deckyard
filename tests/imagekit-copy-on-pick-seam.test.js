/**
 * B327 / D162 — the copy sits in the ImageKit adapter, so every call site gets it.
 *
 * The client half of copy-on-pick. The decision it encodes is that a picked DAM
 * image reaches a slide only as own media: the copy runs inside the ImageKit
 * adapter of the picker seam, *before* `opts.onPick`, so the side-form fields,
 * the collection images and the inline WYSIWYG popover inherit it without
 * knowing it happens — the same reason the seam exists at all (a new call site
 * could not forget ImageKit; it now also cannot forget the copy).
 *
 * Four things are pinned:
 *
 *   1. The call site is handed the *own* URL, never the ImageKit one.
 *   2. Everything else about the pick survives the copy: the alt seed, the tags
 *      and the ImageKit file id as provenance. The id staying is deliberate —
 *      it says where the image came from; it is no longer a live image source.
 *   3. A refused or failed copy never reaches `opts.onPick`, so nothing is
 *      written to the slide; the seam shows the refusal in its own dialog,
 *      keeps that dialog open and answers the panel `{ ok: false, error }`.
 *   4. Without own media, the adapter refuses the pick and explains why.
 *
 * B410 adds the half that held only in prose: the dialog is the seam's, not
 * the panel's. A panel that fires `onPick` and forgets it (the external
 * picker a fork put in this slot did exactly that, then closed) cannot close
 * on a refused copy or leave the refusal unseen, because it never had the
 * close and the message is placed by the seam when the panel does not.
 *
 * Run with: node --test tests/imagekit-copy-on-pick-seam.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const { createImagePickerSeam } =
  await import('../client/views/editor/media/picker-provider.js');

const IK_URL = 'https://ik.imagekit.io/test/team/olive.jpg';
const OWN_URL = '/uploads/olive-2f9a.jpg';

/**
 * A DAM panel: records how it was mounted, replays one pick. `placeRefusal`
 * false is the panel that ignores the seam's message element.
 */
function fakeImageKitPanel({ placeRefusal = true } = {}) {
  const state = { opts: null, detached: 0 };
  const create = (opts) => {
    state.opts = opts;
    const el = document.createElement('div');
    el.className = 'fake-dam-panel';
    if (placeRefusal) el.append(opts.refusal);
    return { el, detach: () => (state.detached += 1) };
  };
  /** Drive the panel's "use this image" button. */
  state.pick = (picked) =>
    state.opts.onPick({
      url: IK_URL,
      fileId: 'ik-file-1',
      altSeed: 'Olive at the whiteboard',
      tags: ['team', 'office'],
      ...picked,
    });
  return { create, state };
}

/**
 * Build a seam with ImageKit as the only provider.
 * @param {Function} [importToOwnMedia]
 * @param {Object} [panelOpts]
 */
function seamWithImageKit(importToOwnMedia, panelOpts) {
  const picker = fakeImageKitPanel(panelOpts);
  const root = document.createElement('div');
  document.body.append(root);
  const seam = createImagePickerSeam({
    root,
    features: {},
    createImageKitPanel: picker.create,
    importImageKitToOwnMedia: importToOwnMedia,
  });
  return { seam, picker, root };
}

/** The seam's dialog, while it is open. */
const dialogIn = (root) => root.querySelector('.imagekit-modal');

/** The refusal the seam shows, or null while it shows none. */
function shownRefusal(root) {
  const el = root.querySelector('.imagekit-modal .inline-error');
  return el && !el.hidden ? el.textContent : null;
}

test('the call site receives the copied URL, not the ImageKit one', async () => {
  const imported = [];
  const { seam, picker } = seamWithImageKit(async (arg) => {
    imported.push(arg);
    return { url: OWN_URL };
  });

  const picks = [];
  seam({ onPick: (p) => picks.push(p) });
  await picker.state.pick();

  assert.equal(imported.length, 1, 'the copy ran');
  assert.deepEqual(imported[0], { fileId: 'ik-file-1', url: IK_URL });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].url, OWN_URL);
});

test('alt seed, tags and provenance survive the copy', async () => {
  const { seam, picker } = seamWithImageKit(async () => ({ url: OWN_URL }));
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });
  await picker.state.pick();

  assert.equal(picks[0].alt, 'Olive at the whiteboard');
  assert.deepEqual(picks[0].tags, ['team', 'office']);
  assert.equal(
    picks[0].providerId,
    'ik-file-1',
    'the file id stays as provenance — it is not a second live source',
  );
});

test('the copy happens before the call site is told anything', async () => {
  const order = [];
  const { seam, picker } = seamWithImageKit(async () => {
    order.push('copy');
    return { url: OWN_URL };
  });
  seam({ onPick: () => order.push('onPick') });
  await picker.state.pick();

  assert.deepEqual(order, ['copy', 'onPick']);
});

// B412: the refusal the picker shows is our sentence, never the server's
// message (which once carried ImageKit's raw JSON into the callout).
const COPY_FAILED =
  'This image could not be copied into your own media. Try again or choose another image.';

const failingCopy = async () => {
  const err = new Error(
    '{"message":"The requested file does not exist.","help":"…"}',
  );
  err.code = 'import_failed';
  throw err;
};

test('a failed copy never reaches the call site; the dialog stays open and says why', async () => {
  const { seam, picker, root } = seamWithImageKit(failingCopy);

  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  const outcome = await picker.state.pick();
  assert.deepEqual(outcome, { ok: false, error: COPY_FAILED });
  assert.equal(
    picks.length,
    0,
    'nothing was handed to the call site, so no slide changed',
  );
  assert.ok(dialogIn(root), 'the dialog is still open');
  assert.equal(shownRefusal(root), COPY_FAILED);
  assert.ok(
    root
      .querySelector('.fake-dam-panel')
      .contains(root.querySelector('.inline-error')),
    'the refusal sits where the panel placed it',
  );
  root.remove();
});

test('a copy that answers no URL is a failure, not a silent external URL', async () => {
  const { seam, picker, root } = seamWithImageKit(async () => ({}));
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  assert.deepEqual(await picker.state.pick(), {
    ok: false,
    error: COPY_FAILED,
  });
  assert.equal(picks.length, 0);
  root.remove();
});

test('without own media the pick is refused without mutating the slide', async () => {
  const { seam, picker, root } = seamWithImageKit(undefined);
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  assert.match(
    picker.state.opts.note,
    /cannot be used.*uploads to be enabled/i,
  );
  assert.deepEqual(await picker.state.pick(), {
    ok: false,
    error: picker.state.opts.note,
  });
  assert.equal(picks.length, 0);
  assert.equal(shownRefusal(root), picker.state.opts.note);
  root.remove();
});

test('with own media the picker gets no note to show', async () => {
  const { seam, picker, root } = seamWithImageKit(async () => ({
    url: OWN_URL,
  }));
  seam({ onPick: () => {} });
  assert.equal(picker.state.opts.note, '');
  root.remove();
});

test('an empty pick is refused without calling the copy', async () => {
  let copies = 0;
  const { seam, picker, root } = seamWithImageKit(async () => {
    copies += 1;
    return { url: OWN_URL };
  });
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });
  const outcome = await picker.state.pick({ url: '   ' });

  assert.equal(outcome.ok, false);
  assert.equal(copies, 0);
  assert.equal(picks.length, 0);
  assert.ok(dialogIn(root));
  root.remove();
});

// --- B410: the dialog is the seam's ---------------------------------------

test('a successful copy closes the dialog and detaches the panel', async () => {
  const { seam, picker, root } = seamWithImageKit(async () => ({
    url: OWN_URL,
  }));
  seam({ onPick: () => {} });
  assert.ok(dialogIn(root));

  assert.deepEqual(await picker.state.pick(), { ok: true });
  assert.equal(dialogIn(root), null);
  assert.equal(picker.state.detached, 1);
  root.remove();
});

test('a panel that does not await onPick still cannot close on a refused copy or hide it', async () => {
  // The negative case: an external picker that fires the pick and forgets it,
  // and never places the refusal element it was handed.
  const { seam, picker, root } = seamWithImageKit(failingCopy, {
    placeRefusal: false,
  });
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  const pending = picker.state.pick(); // fire-and-forget
  picker.state.opts.cancel(); // and "close", as the fork did
  assert.ok(dialogIn(root), 'no close while the copy runs');

  await pending;
  assert.ok(dialogIn(root), 'still open after the refusal');
  assert.equal(picks.length, 0, 'the slide did not change');
  assert.equal(
    shownRefusal(root),
    COPY_FAILED,
    'the seam placed the refusal itself, above the panel',
  );
  assert.equal(
    root.querySelector('.fake-dam-panel').previousElementSibling,
    root.querySelector('.inline-error'),
  );
  root.remove();
});

test('a second pick while a copy runs is ignored, not a second copy', async () => {
  let copies = 0;
  let release;
  const { seam, picker, root } = seamWithImageKit(() => {
    copies += 1;
    return new Promise((resolve) => {
      release = () => resolve({ url: OWN_URL });
    });
  });
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  const first = picker.state.pick();
  assert.equal((await picker.state.pick()).ok, false);
  release();
  assert.deepEqual(await first, { ok: true });
  assert.equal(copies, 1);
  assert.equal(picks.length, 1);
  root.remove();
});

test('a refused copy can be retried in the same dialog', async () => {
  let attempt = 0;
  const { seam, picker, root } = seamWithImageKit(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('nope');
    return { url: OWN_URL };
  });
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  assert.equal((await picker.state.pick()).ok, false);
  assert.equal(shownRefusal(root), COPY_FAILED);
  assert.deepEqual(await picker.state.pick(), { ok: true });
  assert.equal(picks.length, 1);
  assert.equal(dialogIn(root), null);
  root.remove();
});

test('the dialog title follows a relabelled provider', () => {
  const { seam, root } = seamWithImageKit(async () => ({ url: OWN_URL }));
  seam.providers[0].label = 'CIIIC Beeldbank';
  seam({ onPick: () => {} });
  assert.equal(
    dialogIn(root).querySelector('h2')?.textContent,
    'CIIIC Beeldbank',
  );
  root.remove();
});

test('the retired opener slot is refused, not silently dropped', () => {
  assert.throws(
    () =>
      createImagePickerSeam({
        root: document.createElement('div'),
        openImageKit: () => {},
      }),
    /openImageKit was replaced by createImageKitPanel/,
  );
});

test('a slot that returns no panel element is refused', () => {
  const root = document.createElement('div');
  const seam = createImagePickerSeam({
    root,
    createImageKitPanel: () => undefined,
    importImageKitToOwnMedia: async () => ({ url: OWN_URL }),
  });
  assert.throws(() => seam({ onPick: () => {} }), /panel factory/);
});
