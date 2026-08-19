/**
 * Guard: UI nodes in `client/` are built with `h()` from `client/lib/dom.js`,
 * not raw `document.createElement` (the CLAUDE.md h()-rule, A7.16 cluster 8).
 *
 * Two kinds of exceptions exist, both deliberate:
 *
 * 1. ALLOWED_TAGS — non-UI elements created for resource loading, styling or
 *    measurement: `script`, `link`, `style`, `meta`, `canvas`. These never
 *    carry attributes/children in the `h()` shape and their creation sites
 *    (loaders, font injectors, contrast measurement) are not view code.
 *    Only a **literal** tag argument can match; a variable argument needs an
 *    ALLOWLIST entry.
 * 2. ALLOWLIST — files that cannot or must not import `h()`, count-pinned so
 *    a new raw site in an exempted file still fails here instead of riding
 *    along on the exemption.
 *
 * `createElementNS` is out of scope here: the remaining NS sites are inline
 * SVG icons, which are A7.16 cluster 5 (two icon systems, awaiting a form
 * decision) — gating them now would freeze the wrong form.
 *
 * Run with: node --test tests/no-raw-create-element.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** Non-UI tags: resource loading, styling and measurement. */
const ALLOWED_TAGS = new Set(['script', 'link', 'style', 'meta', 'canvas']);

const ALLOWLIST = [
  {
    file: 'client/lib/dom.js',
    reason: 'the h() implementation itself (variable tag argument)',
    count: 1,
  },
  {
    file: 'client/embed-sdk.js',
    reason:
      'standalone embed SDK, served as a single self-contained script to ' +
      'third-party pages — it cannot import h()',
    count: 3,
  },
];

/** Third-party code we neither wrote nor patch. */
const SKIP_DIRS = new Set(['vendor']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const CREATE_RE = /document\.createElement\s*\(\s*(?:'([^']*)'|"([^"]*)")?/g;

/**
 * Every `document.createElement` call in a file with its (literal) tag.
 * @param {string} file absolute path
 * @returns {{ line: number, tag: string|null, text: string }[]}
 */
function createSites(file) {
  const src = fs.readFileSync(file, 'utf8');
  const sites = [];
  const lines = src.split('\n');
  lines.forEach((line, i) => {
    const trimmed = line.trimStart();
    // Comment-only lines may mention the API in documentation.
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const m of line.matchAll(CREATE_RE)) {
      sites.push({
        line: i + 1,
        tag: m[1] ?? m[2] ?? null,
        text: trimmed.trim(),
      });
    }
  });
  return sites;
}

test('UI nodes in client/ are built with h(), not document.createElement', () => {
  const allowed = new Map(ALLOWLIST.map((a) => [a.file, a]));
  const violations = [];

  for (const file of walk(path.join(repoRoot, 'client'))) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const sites = createSites(file);
    const entry = allowed.get(rel);
    if (entry) {
      // Count-pinned exemption: the file may keep exactly `count` raw sites.
      if (sites.length !== entry.count) {
        violations.push(
          `${rel}: ${sites.length} raw createElement sites, allowlist pins ` +
            `${entry.count} — use h() for new code, or re-pin with a reason`,
        );
      }
      continue;
    }
    for (const s of sites) {
      if (s.tag !== null && ALLOWED_TAGS.has(s.tag.toLowerCase())) continue;
      violations.push(`${rel}:${s.line}  ${s.text}`);
    }
  }

  assert.equal(
    violations.length,
    0,
    'Build UI nodes with h() from client/lib/dom.js instead of raw ' +
      'document.createElement (see CLAUDE.md § Frontend patterns). Non-UI ' +
      'tags (script/link/style/meta/canvas) are allowed with a literal tag; ' +
      `anything else needs an allowlist entry with a reason in this test:\n  ${violations.join('\n  ')}`,
  );
});

test('the allowlist only names files that still exist', () => {
  for (const { file } of ALLOWLIST) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, file)),
      `Stale allowlist entry: ${file} no longer exists — remove it.`,
    );
  }
});
