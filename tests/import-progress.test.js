/**
 * Contract for the import progress model (B595,
 * `docs/reference/import-progress.md`): one ladder for every streaming
 * import, a bar that never walks backwards, and a long phase that creeps
 * instead of standing still.
 *
 * Run with: node --test tests/import-progress.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/app',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const { showLoadingModal } = await import('../client/lib/dom/loading-modal.js');
const { createMessageRotator } =
  await import('../client/lib/dom/status-message-rotator.js');
const { PROGRESS } = await import('../server/utils/import-progress.js');

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

const percent = (modal) =>
  Number(
    modal.el
      .querySelector('.loading-modal-progress-bar')
      .style.width.replace('%', ''),
  );

const mount = () => showLoadingModal({ root: document.body });

describe('the progress bar never walks backwards', () => {
  it('keeps the highest value it was given', () => {
    const modal = mount();
    modal.setProgress(55);
    modal.setProgress(10);
    assert.equal(percent(modal), 55);
    modal.close();
  });

  it('still accepts a higher value after a lower one was ignored', () => {
    const modal = mount();
    modal.setProgress(55);
    modal.setProgress(10);
    modal.setProgress(85);
    assert.equal(percent(modal), 85);
    modal.close();
  });
});

describe('a phase without events creeps', () => {
  it('moves off its floor and stays under the ceiling', async () => {
    const modal = mount();
    modal.setProgress(PROGRESS.parse);
    modal.creepTo(PROGRESS.refineFloor, { durationMs: 400 });
    await new Promise((r) => setTimeout(r, 600));
    const value = percent(modal);
    assert.ok(value > PROGRESS.parse, `creep did not move: ${value}`);
    assert.ok(
      value < PROGRESS.refineFloor,
      `creep reached its ceiling: ${value}`,
    );
    modal.close();
  });

  it('is cancelled by the next real progress event', async () => {
    const modal = mount();
    modal.setProgress(PROGRESS.parse);
    modal.creepTo(PROGRESS.refineFloor, { durationMs: 400 });
    await new Promise((r) => setTimeout(r, 200));
    modal.setProgress(PROGRESS.refineFloor);
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(percent(modal), PROGRESS.refineFloor);
    modal.close();
  });
});

describe('the rotator owns text, not progress', () => {
  it('reports a message and nothing else', () => {
    const seen = [];
    const rotator = createMessageRotator({
      onUpdate: (...args) => seen.push(args),
    });
    rotator.setMessages(['one', 'two']);
    rotator.start();
    rotator.stop();
    assert.deepEqual(seen, [['one']]);
  });

  it('holds on the last message unless the list loops', () => {
    const seen = [];
    const rotator = createMessageRotator({
      onUpdate: (m) => seen.push(m),
      interval: 1,
    });
    rotator.setMessages(['only']);
    rotator.start();
    rotator.stop();
    assert.deepEqual(seen, ['only']);
  });

  it('runs one timer chain, however often it is started', async () => {
    // An import sends two `messages` events (the parse list, then the
    // outline's). A second start() must restart the chain, not add one that
    // keeps rotating after stop() and overwrites the closing messages.
    const seen = [];
    const rotator = createMessageRotator({
      onUpdate: (m) => seen.push(m),
      interval: 10,
    });
    rotator.setMessages(['parse'], { loop: true });
    rotator.start();
    rotator.setMessages(['a', 'b', 'c', 'd']);
    rotator.start();
    await new Promise((r) => setTimeout(r, 15));
    rotator.stop();
    const before = seen.length;
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(
      seen.length,
      before,
      `rotated after stop(): ${seen.join(', ')}`,
    );
  });
});

describe('the ladder has one source', () => {
  const routes = [
    'server/routes/api/convert.js',
    'server/routes/api/notion/import.js',
    'server/routes/api/ai/wizard-v2-stream.js',
  ];

  it('is imported by every streaming import route', () => {
    for (const rel of routes) {
      assert.match(
        read(rel),
        /import-progress\.js/,
        `${rel} does not use the shared progress ladder`,
      );
    }
  });

  it('leaves no route picking its own phase numbers', () => {
    for (const rel of routes) {
      const literals = read(rel).match(/\bprogress: \d+/g) || [];
      assert.deepEqual(
        literals,
        [],
        `${rel} hardcodes progress: ${literals.join(', ')} instead of PROGRESS.*`,
      );
    }
  });

  it('does not pace its messages by sleeping on the server', () => {
    for (const rel of routes.slice(0, 2)) {
      const body = read(rel);
      assert.ok(
        !/setTimeout\(r, 1200\)/.test(body),
        `${rel} still sleeps between status messages`,
      );
    }
  });
});
