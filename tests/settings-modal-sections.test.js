/**
 * Deck settings modal: renders every section and normalizes each settings
 * slice. Guards the section-per-module split (client/views/editor/modals/
 * settings-modal/) — each builder owns its own normalization + DOM + handlers,
 * and openSettingsModal only assembles them. With api:null the theme/tags
 * panels take their "unavailable" branch and no network is touched.
 *
 * Run with: node --test tests/settings-modal-sections.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app/test-id',
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
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame || clearTimeout;

const { h } = await import('../client/lib/dom.js');
const { openSettingsModal } = await import(
  '../client/views/editor/modals/settings-modal.js'
);

function messyPres() {
  return {
    id: 'p1',
    themeId: 'deckyard',
    lang: 'zz-bad',
    description: 42, // non-string → normalized to ''
    settings: {
      transitions: { preset: 'garbage' },
      autoAdvance: { intervalSeconds: '17', mode: 'pacing' },
      liveVideo: { enabled: true, streamUrl: 'https://youtu.be/x' },
    },
    slides: [{}, {}, {}],
    tags: ['a', { name: 'b' }],
  };
}

test('modal assembles all sections and normalizes each slice', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const pres = messyPres();
  let dirty = 0;
  let saved = 0;

  openSettingsModal({
    h,
    root,
    pres,
    api: null,
    openOverlayClosers: new Set(),
    markDirty: () => dirty++,
    requestSave: () => saved++,
  });

  // Grid holds exactly the 11 compact sections, in order.
  const grid = document.querySelector('.settings-modal-grid');
  assert.ok(grid, 'settings grid rendered');
  assert.equal(grid.children.length, 11, 'eleven grid sections');

  // Full-width tags + description sections mounted after the grid.
  assert.ok(document.querySelector('textarea.form-input'), 'description textarea');

  // Normalization ran per slice.
  assert.equal(pres.lang, 'nl', 'invalid lang → nl');
  assert.equal(pres.settings.transitions.preset, 'none', 'invalid preset → none');
  assert.equal(pres.settings.autoAdvance.intervalSeconds, 17, 'interval coerced to number');
  assert.equal(pres.description, '', 'non-string description → empty');
  assert.equal(pres.settings.qaEnabled === false, false, 'qa defaults on');

  // A change handler wires through to markDirty/requestSave.
  const cb = document.querySelector('.settings-modal-grid input[type="checkbox"]');
  assert.ok(cb, 'a checkbox exists');
  cb.checked = !cb.checked;
  cb.dispatchEvent(new Event('change', { bubbles: true }));
  assert.ok(dirty >= 1, 'markDirty called on change');
});

test('theme and tags show unavailable branch without an api', () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  openSettingsModal({
    h,
    root,
    pres: messyPres(),
    api: null,
    openOverlayClosers: new Set(),
    markDirty: () => {},
    requestSave: () => {},
  });
  const text = root.textContent;
  assert.match(text, /Theme selection is not available/);
  assert.match(text, /Tags are not available/);
});
