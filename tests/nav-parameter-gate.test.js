/**
 * The `nav`-parameter gate (B150).
 *
 * `nav` — the router's navigate function — is one export of
 * `client/lib/state/router.js`. Exactly one file imported it (`client/app.js`);
 * from there it was threaded as an option through 55 modules to reach 54 call
 * sites, in four spellings at once: `nav?.(x)`, `if (typeof nav === 'function')
 * nav(x)`, `if (nav) nav(x)` and bare `nav(x)`. The optional chaining was the
 * tell, not caution: three of `app.js`'s threading paths handed `{ nav }` to
 * views that never destructured it, so the defensive form was covering for a
 * wire that was already cut. Every module now imports it directly; this file
 * pins the ESLint rule that keeps the fifth spelling from starting.
 *
 * The allowlist is empty on purpose — including for `router.js` itself, where
 * `nav` is a function *declaration*, never a parameter. The rule is
 * parameter- and destructuring-shaped rather than a whole-token identifier
 * ban, because `nav` is also a legitimate local name for a `<nav>` element.
 *
 * Run with: node --test tests/nav-parameter-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const NAV_MESSAGE = /Import `nav` from client\/lib\/state\/router\.js/;

async function lintProbe(code, relPath) {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, {
    filePath: path.join(repoRoot, relPath),
  });
  return result.messages.filter(
    (m) => m.ruleId === 'no-restricted-syntax' && NAV_MESSAGE.test(m.message),
  );
}

const PROBE = 'client/views/nav-gate-probe.js';

const RESTRICTED = [
  ['a positional parameter', "export const f = (nav) => nav('/app');\n"],
  ['a destructured parameter', "export const f = ({ nav }) => nav('/app');\n"],
  [
    'a destructured parameter with a default',
    "export const f = ({ nav } = {}) => nav('/app');\n",
  ],
  [
    'destructured out of a context object',
    "export const f = (ctx) => {\n  const { nav } = ctx;\n  return nav('/app');\n};\n",
  ],
  [
    'a shorthand property handed to someone else',
    "import { nav } from '../../lib/state/router.js';\nexport const f = () => ({ nav });\n",
  ],
];

for (const [label, code] of RESTRICTED) {
  test(`gate: \`nav\` as ${label} is a lint error`, async () => {
    const messages = await lintProbe(code, PROBE);
    assert.equal(
      messages.length,
      1,
      `expected the nav-threading error, got: ${JSON.stringify(messages)}`,
    );
  });
}

test('gate: whole-token — `navigator` and `navUrl` are untouched', async () => {
  const messages = await lintProbe(
    'export const f = (navUrl) => ({ navigator: navUrl });\n',
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: a local `<nav>` element named `nav` stays legal', async () => {
  const messages = await lintProbe(
    "import { h } from '../../lib/dom.js';\n" +
      "export const f = () => {\n  const nav = h('nav', { class: 'sidebar-nav' });\n  return nav;\n};\n",
    PROBE,
  );
  assert.deepEqual(messages, []);
});

test('gate: no allowlist — it is in force inside the router itself', async () => {
  for (const file of [
    'client/lib/state/router.js',
    'client/app.js',
    'client/lib/user/user-menu.js',
  ]) {
    const messages = await lintProbe(
      "export const f = ({ nav }) => nav('/app');\n",
      file,
    );
    assert.equal(messages.length, 1, `${file} must not be exempt`);
  }
});

test('gate: the client is clean — the burndown is finished', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: repoRoot });
  const results = await eslint.lintFiles(['client']);
  const hits = results.flatMap((r) =>
    r.messages
      .filter(
        (m) =>
          m.ruleId === 'no-restricted-syntax' && NAV_MESSAGE.test(m.message),
      )
      .map((m) => `${path.relative(repoRoot, r.filePath)}:${m.line}`),
  );
  assert.deepEqual(hits, []);
});
