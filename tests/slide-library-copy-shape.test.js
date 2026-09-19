/**
 * Copying a library item carries the whole item, whichever way it is copied
 * (D183, B366).
 *
 * "Copy this item to a shelf" existed three times with three payloads: the
 * single push to the team shelf dropped the description, the tags and the
 * language versions; the bulk push dropped the tags and the language versions;
 * the duplicate to the personal shelf dropped only the tags. So the team copy
 * of a multilingual, tagged slide arrived monolingual and untagged.
 *
 * These tests pin the one shape rather than the three fixes: the create body
 * of all three paths is identical but for the shelf in the URL, and the tags
 * follow in the PUT that the junction table requires. A fourth copy action, or
 * a second spelling of one of these three, fails here.
 *
 * Run with: node --test tests/slide-library-copy-shape.test.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const { createSlideLibraryApi } =
  await import('../client/lib/slide-library/api.js');

/** A personal slide with everything an item can carry. */
function richItem() {
  return {
    id: 'src-1',
    name: 'Quarterly numbers',
    description: 'The one with the chart',
    slideType: 'content-slide',
    content: { title: 'Hallo' },
    i18n: {
      versions: {
        nl: { content: { title: 'Hallo' } },
        'en-GB': { content: { title: 'Hello' } },
      },
    },
    themeId: 'house',
    tags: [
      { id: 't1', name: 'finance' },
      { id: 't2', name: 'q3' },
    ],
    revision: 4,
  };
}

/** A minimal state double: the picker's per-shelf cache. */
function fakeState() {
  const cache = { personal: [], organization: [] };
  return {
    getCache: (s) => cache[s],
    setCache: (s, v) => {
      cache[s] = v;
    },
    patchInCache: () => ({ ok: false }),
    isLoading: () => false,
    setLoading: () => {},
  };
}

/**
 * An api() double that records every call and answers the three endpoints the
 * copy path uses.
 */
function fakeApi() {
  const calls = [];
  const api = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method, body });
    if (method === 'GET') return { items: [] };
    if (method === 'POST') return { ...body, id: 'copy-1', revision: 1 };
    if (method === 'PUT') {
      return (body.tags || []).map((name, i) => ({ id: `new-${i}`, name }));
    }
    return {};
  };
  return { api, calls };
}

/** The create call of a copy run, and the tags call that follows it. */
function copyCalls(calls) {
  return {
    create: calls.find((c) => c.method === 'POST'),
    tags: calls.find((c) => c.method === 'PUT'),
  };
}

describe('copying a library item', () => {
  let stub;
  let apiOps;

  beforeEach(() => {
    stub = fakeApi();
    apiOps = createSlideLibraryApi({
      api: stub.api,
      state: fakeState(),
      themeIdNorm: 'fallback-theme',
    });
  });

  it('pushToTeam sends the whole record, then the tags', async () => {
    await apiOps.pushToTeam(richItem());
    const { create, tags } = copyCalls(stub.calls);

    assert.equal(create.path, '/api/slide-library/organization');
    assert.deepEqual(create.body, {
      name: 'Quarterly numbers',
      description: 'The one with the chart',
      slideType: 'content-slide',
      content: { title: 'Hallo' },
      i18n: {
        versions: {
          nl: { content: { title: 'Hallo' } },
          'en-GB': { content: { title: 'Hello' } },
        },
      },
      themeId: 'house',
    });

    assert.equal(tags.path, '/api/slide-library/organization/copy-1/tags');
    assert.deepEqual(tags.body, { tags: ['finance', 'q3'] });
  });

  it('the three copy paths agree on the body — only the shelf differs', async () => {
    const bodies = {};

    await apiOps.pushToTeam(richItem());
    bodies.single = copyCalls(stub.calls).create;

    stub = fakeApi();
    apiOps = createSlideLibraryApi({
      api: stub.api,
      state: fakeState(),
      themeIdNorm: 'fallback-theme',
    });
    await apiOps.pushMultipleToTeam([richItem()]);
    bodies.bulk = copyCalls(stub.calls).create;

    stub = fakeApi();
    apiOps = createSlideLibraryApi({
      api: stub.api,
      state: fakeState(),
      themeIdNorm: 'fallback-theme',
    });
    await apiOps.duplicateToPersonal(richItem());
    bodies.personal = copyCalls(stub.calls).create;

    assert.deepEqual(bodies.bulk.body, bodies.single.body);
    assert.deepEqual(bodies.personal.body, bodies.single.body);

    assert.equal(bodies.single.path, '/api/slide-library/organization');
    assert.equal(bodies.bulk.path, '/api/slide-library/organization');
    assert.equal(bodies.personal.path, '/api/slide-library/personal');
  });

  it('every copy path writes the tags of the item it copied', async () => {
    for (const run of [
      (ops) => ops.pushToTeam(richItem()),
      (ops) => ops.pushMultipleToTeam([richItem()]),
      (ops) => ops.duplicateToPersonal(richItem()),
    ]) {
      const fresh = fakeApi();
      await run(
        createSlideLibraryApi({
          api: fresh.api,
          state: fakeState(),
          themeIdNorm: 'fallback-theme',
        }),
      );
      const { tags } = copyCalls(fresh.calls);
      assert.deepEqual(
        tags?.body,
        { tags: ['finance', 'q3'] },
        'the copy left its tags behind',
      );
    }
  });

  it('an untagged item makes no tags call at all', async () => {
    const item = richItem();
    item.tags = [];
    await apiOps.pushToTeam(item);
    assert.equal(copyCalls(stub.calls).tags, undefined);
  });

  it('falls back to the picker theme when the item has none', async () => {
    const item = richItem();
    item.themeId = '';
    await apiOps.pushToTeam(item);
    assert.equal(copyCalls(stub.calls).create.body.themeId, 'fallback-theme');
  });

  it('a create that fails is reported, and writes no tags', async () => {
    const calls = [];
    const failing = async (path, opts = {}) => {
      calls.push({ path, method: opts.method || 'GET' });
      if ((opts.method || 'GET') === 'POST') throw new Error('nope');
      return {};
    };
    const ops = createSlideLibraryApi({
      api: failing,
      state: fakeState(),
      themeIdNorm: '',
    });
    const r = await ops.duplicateToPersonal(richItem());
    assert.equal(r.ok, false);
    assert.equal(r.error.message, 'nope');
    assert.ok(!calls.some((c) => c.method === 'PUT'));
  });
});
