/**
 * The source gate: no module names an asset CDN.
 *
 * `tests/export-third-party-cdn.test.js` checks the *output* — it builds every
 * render path and reads back which hosts the document names. That gate can only
 * see a path it knows how to build with a deck that triggers it, which is how
 * four render paths spent months emitting fourteen jsDelivr tags each while an
 * export test sat green next to them (B102).
 *
 * This one greps the source instead, so a new offender fails on the day it is
 * written, before anything renders it. Every hit must be listed below with a
 * reason: an entry is a decision about the rule, and a decision has an author.
 *
 * **Why the allowlist is not keyed by line number.** The brief that opened this
 * item asked for `file:line`. Line numbers shift on every edit above the hit,
 * which turns "re-approve this exception" into "bump the number", so the
 * allowlist keys on the file plus the exact URL text and how often it appears.
 * A second spelling in an allowlisted file, or a second copy of the same one,
 * still fails.
 *
 * Out of scope, deliberately: `fonts.googleapis.com` has its own documented
 * carve-out (`docs/reference/font-management.md`) and the Bunny player.js seam
 * is a lazy loader, not a page dependency. Neither matches the pattern below.
 *
 * Run with: node --test tests/no-third-party-origins.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/** Directories walked, and the one that is exempt by definition. */
const ROOTS = ['server', 'client', 'shared'];
const EXCLUDED = new Set([path.join('client', 'vendor')]);

/** The asset CDNs Deckyard has actually reached for, historically. */
const CDN = /https?:\/\/(?:cdn\.|cdnjs|unpkg|jsdelivr)[^\s'"`)]*/g;

/**
 * The exceptions, with the reason each one is not a bug.
 *
 * @type {Array<{file: string, url: string, count: number, reason: string}>}
 */
const ALLOWED = [
  {
    file: 'server/routes/public-api/v1/index.js',
    url: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css',
    count: 1,
    reason:
      'the Swagger UI shell for /api/v1/docs. Developer documentation, not a ' +
      'render path: no deck, no reader, and it is not served to end users. ' +
      'Vendoring swagger-ui-dist (~3 MB) to make a docs page load offline is ' +
      'a trade nobody has asked for.',
  },
  {
    file: 'server/routes/public-api/v1/index.js',
    url: 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js',
    count: 1,
    reason: 'same Swagger UI shell — the script half of it.',
  },
  {
    file: 'client/lib/slide-runtime/ensure-hls.js',
    url: 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js',
    count: 1,
    reason:
      'the HLS playback seam, injected lazily by the runtime only once a ' +
      'reader plays a stream that needs it — the same shape as the Bunny ' +
      'player.js loader. Nothing is fetched by a deck that has no such video. ' +
      'Vendoring it is a live candidate, not a decision that has been taken.',
  },
];

/** @returns {Promise<string[]>} every `.js` file below `dir`, repo-relative */
async function jsFilesIn(dir) {
  const out = [];
  const entries = await readdir(path.join(repoRoot, dir), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    const rel = path.join(dir, entry.name);
    if (EXCLUDED.has(rel)) continue;
    if (entry.isDirectory()) out.push(...(await jsFilesIn(rel)));
    else if (entry.name.endsWith('.js')) out.push(rel);
  }
  return out;
}

/** @returns {Promise<Array<{file: string, line: number, url: string}>>} */
async function findCdnReferences() {
  const hits = [];
  for (const dir of ROOTS) {
    for (const file of await jsFilesIn(dir)) {
      const lines = (await readFile(path.join(repoRoot, file), 'utf8')).split(
        '\n',
      );
      lines.forEach((text, i) => {
        for (const m of text.matchAll(CDN)) {
          hits.push({ file, line: i + 1, url: m[0] });
        }
      });
    }
  }
  return hits;
}

const hits = await findCdnReferences();

/** `file` + `url` -> how often the allowlist expects it. */
const key = (h) => JSON.stringify([h.file, h.url]);
const expected = new Map(ALLOWED.map((a) => [key(a), a.count]));

test('every CDN reference in the source is an allowlisted exception', () => {
  const unexpected = hits.filter((h) => !expected.has(key(h)));
  assert.deepEqual(
    unexpected.map((h) => `${h.file}:${h.line} → ${h.url}`),
    [],
    'a module reaches for a third-party CDN. Self-host it under ' +
      'client/vendor/ (scripts/vendor-prism-katex.js is the pattern), or — if ' +
      'it genuinely belongs — add it to ALLOWED in this file with the reason.',
  );
});

test('an allowlisted exception appears exactly as often as it is allowed', () => {
  const counted = new Map();
  for (const h of hits) counted.set(key(h), (counted.get(key(h)) || 0) + 1);
  for (const entry of ALLOWED) {
    assert.equal(
      counted.get(key(entry)) || 0,
      entry.count,
      `${entry.file} names ${entry.url} a different number of times than the ` +
        'allowlist records. A copy of an allowed exception is a new decision.',
    );
  }
});

test('no allowlist entry outlives the thing it excused', () => {
  const seen = new Set(hits.map(key));
  const stale = ALLOWED.filter((a) => !seen.has(key(a))).map(
    (a) => `${a.file} → ${a.url}`,
  );
  assert.deepEqual(
    stale,
    [],
    'an allowlist entry no longer matches anything — the reference was ' +
      'removed or rewritten, so delete the entry (an allowlist that outlives ' +
      'its reasons is how the next one gets waved through).',
  );
});

test('the vendored copies are what the exempt directory holds', async () => {
  // The one excluded directory is excluded because its contents are *the*
  // self-hosted answer, not an exception to it. If it stopped existing the
  // gate above would still pass while every export broke.
  const vendored = await readdir(path.join(repoRoot, 'client', 'vendor'));
  for (const name of ['prism', 'katex', 'dompurify', 'pdfjs']) {
    assert.ok(
      vendored.includes(name),
      `client/vendor/${name} is missing — run npm ci (postinstall vendors it)`,
    );
  }
});
