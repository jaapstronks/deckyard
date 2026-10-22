/**
 * Slide collections client API: the addSlide append/dedup contract, the
 * paged read of both shelves (B822) and a collection's own slides. Uses a
 * stub `api` so no server is needed.
 *
 * Run with: node --test tests/slide-collections-client-api.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createCollectionsApi } from '../client/views/list/collections/api.js';

/** Build a stub api() that records calls and returns queued responses. */
function makeStubApi(handler) {
  const calls = [];
  const api = async (path, init) => {
    calls.push({
      path,
      method: init?.method || 'GET',
      body: init?.body,
    });
    return handler(path, init);
  };
  return { api, calls };
}

describe('createCollectionsApi.addSlide', () => {
  it('appends a new id and PATCHes the full ordered membership', async () => {
    const { api, calls } = makeStubApi((path, init) => {
      if (init?.method === 'PATCH') {
        const body = init.body;
        return { id: 'c1', shelf: 'personal', slideIds: body.slideIds };
      }
      return {};
    });
    const collectionsApi = createCollectionsApi({ api });
    const collection = { id: 'c1', shelf: 'personal', slideIds: ['a', 'b'] };

    const { collection: updated, added } = await collectionsApi.addSlide(
      collection,
      'c',
    );
    assert.strictEqual(added, true);
    assert.deepStrictEqual(updated.slideIds, ['a', 'b', 'c']);

    const patch = calls.find((c) => c.method === 'PATCH');
    assert.strictEqual(patch.path, '/api/slide-collections/personal/c1');
    assert.deepStrictEqual(patch.body.slideIds, ['a', 'b', 'c']);
  });

  it('is a no-op when the slide is already a member (no PATCH)', async () => {
    const { api, calls } = makeStubApi(() => ({}));
    const collectionsApi = createCollectionsApi({ api });
    const collection = {
      id: 'c1',
      shelf: 'organization',
      slideIds: ['a', 'b'],
    };

    const { added } = await collectionsApi.addSlide(collection, 'a');
    assert.strictEqual(added, false);
    assert.strictEqual(
      calls.some((c) => c.method === 'PATCH'),
      false,
    );
  });
});

describe('createCollectionsApi.listFirstPages', () => {
  it('fetches the first page of both shelves and returns them keyed', async () => {
    const { api } = makeStubApi((path) => {
      if (path === '/api/slide-collections/personal')
        return { items: [{ id: 'p1' }], nextCursor: 'pc' };
      if (path === '/api/slide-collections/organization')
        return { items: [{ id: 'o1' }], nextCursor: null };
      return { items: [], nextCursor: null };
    });
    const collectionsApi = createCollectionsApi({ api });
    const { personal, organization } = await collectionsApi.listFirstPages();
    assert.deepEqual(
      personal.map((c) => c.id),
      ['p1'],
    );
    assert.deepEqual(
      organization.map((c) => c.id),
      ['o1'],
    );
  });
});

describe('createCollectionsApi.listPage', () => {
  it('pages both shelves with a pair of cursors until both are done (B822)', async () => {
    const pages = {
      '/api/slide-collections/personal': {
        items: [{ id: 'p1' }],
        nextCursor: 'p-next',
      },
      '/api/slide-collections/personal?cursor=p-next': {
        items: [{ id: 'p2' }],
        nextCursor: null,
      },
      '/api/slide-collections/organization': {
        items: [{ id: 'o1' }],
        nextCursor: null,
      },
    };
    const { api, calls } = makeStubApi((path) => pages[path]);
    const collectionsApi = createCollectionsApi({ api });

    const first = await collectionsApi.listPage(null);
    assert.deepEqual(
      first.items.map((c) => c.id),
      ['p1', 'o1'],
    );
    assert.ok(first.nextCursor, 'the personal shelf has more');

    const second = await collectionsApi.listPage(first.nextCursor);
    assert.deepEqual(
      second.items.map((c) => c.id),
      ['p2'],
    );
    assert.equal(second.nextCursor, null, 'both shelves are done');
    // The finished organization shelf is not asked again.
    assert.deepEqual(
      calls.map((c) => c.path),
      [
        '/api/slide-collections/personal',
        '/api/slide-collections/organization',
        '/api/slide-collections/personal?cursor=p-next',
      ],
    );
  });
});

describe('createCollectionsApi.listSlides', () => {
  it("reads one collection's slides from its own endpoint", async () => {
    const { api, calls } = makeStubApi(() => ({ items: [{ id: 's1' }] }));
    const collectionsApi = createCollectionsApi({ api });
    const slides = await collectionsApi.listSlides({
      id: 'c1',
      shelf: 'organization',
    });
    assert.deepEqual(
      slides.map((it) => it.id),
      ['s1'],
    );
    assert.equal(
      calls[0].path,
      '/api/slide-collections/organization/c1/slides',
    );
  });
});
