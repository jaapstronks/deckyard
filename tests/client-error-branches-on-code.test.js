/**
 * The client branches on an error's code, never on its sentence (B674).
 *
 * docs/reference/api-error-format.md § Consuming it: `api()` throws with
 * `err.code`, the stable machine code, and `err.message`, display text. The
 * text is the server's sentence, translated as soon as server i18n runs, so a
 * branch on `err.message.includes('exists')` silently takes the other arm in
 * every language but English. Two settings forms did exactly that; both now
 * branch on `err.code`.
 *
 * The guard: no string probe on a `.message` anywhere under `client/` (the
 * vendored libraries aside). No allowlist: a code the client needs to branch
 * on is one the server has to send (`jsonError(res, status, code, …)`).
 *
 * Run with: node --test tests/client-error-branches-on-code.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientRoot = path.join(here, '..', 'client');

/** `x.message.includes(`, `x.message?.match(`, `/re/.test(x.message)`, … */
const PROBES = [
  /\.message\??\.(?:includes|match|startsWith|endsWith|indexOf|search)\(/,
  /\.test\(\s*[\w$.]+\??\.message\s*\)/,
];

function* clientSources(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'vendor') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* clientSources(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

test('no client module branches on the text of an error', () => {
  const hits = [];
  for (const file of clientSources(clientRoot)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (PROBES.some((re) => re.test(line))) {
        hits.push(
          `${path.relative(clientRoot, file)}:${i + 1}: ${line.trim()}`,
        );
      }
    });
  }
  assert.deepEqual(
    hits,
    [],
    'branch on err.code, not on err.message (docs/reference/api-error-format.md § Consuming it)',
  );
});

test('the probe catches the shapes it is meant to', () => {
  for (const sample of [
    "e.message?.includes('exists')",
    'err.message.match(/incorrect/)',
    '/exists/i.test(err.message)',
  ]) {
    assert.ok(
      PROBES.some((re) => re.test(sample)),
      sample,
    );
  }
  assert.ok(!PROBES.some((re) => re.test("err.code === 'already_exists'")));
});
