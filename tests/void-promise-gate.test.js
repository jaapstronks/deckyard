/**
 * The `void someCall()` gate (B111).
 *
 * B106 closed the *silent* swallow: a rejection dropped into an empty
 * `.catch(() => {})`. This is the other half — the *absent* catch. `void
 * doThing()` reads as a deliberate decision and is the opposite of one: it
 * discards the promise without attaching anything, so a rejection is unhandled,
 * and under Node's default `--unhandled-rejections=throw` that takes the whole
 * process down. The B106 selector cannot see it: it looks for a `.catch` that
 * is not there.
 *
 * It was a false signal half the time, too. Of the 50 sites the sweep retired,
 * 16 applied `void` to a *synchronous* call (`broadcastToPresentation`, which
 * writes to open SSE responses and returns `undefined`) — the operator claimed
 * "deliberately un-awaited" about something that was never awaitable.
 *
 * The allowlist is empty, `server/config/**` included. Pinned here as well as in
 * the lint pass so a plain `npm test` catches a reintroduction.
 *
 * Run with: node --test tests/void-promise-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const VOID_MESSAGE = /void doThing\(\) discards a promise/;

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'no-restricted-syntax' && VOID_MESSAGE.test(m.message),
  );
}

const RESTRICTED = [
  ['a bare call', 'export function f() {\n  void doThing();\n}\n'],
  [
    'a call with arguments',
    'export function f(a) {\n  void doThing(a, { b: 1 });\n}\n',
  ],
  [
    'an immediately-invoked async function',
    'export function f() {\n  void (async () => {\n    await doThing();\n  })();\n}\n',
  ],
  ['a method call', 'export function f(o) {\n  void o.doThing();\n}\n'],
];

const ALLOWED = [
  ['void 0', 'export function f() {\n  return void 0;\n}\n'],
  [
    'a guarded background promise',
    "import { fireAndForget } from '../utils/fire-and-forget.js';\n" +
      "export function f() {\n  fireAndForget(doThing(), 'thing');\n}\n",
  ],
  [
    'a synchronous call with no operator',
    'export function f() {\n  doThing();\n}\n',
  ],
];

const SERVER_PROBE = 'server/utils/void-gate-probe.js';
const CONFIG_PROBE = 'server/config/void-gate-probe.js';

test('the gate rejects every shape of discarded promise', async (t) => {
  for (const [label, code] of RESTRICTED) {
    await t.test(label, async () => {
      const hits = await lintProbe(code, SERVER_PROBE);
      assert.equal(hits.length, 1, `${label} should be restricted`);
    });
  }
});

test('the gate leaves the legal spellings alone', async (t) => {
  for (const [label, code] of ALLOWED) {
    await t.test(label, async () => {
      const hits = await lintProbe(code, SERVER_PROBE);
      assert.deepEqual(hits, [], `${label} must stay legal`);
    });
  }
});

test('server/config/** is covered too', async () => {
  // That block drops the env-accessor restrictions, and flat-config rule
  // entries replace rather than merge per rule name — so the guard rules have
  // to be re-stated there. A drifted copy would silently un-gate the config
  // tree, which is exactly where a boot-time rejection is least debuggable.
  const hits = await lintProbe(
    'export function f() {\n  void doThing();\n}\n',
    CONFIG_PROBE,
  );
  assert.equal(hits.length, 1);
});

test('the client is not covered', async () => {
  // Deliberate scope: the browser has no process to kill, and an unhandled
  // rejection there is a console line. If that changes, widen the rule rather
  // than assuming it already applies.
  const hits = await lintProbe(
    'export function f() {\n  void doThing();\n}\n',
    'client/views/void-gate-probe.js',
  );
  assert.deepEqual(hits, []);
});

/** Walk `server/` for files with a `void <call>()` statement in them. */
async function findVoidCalls(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'data') continue;
      if (entry.name === 'uploads') continue;
      await findVoidCalls(full, acc);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const src = await readFile(full, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      if (/^\s*void\s+[A-Za-z_$(]/.test(line)) {
        acc.push(`${path.relative(repoRoot, full)}:${i + 1}`);
      }
    }
  }
  return acc;
}

test('server/ carries no discarded promises', async () => {
  const sites = await findVoidCalls(path.join(repoRoot, 'server'));
  assert.deepEqual(
    sites.sort(),
    [],
    'each of these discards a promise without a catch — guard it with ' +
      'fireAndForget(promise, label), or drop the `void` if the callee is ' +
      'synchronous (B111)',
  );
});
