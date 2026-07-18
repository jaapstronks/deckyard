/**
 * Slide collections client API: the addSlide append/dedup contract and the
 * listAll fan-out. Uses a stub `api` so no server is needed.
 *
 * Run with: node --test tests/slide-collections-client-api.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { createCollectionsApi } from '../client/lib/slide-collections/api.js';

/** Build a stub api() that records calls and returns queued responses. */
function makeStubApi(handler) {
  const calls = [];
  const api = async (path, init) => {
    calls.push({ path, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    return handler(path, init);
  };
  return { api, calls };
}

describe('createCollectionsApi.addSlide', () => {
  it('appends a new id and PATCHes the full ordered membership', async () => {
    const { api, calls } = makeStubApi((path, init) => {
      if (init?.method === 'PATCH') {
        const body = JSON.parse(init.body);
        return { id: 'c1', scope: 'personal', slideIds: body.slideIds };
      }
      return {};
    });
    const collectionsApi = createCollectionsApi({ api });
    const collection = { id: 'c1', scope: 'personal', slideIds: ['a', 'b'] };

    const { collection: updated, added } = await collectionsApi.addSlide(collection, 'c');
    assert.strictEqual(added, true);
    assert.deepStrictEqual(updated.slideIds, ['a', 'b', 'c']);

    const patch = calls.find((c) => c.method === 'PATCH');
    assert.strictEqual(patch.path, '/api/slide-collections/personal/c1');
    assert.deepStrictEqual(patch.body.slideIds, ['a', 'b', 'c']);
  });

  it('is a no-op when the slide is already a member (no PATCH)', async () => {
    const { api, calls } = makeStubApi(() => ({}));
    const collectionsApi = createCollectionsApi({ api });
    const collection = { id: 'c1', scope: 'team', slideIds: ['a', 'b'] };

    const { added } = await collectionsApi.addSlide(collection, 'a');
    assert.strictEqual(added, false);
    assert.strictEqual(calls.some((c) => c.method === 'PATCH'), false);
  });
});

describe('createCollectionsApi.listAll', () => {
  it('fetches both scopes and returns them keyed', async () => {
    const { api } = makeStubApi((path) => {
      if (path === '/api/slide-collections/personal') return { items: [{ id: 'p1' }] };
      if (path === '/api/slide-collections/team') return { items: [{ id: 't1' }] };
      return { items: [] };
    });
    const collectionsApi = createCollectionsApi({ api });
    const { personal, team } = await collectionsApi.listAll();
    assert.deepStrictEqual(personal.map((c) => c.id), ['p1']);
    assert.deepStrictEqual(team.map((c) => c.id), ['t1']);
  });
});
