/**
 * The app-shell policy: `client/index.html` references no third-party origin.
 *
 * DOMPurify, Prism and KaTeX are self-hosted under `client/vendor/` (B32, B33)
 * and the fonts under `assets/fonts/google/`, so every `src`/`href` in the head
 * resolves against this server. This gate is what keeps a CDN tag from quietly
 * coming back.
 *
 * Run with: node --test tests/app-shell-third-party-cdn.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * Origins a fork deliberately loads from, one per line, each with why.
 *
 * The seam exists because the policy above is upstream's, not everyone's: the
 * CIIIC fork loads one external origin on purpose — a shared navigation bar
 * every CIIIC app renders identically, whose whole point is that it updates in
 * one place, so vendoring it would freeze it. Without this constant that fork
 * had to keep a local edit to *this file*, and every upstream change to the
 * gate's logic came back as a merge conflict on a test it never wanted to
 * touch.
 *
 * Same shape as `EXCLUDED_DOC_TREES` in `tests/docs-paths-resolvable.test.js`,
 * for the same reason: a fork adds one data line, so the next conflict sits on
 * a data line instead of on the logic of the gate.
 *
 * Upstream's copy is empty, and the second test below is what keeps the list
 * from becoming a junk drawer in either tree: an entry that no longer excuses
 * anything in the shell fails as stale — the same two-way honesty
 * `EXCLUDED_DOC_TREES` keeps, and a check a fork passes as written rather than
 * one it has to delete. Entries are matched as origin prefixes against the URL
 * as written in the HTML, protocol-relative forms included
 * (`//tools.example.org/`).
 *
 * @type {string[]}
 */
const FORK_ALLOWED_ORIGINS = [];

/** @param {string} url - a `src`/`href` value as written in the HTML */
const isForkAllowed = (url) =>
  FORK_ALLOWED_ORIGINS.some(
    (origin) =>
      url.startsWith(origin) || url.startsWith(origin.replace(/^https?:/, '')),
  );

/** Every absolute or protocol-relative `src`/`href` in the app shell. */
async function externalRefs() {
  const html = await fs.readFile(
    path.join(repoRoot, 'client', 'index.html'),
    'utf8',
  );
  return [
    ...html.matchAll(/(?:src|href)\s*=\s*"((?:https?:)?\/\/[^"]*)"/g),
  ].map((m) => m[1]);
}

test('the app shell references no third-party URLs', async () => {
  const external = (await externalRefs()).filter((url) => !isForkAllowed(url));
  assert.deepEqual(
    external,
    [],
    `client/index.html loads from a third-party origin: ${external.join(', ')}\n` +
      'Self-host it under client/vendor/ or assets/. If your fork loads it on ' +
      'purpose, add the origin to FORK_ALLOWED_ORIGINS above with a reason.',
  );
});

test('no allowed origin outlives the tag it excuses', async () => {
  // An allowance is a claim that the shell loads that origin on purpose. When
  // the tag goes, the line has to go too — otherwise the list quietly becomes
  // a place a future CDN tag could land unnoticed.
  const external = await externalRefs();
  const stale = FORK_ALLOWED_ORIGINS.filter(
    (origin) =>
      !external.some(
        (url) =>
          isForkAllowed(url) &&
          url.includes(origin.replace(/^https?:\/\//, '')),
      ),
  );
  assert.deepEqual(
    stale,
    [],
    `client/index.html no longer loads from: ${stale.join(', ')} — drop the entry`,
  );
});

test('the allowlist is what decides, not the absence of a tag', async () => {
  // Self-test: the gate runs on input built to make it fail, so an upstream
  // shell that happens to be clean cannot hide a broken matcher.
  const shell = ['https://cdn.example.com/x.js', '//tools.example.org/bar.js'];
  assert.deepEqual(
    shell.filter((url) => !isForkAllowed(url)),
    shell,
    'with an empty allowlist every external ref is a finding',
  );

  const allowed = ['https://tools.example.org/'];
  const withAllow = (url) =>
    allowed.some(
      (o) => url.startsWith(o) || url.startsWith(o.replace(/^https?:/, '')),
    );
  assert.deepEqual(
    shell.filter((url) => !withAllow(url)),
    ['https://cdn.example.com/x.js'],
    'an allowed origin covers both its absolute and protocol-relative form',
  );
});
