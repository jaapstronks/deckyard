/**
 * Every SSE attach hands the new client the interaction state it missed.
 *
 * `attachSessionSseClient()` opens a stream with the session's `state` and
 * `controlEnabled`; every interaction payload after that is a *push*. So a
 * client that attaches after the votes are in renders "Total: 0" until
 * somebody votes again — a presenter reloading mid-poll, a second presenter
 * window, a phone joining late. `sendInteractionCatchUp()` closes that, and
 * this pins that no attach point can be added without it: the failure mode is
 * invisible in every test that only checks the events which *are* sent.
 *
 * Run with: node --test tests/sse-attach-sends-catch-up.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** @returns {string[]} every .js file under `dir` */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}

test('a route that attaches an SSE client also sends the catch-up', () => {
  const offenders = [];
  for (const file of walk(path.join(repoRoot, 'server/routes'))) {
    const src = readFileSync(file, 'utf8');
    // The import alone is not an attach; a call is.
    if (!/attachSessionSseClient\s*\(/.test(src)) continue;
    if (!/sendInteractionCatchUp\s*\(/.test(src)) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'These routes attach an SSE client without handing it the current ' +
      `interaction state: ${offenders.join(', ')}. A client that attaches ` +
      'after the votes are in would sit at zero until the next vote.',
  );
});

test('the catch-up is reachable from at least the two known attach points', () => {
  const attaching = walk(path.join(repoRoot, 'server/routes')).filter((f) =>
    /attachSessionSseClient\s*\(/.test(readFileSync(f, 'utf8')),
  );
  assert.ok(
    attaching.length >= 2,
    'Expected the presenter/companion stream and the follow stream to attach ' +
      `clients; found ${attaching.length}. If an attach point moved, this ` +
      'guard is looking in the wrong place.',
  );
});
