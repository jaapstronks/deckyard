/**
 * One teardown word, one element word (B150).
 *
 * A client factory hands back a handle: the DOM node it built, and the
 * function that unwires it again. Both halves had grown a second spelling —
 * `detach` 24 / `destroy` 17 / `teardown` 4 / `cleanup` 1 for the disposer,
 * `el` 121 / `element` 29 for the node. Inside one directory,
 * `views/editor/modals/share-modal/`, one section returned `{ element,
 * detach }` while its siblings returned `{ el, detach }`.
 *
 * `detach` won on plurality and because it is the exact antonym of the verb
 * that already names the other half of the lifecycle (`attachThumbScale`,
 * `attachSwipeNavigation`, `attachMentions`, and the `detachers` arrays the
 * views collect into). `el` won 121 to 29.
 *
 * The gate is key-shaped, not a whole-token identifier ban: `.destroy()` is
 * also a *third-party* method (yjs's UndoManager and WebsocketProvider,
 * hls.js), and those calls are their vocabulary, not ours. A MemberExpression
 * is not a Property, so the selector leaves them alone by construction.
 *
 * `close` and `stop` are deliberately not gated — both name something a
 * caller can undo, which a teardown is not.
 *
 * Run with: node --test tests/teardown-vocabulary-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const GATE_MESSAGE = /One teardown word and one element word/;
// The one file whose handle is a public contract for third-party embedders.
const EXEMPT = 'client/embed-sdk.js';

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'no-restricted-syntax' && GATE_MESSAGE.test(m.message),
  );
}

const PROBE = 'client/views/teardown-gate-probe.js';

const RETIRED = [
  ['destroy', 'export const f = () => ({ el: 1, destroy: () => {} });\n'],
  ['teardown', 'export const f = () => ({ el: 1, teardown: () => {} });\n'],
  ['cleanup', 'export const f = () => ({ el: 1, cleanup: () => {} });\n'],
  ['element', 'export const f = (node) => ({ element: node });\n'],
  [
    'element (destructured out of a handle)',
    'export const f = (h) => {\n  const { element } = h;\n  return element;\n};\n',
  ],
  [
    'destroy (a shorthand method on a returned object)',
    'export const f = () => ({\n  destroy() {},\n});\n',
  ],
];

for (const [label, code] of RETIRED) {
  test(`gate: \`${label}\` as a handle key is a lint error`, async () => {
    const messages = await lintProbe(code, PROBE);
    assert.equal(
      messages.length,
      1,
      `expected the teardown-vocabulary error, got: ${JSON.stringify(messages)}`,
    );
  });
}

test('gate: the canonical `{ el, detach }` pair is legal', async () => {
  const messages = await lintProbe(
    'export const f = (node) => ({ el: node, detach: () => {} });\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: a third-party `.destroy()` call is untouched', async () => {
  // yjs (UndoManager, WebsocketProvider) and hls.js all expose destroy().
  const messages = await lintProbe(
    'export const f = (provider, hls) => {\n  provider.destroy();\n  hls?.destroy?.();\n};\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: `close` and `stop` are deliberately not gated', async () => {
  const messages = await lintProbe(
    'export const f = () => ({ el: 1, close: () => {}, stop: () => {} });\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: the exemption is exactly one file, and it is not stale', async () => {
  assert.deepEqual(
    await lintProbe('export const f = () => ({ destroy() {} });\n', EXEMPT),
    [],
    `${EXEMPT} carries the public embed handle and must stay exempt`,
  );
  // dom.js is the other file exempted from the createElement gate — it must
  // NOT have inherited this exemption.
  assert.equal(
    (
      await lintProbe(
        'export const f = () => ({ destroy() {} });\n',
        'client/lib/dom.js',
      )
    ).length,
    1,
    'client/lib/dom.js must not be exempt from the teardown gate',
  );
  // An exemption for a key that no longer exists is dead config.
  const sdk = fs.readFileSync(path.join(repoRoot, EXEMPT), 'utf8');
  assert.match(
    sdk,
    /\n\s{6}destroy\(\) \{/,
    `${EXEMPT} must still expose destroy() — otherwise the exemption is stale`,
  );
});

test('gate: the client is clean — the burndown is finished', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles(['client']);
  const hits = results.flatMap((r) =>
    r.messages
      .filter(
        (m) =>
          m.ruleId === 'no-restricted-syntax' && GATE_MESSAGE.test(m.message),
      )
      .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
  );
  assert.deepEqual(hits, []);
});
