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
 *      written to the slide, and the error travels on to the picker (which
 *      keeps its dialog open on it).
 *   4. With no own media to copy into, the pick goes through unchanged and the
 *      picker is given the sentence that says why.
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

/** The raw ImageKit picker: records how it was opened, replays one pick. */
function fakeImageKitPicker() {
  const state = { opts: null };
  const open = (opts) => {
    state.opts = opts;
  };
  /** Drive the picker's "use this image" button. */
  state.pick = (picked) =>
    state.opts.onPick({
      url: IK_URL,
      fileId: 'ik-file-1',
      altSeed: 'Olive at the whiteboard',
      tags: ['team', 'office'],
      ...picked,
    });
  return { open, state };
}

/**
 * Build a seam with ImageKit as the only provider.
 * @param {Function} [importToOwnMedia]
 */
function seamWithImageKit(importToOwnMedia) {
  const picker = fakeImageKitPicker();
  const seam = createImagePickerSeam({
    root: document.createElement('div'),
    features: {},
    openImageKit: picker.open,
    importImageKitToOwnMedia: importToOwnMedia,
  });
  return { seam, picker };
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

test('a failed copy never reaches the call site, and the error travels on', async () => {
  const { seam, picker } = seamWithImageKit(async () => {
    const err = new Error('Copying this image into your own media failed');
    throw err;
  });

  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  await assert.rejects(
    () => picker.state.pick(),
    /Copying this image into your own media failed/,
    'the picker has to see the refusal to keep its dialog open',
  );
  assert.equal(
    picks.length,
    0,
    'nothing was handed to the call site, so no slide changed',
  );
});

test('a copy that answers no URL is a failure, not a silent external URL', async () => {
  const { seam, picker } = seamWithImageKit(async () => ({}));
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });

  await assert.rejects(() => picker.state.pick());
  assert.equal(picks.length, 0);
});

test('without own media the pick goes through unchanged, and the picker is told why', async () => {
  // IMAGEKIT_ONLY / uploads off: the copy is absent by design, so the ImageKit
  // URL is used exactly as it was before this feature — with a sentence in the
  // picker saying the image stays hosted there.
  const { seam, picker } = seamWithImageKit(undefined);
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });
  await picker.state.pick();

  assert.equal(picks.length, 1);
  assert.equal(picks[0].url, IK_URL);
  assert.equal(picks[0].providerId, 'ik-file-1');
  assert.match(
    picker.state.opts.note,
    /stays hosted on ImageKit/i,
    'the picker is handed the explanation, not left silent',
  );
});

test('with own media the picker gets no note to show', async () => {
  const { seam, picker } = seamWithImageKit(async () => ({ url: OWN_URL }));
  seam({ onPick: () => {} });
  assert.equal(picker.state.opts.note, '');
});

test('an empty pick is still ignored, without calling the copy', async () => {
  let copies = 0;
  const { seam, picker } = seamWithImageKit(async () => {
    copies += 1;
    return { url: OWN_URL };
  });
  const picks = [];
  seam({ onPick: (p) => picks.push(p) });
  await picker.state.pick({ url: '   ' });

  assert.equal(copies, 0);
  assert.equal(picks.length, 0);
});
