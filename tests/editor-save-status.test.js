import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { createSaveManager } =
  await import('../client/views/editor/save-manager.js');
const { createSaveStatus } =
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
