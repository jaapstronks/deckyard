import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { createSaveManager } =
  await import('../client/views/editor/save-manager.js');
const { createSaveStatus, SAVING_VISIBLE_AFTER_MS } =
  await import('../client/views/editor/save-status.js');

test('autosave failure stays visible through retry and clears only after success', async () => {
  const pres = {
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
  const banner = createSaveStatus();
  document.body.append(banner.el);
  let fail = true;
  let successes = 0;
  const manager = createSaveManager({
    api: async () => {
      if (fail) throw new Error('Network unavailable');
      return { ...pres, revision: 2 };
    },
    toast: {
      info() {},
      error() {},
      success() {
        successes += 1;
      },
    },
    pres,
    id: 'p1',
    SLIDE_TYPES: {
      'text-slide': { fields: [{ key: 'body', type: 'markdown' }] },
    },
    normalizeLang: (lang) => lang,
    getSelectedSlideId: () => 's1',
    onStatusChange: banner.setStatus,
  });

  manager.markDirty();
  assert.equal(banner.el.hidden, true);
  await manager.requestSave();
  assert.equal(banner.el.hidden, false);
  assert.match(banner.el.textContent, /Network unavailable/);
  assert.equal(successes, 0);

  fail = false;
  const retry = manager.requestSave();
  assert.equal(
    banner.el.hidden,
    false,
    'retry in flight does not hide the failure',
  );
  await retry;
  assert.equal(banner.el.hidden, true);
  assert.equal(successes, 1, 'one confirmation for the successful save cycle');
  manager.cancelAutosave();
  banner.el.remove();
});

test('live connection failure remains visible until reconnection', () => {
  const banner = createSaveStatus();
  banner.setStatus('disconnected');
  assert.equal(banner.el.hidden, false);
  assert.match(banner.el.textContent, /Connection lost/);
  banner.setStatus('saved');
  assert.equal(banner.el.hidden, true);
});

test('a save shows as in progress only once it runs long (B645)', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const banner = createSaveStatus();

  banner.setStatus('saving');
  assert.equal(banner.el.hidden, true, 'a quick save stays quiet');
  banner.setStatus('saved');
  t.mock.timers.tick(SAVING_VISIBLE_AFTER_MS);
  assert.equal(banner.el.hidden, true, 'a save that landed never shows');

  banner.setStatus('saving');
  t.mock.timers.tick(SAVING_VISIBLE_AFTER_MS);
  assert.equal(banner.el.hidden, false);
  assert.match(banner.el.textContent, /Saving/);
  assert.equal(banner.el.classList.contains('is-failure'), false);

  banner.setStatus('error', 'Disk full');
  assert.equal(banner.el.classList.contains('is-failure'), true);
  assert.match(banner.el.textContent, /Disk full/);
  banner.setStatus('saving');
  t.mock.timers.tick(SAVING_VISIBLE_AFTER_MS);
  assert.match(banner.el.textContent, /Disk full/, 'the failure stays');

  banner.setStatus('saved');
  assert.equal(banner.el.hidden, true);
  banner.setStatus('saving');
  banner.detach();
  t.mock.timers.tick(SAVING_VISIBLE_AFTER_MS);
  assert.equal(banner.el.hidden, true, 'detach drops the pending wait');
});
