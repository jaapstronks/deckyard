/**
 * The overlay-closer gate (A7.33 PR 4).
 *
 * The set of "close functions of everything currently open" used to be the
 * optional 4th positional argument of `openModal`/`confirmModal`/`promptModal`
 * and travelled as ~200 pass-through lines through 55 modules. Being optional,
 * a caller that forgot it silently dropped that overlay out of close-all — and
 * nothing at the call site showed it. `client/lib/dom/modal.js` now keeps the
 * register itself (`registerOverlayCloser` / `closeAllOverlays`, keyed per
 * `Document` — D44), so `createOverlay` registers where the overlay is built.
 *
 * This file pins the ESLint rule that stops the parameter from growing back.
 * The allowlist is empty, `modal.js` included: its own state is named
 * `overlayClosersByDocument`, so the restricted spellings are gone from the
 * codebase entirely rather than merely from its callers.
 *
 * Run with: node --test tests/overlay-closers-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const CLOSERS_MESSAGE = /The overlay-closer set is not passed around any more/;

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) =>
      m.ruleId === 'no-restricted-syntax' && CLOSERS_MESSAGE.test(m.message),
  );
}

const PROBE = 'client/views/closers-gate-probe.js';

const RESTRICTED = [
  [
    'a positional parameter',
    'export const f = (root, overlayClosers) => root;\n',
  ],
  [
    'a destructured parameter',
    'export const f = ({ root, openOverlayClosers }) => root;\n',
  ],
  [
    'a destructured parameter with a default',
    'export const f = ({ root, openOverlayClosers = null } = {}) => root;\n',
  ],
  [
    'an options property handed to someone else',
    'export const f = (set) => ({ openOverlayClosers: set });\n',
  ],
  [
    'a locally owned set',
    'export const f = () => {\n  const openOverlayClosers = new Set();\n  return openOverlayClosers;\n};\n',
  ],
];

for (const [label, code] of RESTRICTED) {
  test(`gate: the closer set as ${label} is a lint error`, async () => {
    const messages = await lintProbe(code, PROBE);
    assert.ok(
      messages.length >= 1,
      `expected the closer-threading error, got: ${JSON.stringify(messages)}`,
    );
  });
}

test('gate: whole-token — neighbouring names are untouched', async () => {
  const messages = await lintProbe(
    'export const f = (overlayClosersByDocument, closers) => [\n  overlayClosersByDocument,\n  closers,\n];\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: the canonical seam is importable and unrestricted', async () => {
  const messages = await lintProbe(
    "import { registerOverlayCloser, closeAllOverlays } from '../lib/dom/modal.js';\nexport const f = (el, close) => {\n  registerOverlayCloser(el, close);\n  closeAllOverlays(el.ownerDocument);\n};\n",
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: no allowlist — it is in force inside modal.js itself', async () => {
  const messages = await lintProbe(
    'export const f = ({ overlayClosers }) => overlayClosers;\n',
    'client/lib/dom/modal.js',
  );
  assert.ok(messages.length >= 1, 'modal.js must not be exempt');
});

test('gate: the client is clean — the burndown is finished', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles(['client']);
  const hits = results.flatMap((r) =>
    r.messages
      .filter(
        (m) =>
          m.ruleId === 'no-restricted-syntax' &&
          CLOSERS_MESSAGE.test(m.message),
      )
      .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
  );
  assert.deepEqual(hits, []);
});
