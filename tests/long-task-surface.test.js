/**
 * A long task has one surface: the loading modal (B716).
 *
 * The client had five progress forms for one concept: the loading modal, a
 * bar of its own in the PDF-as-slides import, another in the AI analysis,
 * button text in the export modal and polling in the settings backup. Now the
 * import, the analysis and every Chrome export open `showLoadingModal`, and
 * this guard keeps a sixth bar from appearing: a `*-progress-bar` (or
 * `-fill`/`-track`) class exists only in the loading modal and in the
 * presenter's deck progress, which is not a task but the position in a talk.
 * `docs/reference/feedback-surfaces.md` § Long tasks.
 *
 * It also pins what makes the modal the carrier of a task that can be
 * stopped: a Cancel button exactly when the caller can cancel, Escape for the
 * same, and the caller hearing it once.
 *
 * Run with: node --test tests/long-task-surface.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { walkFiles } from './helpers/walk-files.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where a progress-bar class may live, and why. */
const ALLOWED = new Set([
  // The one long-task surface.
  'client/lib/dom/loading-modal.js',
  'client/styles/app/components/11-modals-loading.css',
  // The presenter's position in the deck: a talk, not a task.
  'client/views/presenter/stage-scaffold.js',
  'client/styles/viewer/80-presenter-progress.css',
]);

const PROGRESS_CLASS = /\b[a-z0-9-]+-progress-(?:bar|fill|track)\b/g;

test('a progress bar class lives only in the loading modal (and the presenter)', () => {
  const strays = [];
  const files = walkFiles(join(ROOT, 'client'), {
    extensions: ['.js', '.css', '.html'],
    skipDirs: ['vendor', 'i18n'],
  });
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;
    for (const m of readFileSync(file, 'utf8').matchAll(PROGRESS_CLASS)) {
      strays.push(`${rel}: ${m[0]}`);
    }
  }
  assert.deepEqual(
    strays,
    [],
    'a long task opens showLoadingModal (client/lib/dom/loading-modal.js) instead of drawing a bar',
  );
});

test('every allowed file still carries its bar, so the list cannot rot', () => {
  for (const rel of ALLOWED) {
    assert.match(
      readFileSync(join(ROOT, rel), 'utf8'),
      new RegExp(PROGRESS_CLASS.source),
      rel,
    );
  }
});

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.Event = dom.window.Event;
globalThis.KeyboardEvent = dom.window.KeyboardEvent;
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const { showLoadingModal } = await import('../client/lib/dom/loading-modal.js');

test('a task that cannot be stopped gets no Cancel', () => {
  document.body.innerHTML = '';
  const modal = showLoadingModal({ root: document.body, title: 'Working' });
  assert.equal(document.querySelector('.loading-modal-cancel'), null);
  assert.equal(
    document.querySelector('.loading-modal').getAttribute('role'),
    'dialog',
  );
  modal.close();
});

test('Cancel closes the modal and tells the caller once', () => {
  document.body.innerHTML = '';
  let cancelled = 0;
  showLoadingModal({
    root: document.body,
    title: 'Exporting PowerPoint',
    onCancel: () => {
      cancelled += 1;
    },
  });
  const button = document.querySelector('.loading-modal-cancel');
  assert.equal(button.textContent, 'Cancel');
  assert.equal(document.activeElement, button, 'focus lands on Cancel');

  button.click();
  button.click();
  assert.equal(cancelled, 1);
  const backdrop = document.querySelector('.loading-modal-backdrop');
  assert.ok(backdrop.classList.contains('is-closing'));
  assert.equal(
    document.querySelector('.loading-modal').getAttribute('aria-busy'),
    'false',
  );
});

test('Escape cancels a cancellable task', () => {
  document.body.innerHTML = '';
  let cancelled = 0;
  showLoadingModal({
    root: document.body,
    onCancel: () => {
      cancelled += 1;
    },
  });
  document
    .querySelector('.loading-modal-cancel')
    .dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
  assert.equal(cancelled, 1);
});

test('closing a finished task is not a cancel', () => {
  document.body.innerHTML = '';
  let cancelled = 0;
  const modal = showLoadingModal({
    root: document.body,
    onCancel: () => {
      cancelled += 1;
    },
  });
  modal.close();
  modal.cancel();
  assert.equal(cancelled, 0);
});
