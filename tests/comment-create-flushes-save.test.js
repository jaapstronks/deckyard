/**
 * B567: a comment on a slide added a moment ago is stored, not refused.
 *
 * The service refuses a `slideId` the stored deck does not hold (404
 * `slide_not_found`, D287), and the editor's autosave runs a debounce behind
 * what the user sees. The editor's comments client therefore stores the
 * pending save before every create; this pins that order, and that the panel
 * names the refusal when the deck is still behind (live edits).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { createSaveManager } =
  await import('../client/views/editor/save-manager.js');
const { createCommentsApi } =
  await import('../client/views/editor/comments-api.js');
const { createCommentsPanel } =
  await import('../client/views/editor/comments-panel.js');

function makeDeck() {
  return {
    id: 'p1',
    title: 'Deck',
    revision: 1,
    slides: [{ id: 's1', type: 'text-slide', content: { body: 'A' } }],
    i18n: {
      active: 'nl',
      dominant: 'nl',
      versions: { nl: { title: 'Deck', slides: [] } },
    },
  };
}

function makeManager(pres, api) {
  return createSaveManager({
    api,
    toast: { info() {}, error() {}, success() {} },
    pres,
    id: 'p1',
    SLIDE_TYPES: {
      'text-slide': { fields: [{ key: 'body', type: 'markdown' }] },
    },
    normalizeLang: (lang) => lang,
    getSelectedSlideId: () => 's2',
  });
}

test('the editor stores a just-added slide before the comment POST', async () => {
  const pres = makeDeck();
  const calls = [];
  let stored = pres.slides.map((s) => s.id);
  const api = async (path, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${path}`);
    if (opts.method === 'PUT') {
      stored = opts.body.slides.map((s) => s.id);
      return { ...opts.body, revision: Number(pres.revision) + 1 };
    }
    if (path.endsWith('/comments') && opts.method === 'POST') {
      if (!stored.includes(opts.body.slideId)) {
        throw Object.assign(new Error('Slide not found in this presentation'), {
          code: 'slide_not_found',
          statusCode: 404,
        });
      }
      return { comment: { id: 'c1' } };
    }
    return {};
  };
  const manager = makeManager(pres, api);
  const commentsApi = createCommentsApi({
    api,
    presentationId: 'p1',
    beforeCreate: manager.flush,
  });

  pres.slides.push({ id: 's2', type: 'text-slide', content: { body: 'B' } });
  manager.markDirty({ slideId: 's2' });
  const resp = await commentsApi.createComment({ body: 'hi', slideId: 's2' });

  assert.deepEqual(resp, { comment: { id: 'c1' } });
  assert.deepEqual(calls, [
    'PUT /api/presentations/p1',
    'POST /api/presentations/p1/comments',
  ]);
  assert.equal(manager.isDirty(), false);
  manager.cancelAutosave();
});

test('flush waits for a save already in flight and the edit queued behind it', async () => {
  const pres = makeDeck();
  const puts = [];
  let release;
  const api = async (path, opts = {}) => {
    if (opts.method !== 'PUT') return {};
    puts.push(opts.body.slides.map((s) => s.id).join(','));
    if (puts.length === 1) await new Promise((r) => (release = r));
    return { ...opts.body, revision: Number(pres.revision) + 1 };
  };
  const manager = makeManager(pres, api);

  manager.markDirty({ slideId: 's1' });
  const first = manager.requestSave();
  pres.slides.push({ id: 's2', type: 'text-slide', content: { body: 'B' } });
  manager.markDirty({ slideId: 's2' });

  const flushed = manager.flush();
  release();
  await Promise.all([first, flushed]);

  assert.deepEqual(puts, ['s1', 's1,s2']);
  assert.equal(manager.isDirty(), false);
  manager.cancelAutosave();
});

test('flush returns on a failing save instead of holding the caller', async () => {
  const pres = makeDeck();
  let puts = 0;
  const manager = makeManager(pres, async (path, opts = {}) => {
    if (opts.method === 'PUT') {
      puts += 1;
      throw new Error('Network unavailable');
    }
    return {};
  });

  manager.markDirty({ slideId: 's1' });
  await manager.flush();

  assert.ok(puts >= 1 && puts <= 3, `bounded attempts, got ${puts}`);
  assert.equal(manager.isDirty(), true);
  manager.cancelAutosave();
});

test('the panel names a slide_not_found refusal under the composer', async () => {
  const api = async (path) => {
    if (String(path).includes('/comments/counts')) return { counts: {} };
    if (String(path).includes('/comments'))
      return { comments: [], openCount: 0 };
    return {};
  };
  const toasts = [];
  const commentsApi = {
    ...createCommentsApi({ api, presentationId: 'p1' }),
    createComment: async () => {
      throw Object.assign(new Error('Slide not found in this presentation'), {
        code: 'slide_not_found',
        statusCode: 404,
      });
    },
  };
  const panel = createCommentsPanel({
    api,
    commentsApi,
    toast: { error: (m) => toasts.push(m) },
    presentationId: 'p1',
    pres: { id: 'p1', slides: [{ id: 's1' }] },
    user: { email: 'dev@local.test' },
    getSelectedSlideId: () => 's1',
  });
  document.body.append(panel.panelEl);

  const input = panel.panelEl.querySelector('.comments-input-textarea');
  input.textContent = 'hi';
  const post = [...panel.panelEl.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === 'Post',
  );
  post.click();
  await new Promise((r) => setTimeout(r, 0));

  const refusal = panel.panelEl.querySelector('.inline-error');
  assert.equal(refusal.hidden, false);
  assert.match(refusal.textContent, /not saved yet/);
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  assert.deepEqual(toasts, []);
  panel.destroy?.();
});
