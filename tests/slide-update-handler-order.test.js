/**
 * B739: a colleague's remote save is merged into the open editor in the
 * server's slide order. Before, a remote slide the tab didn't know yet was
 * appended, so slides pasted halfway through the deck showed up at the
 * bottom until a refresh.
 *
 * Run with: node --test tests/slide-update-handler-order.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { mergeRemoteSlides } from '../client/views/editor/slide-update-handler.js';

const slide = (id, title = id) => ({ id, type: 'title', content: { title } });
const ids = (slides) => slides.map((s) => s.id);

describe('mergeRemoteSlides (B739)', () => {
  const local = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => slide(id));
  // The colleague pasted p1 and p2 after b; the save event names only the
  // slides the save-manager marked, which need not include every new one.
  const remote = ['a', 'b', 'p1', 'p2', 'c', 'd', 'e', 'f'].map((id) =>
    slide(id),
  );

  it('places a remote insert halfway at its server position', () => {
    const { slides } = mergeRemoteSlides(local, remote, {
      modifiedIds: ['p1'],
    });
    assert.deepStrictEqual(ids(slides), [
      'a',
      'b',
      'p1',
      'p2',
      'c',
      'd',
      'e',
      'f',
    ]);
  });

  it('places it there too when the event names no slides', () => {
    const { slides } = mergeRemoteSlides(local, remote, { modifiedIds: [] });
    assert.deepStrictEqual(ids(slides), ids(remote));
  });

  it('keeps the locked slide local, at its server position', () => {
    const lockedLocal = [...local];
    lockedLocal[2] = slide('c', 'my unsaved edit');
    const remoteWithC = remote.map((s) =>
      s.id === 'c' ? slide('c', 'their version') : s,
    );
    for (const modifiedIds of [[], ['c', 'p1']]) {
      const { slides, adoptedIds } = mergeRemoteSlides(
        lockedLocal,
        remoteWithC,
        { lockedSlideId: 'c', modifiedIds },
      );
      assert.deepStrictEqual(ids(slides), ids(remote));
      assert.strictEqual(slides[4].content.title, 'my unsaved edit');
      assert.strictEqual(adoptedIds.has('c'), false);
    }
  });

  it('follows a remote reorder and keeps untouched slides local', () => {
    const localWithEdit = local.map((s) =>
      s.id === 'e' ? slide('e', 'pending local edit') : s,
    );
    const reordered = ['f', 'a', 'b', 'c', 'd', 'e'].map((id) =>
      id === 'a' ? slide('a', 'their edit') : slide(id),
    );
    const { slides, adoptedIds } = mergeRemoteSlides(localWithEdit, reordered, {
      modifiedIds: ['a'],
    });
    assert.deepStrictEqual(ids(slides), ['f', 'a', 'b', 'c', 'd', 'e']);
    assert.strictEqual(slides[1].content.title, 'their edit');
    assert.strictEqual(slides[5].content.title, 'pending local edit');
    assert.deepStrictEqual([...adoptedIds], ['a']);
  });

  it('drops slides the server no longer has', () => {
    const { slides } = mergeRemoteSlides(
      local,
      ['a', 'c', 'e'].map((id) => slide(id)),
      { modifiedIds: ['a'] },
    );
    assert.deepStrictEqual(ids(slides), ['a', 'c', 'e']);
  });
});
