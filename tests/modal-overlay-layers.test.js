/**
 * The two modal layers (A7.16 cluster 1, M1) and their gate.
 *
 * `client/lib/dom/modal.js` is split into a behaviour layer — `createOverlay`:
 * backdrop, focus trap, Escape, `aria-modal`, focus restore, busy/dirty close
 * guarding, closers registration — and the dialog chrome on top —
 * `createModal`: header with title + close button (`closeButton:
 * 'text'|'icon'|false`), optional/custom header (`header: false|node`), hint,
 * content area. This file pins:
 *
 *   1. the default `createModal` DOM shape (the 70+ existing importers rely on
 *      it byte-for-byte; the M1 PR carried a jsdom outerHTML diff against the
 *      pre-split module),
 *   2. the behaviour contract of `createOverlay` (aria, Escape, backdrop
 *      click, busy, focus restore, closers),
 *   3. the new `createModal` options,
 *   4. the ESLint gate: the five hand-rolled overlay class names are
 *      restricted outside modal.js and the burndown allowlist, and the
 *      allowlist block keeps every *other* client restriction in force
 *      (flat-config rule entries replace per rule name — see the
 *      clientRestrictedSyntax comment in eslint.config.js).
 *
 * Run with: node --test tests/modal-overlay-layers.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

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
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.MouseEvent = dom.window.MouseEvent;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame || clearTimeout;

const { h } = await import('../client/lib/dom.js');
const { createOverlay, createModal } =
  await import('../client/lib/dom/modal.js');

const pressEscape = () =>
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
const clickBackdrop = (backdrop) =>
  backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const tick = () => new Promise((r) => setTimeout(r, 0));

// ── createOverlay: the behaviour layer ─────────────────────────────────────

test('createOverlay applies dialog aria to the surface and traps inside the backdrop', () => {
  const surface = h('div', { class: 'my-lightbox' });
  const overlay = createOverlay(h, { surface });
  overlay.show(document.body);

  assert.equal(surface.getAttribute('role'), 'dialog');
  assert.equal(surface.getAttribute('aria-modal'), 'true');
  assert.equal(surface.parentNode, overlay.backdrop);
  assert.equal(overlay.backdrop.parentNode, document.body);
  assert.equal(overlay.backdrop.className, 'modal-backdrop');
  assert.equal(overlay.isOpen(), true);

  overlay.close();
  assert.equal(overlay.backdrop.parentNode, null);
  assert.equal(overlay.isOpen(), false);
});

test('createOverlay leaves caller-set role/aria alone (idempotent defaults)', () => {
  const surface = h('div', { role: 'alertdialog', 'aria-modal': 'true' });
  const overlay = createOverlay(h, { surface });
  overlay.show(document.body);
  assert.equal(surface.getAttribute('role'), 'alertdialog');
  overlay.close();
});

test('createOverlay honours a custom backdrop class', () => {
  const overlay = createOverlay(h, { backdropClass: 'modal-backdrop peek' });
  overlay.show(document.body);
  assert.equal(overlay.backdrop.className, 'modal-backdrop peek');
  overlay.close();
});

test('createOverlay closes on Escape and on backdrop click', async () => {
  let closes = 0;
  const overlay = createOverlay(h, { onClose: () => closes++ });
  overlay.show(document.body);
  pressEscape();
  await tick();
  assert.equal(closes, 1);

  const second = createOverlay(h, { onClose: () => closes++ });
  second.show(document.body);
  clickBackdrop(second.backdrop);
  await tick();
  assert.equal(closes, 2);
});

test('createOverlay busy state blocks Escape/backdrop/requestClose but not close()', async () => {
  let closed = false;
  const overlay = createOverlay(h, { onClose: () => (closed = true) });
  overlay.show(document.body);
  overlay.setBusy(true);
  assert.equal(overlay.isBusy(), true);

  pressEscape();
  clickBackdrop(overlay.backdrop);
  await overlay.requestClose();
  assert.equal(closed, false);

  overlay.close();
  assert.equal(closed, true);
});

test('createOverlay registers in overlayClosers and deregisters on close', () => {
  const closers = new Set();
  const overlay = createOverlay(h, {});
  overlay.show(document.body, closers);
  assert.equal(closers.size, 1);
  overlay.close();
  assert.equal(closers.size, 0);
});

test('createOverlay restores focus to the previously focused element', () => {
  const button = h('button', { text: 'before' });
  document.body.append(button);
  button.focus();
  assert.equal(document.activeElement, button);

  const overlay = createOverlay(h, {});
  overlay.show(document.body);
  overlay.close();
  assert.equal(document.activeElement, button);
  button.remove();
});

test('createOverlay dirty check routes requestClose through the confirm dialog', async () => {
  let closed = false;
  const overlay = createOverlay(h, {
    isDirty: () => true,
    confirmMessage: 'Lose your edits?',
    onClose: () => (closed = true),
  });
  overlay.show(document.body);

  // Keep editing: the overlay stays open.
  let pending = overlay.requestClose();
  await tick();
  let confirm = document.querySelectorAll('.modal-backdrop')[1];
  assert.ok(confirm, 'confirm dialog should open');
  confirm.querySelector('.modal-actions .btn-secondary').click();
  await pending;
  assert.equal(closed, false);

  // Discard: the overlay closes.
  pending = overlay.requestClose();
  await tick();
  confirm = document.querySelectorAll('.modal-backdrop')[1];
  confirm.querySelector('.modal-actions .btn-danger').click();
  await pending;
  assert.equal(closed, true);
});

// ── createModal: the chrome layer ──────────────────────────────────────────

test('createModal default DOM shape is the pre-split shape', () => {
  const api = createModal(h, {
    title: 'Share deck',
    hint: 'Anyone with the link can view.',
    modalClass: 'share-modal',
  });
  api.append(h('button', { class: 'btn btn-primary', text: 'Copy link' }));
  api.show(document.body);

  const html = api.backdrop.outerHTML.replace(
    /modal-\d+-[a-z0-9]+/g,
    'modal-X',
  );
  assert.equal(
    html,
    '<div class="modal-backdrop">' +
      '<div class="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="modal-X-title">' +
      '<div class="row spread"><h2 id="modal-X-title">Share deck</h2>' +
      '<button class="btn btn-secondary">Close</button></div>' +
      '<div class="help modal-hint">Anyone with the link can view.</div>' +
      '<div class="modal-content"><button class="btn btn-primary">Copy link</button></div>' +
      '</div></div>',
  );
  api.close();
});

test('createModal closeButton:"icon" renders the icon-X close affordance', () => {
  const api = createModal(h, { title: 'Library', closeButton: 'icon' });
  api.show(document.body);

  const btn = api.closeBtn;
  assert.equal(btn.className, 'btn btn-secondary btn-icon ps-modal-close');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(btn.getAttribute('aria-label'), 'Close');
  assert.ok(btn.querySelector('span.icon'), 'holds an icon() span');
  assert.equal(btn.textContent.trim(), '');

  btn.click();
  assert.equal(api.backdrop.parentNode, null);
});

test('createModal closeButton:false renders a header without a close button', () => {
  const api = createModal(h, { title: 'No close', closeButton: false });
  api.show(document.body);
  assert.equal(api.closeBtn, null);
  assert.equal(api.header.querySelector('button'), null);
  assert.ok(api.title, 'title still renders');
  api.close();
});

test('createModal header:false renders no header and labels the dialog directly', () => {
  const api = createModal(h, { title: 'Quick peek', header: false });
  api.append(h('div', { text: 'body' }));
  api.show(document.body);

  assert.equal(api.header, null);
  assert.equal(api.title, null);
  assert.equal(api.closeBtn, null);
  assert.equal(api.modal.getAttribute('aria-label'), 'Quick peek');
  assert.equal(api.modal.hasAttribute('aria-labelledby'), false);
  assert.equal(api.modal.firstChild, api.content);

  api.setTitle('Renamed');
  assert.equal(api.modal.getAttribute('aria-label'), 'Renamed');
  api.close();
});

test('createModal header:<node> uses the caller-supplied header row', () => {
  const custom = h('div', { class: 'lightbox-header' }, [
    h('h2', { text: 'Pinned' }),
  ]);
  const api = createModal(h, { title: 'Lightbox', header: custom });
  api.show(document.body);

  assert.equal(api.header, custom);
  assert.equal(api.modal.firstChild, custom);
  assert.equal(api.closeBtn, null);
  assert.equal(api.modal.getAttribute('aria-label'), 'Lightbox');
  api.close();
});

test('createModal setHint after show inserts the hint before the content area', () => {
  const api = createModal(h, { title: 'Hints' });
  api.show(document.body);
  api.setHint('added later');
  const hint = api.modal.querySelector('.modal-hint');
  assert.equal(hint.textContent, 'added later');
  assert.equal(hint.nextSibling, api.content);
  api.close();
});

test('createModal escape and backdrop click still close the dialog', async () => {
  let result;
  const api = createModal(h, { title: 'Esc', onClose: (r) => (result = r) });
  api.show(document.body);
  pressEscape();
  await tick();
  assert.equal(api.backdrop.parentNode, null);
  assert.equal(result, undefined);
});

// ── The gate ───────────────────────────────────────────────────────────────

const OVERLAY_MESSAGE = /createModal\(\)\/createOverlay\(\)/;

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages;
}

test('gate: a raw overlay class literal in new client code is a lint error', async () => {
  const messages = await lintProbe(
    "export const probe = { class: 'modal-backdrop' };\n",
    'client/views/overlay-gate-probe.js',
  );
  assert.ok(
    messages.some(
      (m) =>
        m.ruleId === 'no-restricted-syntax' && OVERLAY_MESSAGE.test(m.message),
    ),
    `expected the overlay-vocabulary error, got: ${JSON.stringify(messages)}`,
  );
});

test('gate: whole-token boundary — longer class tokens are untouched', async () => {
  const messages = await lintProbe(
    "export const probe = { class: 'loading-modal-backdrop' };\n",
    'client/views/overlay-gate-probe.js',
  );
  assert.equal(
    messages.filter((m) => OVERLAY_MESSAGE.test(m.message)).length,
    0,
  );
});

test('gate: modal.js itself is the permanent home of the vocabulary', async () => {
  const messages = await lintProbe(
    "export const probe = { class: 'modal-backdrop' };\n",
    'client/lib/dom/modal.js',
  );
  assert.equal(
    messages.filter((m) => OVERLAY_MESSAGE.test(m.message)).length,
    0,
  );

  // ...exempt from the overlay rule only: the other client restrictions still
  // fire there (the exemption block re-states clientRestrictedSyntax; a
  // drifted copy would silently un-gate).
  const tMessages = await lintProbe(
    "const t = (k) => k;\nexport const probe = t('only.key');\n",
    'client/lib/dom/modal.js',
  );
  assert.ok(
    tMessages.some(
      (m) =>
        m.ruleId === 'no-restricted-syntax' &&
        /English fallback/.test(m.message),
    ),
    `expected the t() fallback error, got: ${JSON.stringify(tMessages)}`,
  );
});
