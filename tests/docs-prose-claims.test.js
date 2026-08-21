/**
 * The guardrail on two claim shapes in the documentation that cannot age well.
 *
 * `tests/docs-paths-resolvable.test.js` keeps cited paths and symbols honest.
 * This is its prose sibling: two claims that are not references at all, but
 * assertions about the tree, and that rot on a schedule.
 *
 * 1. **`(N lines)` after a file path.** The 2026-08-21 docs scan (B108) found 48
 *    of them across eight reference docs and 46 were wrong, drifting an average
 *    of 42 lines in both directions — `analytics-track.js` was documented as 573
 *    lines against a real 739. A line count is the one claim a reference doc can
 *    make that the reader cannot use for anything and that every commit
 *    invalidates. There is no legitimate case, so there is no allowlist.
 *
 * 2. **An undated `## Implementation status`.** 13 of the 20 status sections
 *    carried no date. Every one that was sampled was *true* — the problem is
 *    narrower than lying banners: a status note without a date is unfalsifiable.
 *    A reader cannot tell a still-accurate note from one that quietly went stale,
 *    and during beta the date is what makes the honesty checkable.
 *
 * Both scan every git-tracked `.md`, the same corpus and the same reasoning as
 * `tests/slide-type-count-prose-guard.test.js`. `docs/plans/` is a gitignored
 * symlink to the private planning repo, so `git ls-files` excludes it already.
 *
 * Run with: node --test tests/docs-prose-claims.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** This file, repo-relative — it quotes both patterns to describe them. */
const SELF_REL = 'tests/docs-prose-claims.test.js';

/**
 * Every git-tracked `.md`, repo-relative. Tracking is the corpus boundary: it
 * excludes `node_modules/`, build output and the gitignored planning symlink
 * without a hand-maintained list. Falls back to a walk when git is unavailable
 * (a tarball deploy); the guard test below fails loudly on a zero-file scan.
 */
function collectMarkdown() {
  try {
    return execFileSync('git', ['ls-files', '-z', '*.md'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    })
      .split('\0')
      .filter(Boolean);
  } catch {
    // No git: walk the repo.
  }
  const out = [];
  const walk = (relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(REPO_ROOT, relDir || '.'), {
        withFileTypes: true,
      });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (['.git', 'node_modules', 'docs/plans'].includes(entry.name))
          continue;
        walk(rel);
      } else if (entry.name.endsWith('.md')) {
        out.push(rel);
      }
    }
  };
  walk('');
  return out;
}

const MARKDOWN_FILES = collectMarkdown().filter((rel) => rel !== SELF_REL);

/** @returns {string} the file's text */
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

test('the prose scan actually sees the docs', () => {
  // A silent zero-file scan would make every assertion below vacuously pass.
  assert.ok(
    MARKDOWN_FILES.length > 50,
    `expected a populated markdown scan, got ${MARKDOWN_FILES.length} files`,
  );
  assert.ok(
    MARKDOWN_FILES.includes('docs/README.md'),
    'sanity: the documentation index is in the scan',
  );
});

test('no doc claims a file is (N lines) long', () => {
  const lineCount = /\((\d+) lines\)/;
  const offenders = [];
  for (const rel of MARKDOWN_FILES) {
    read(rel)
      .split('\n')
      .forEach((line, i) => {
        if (lineCount.test(line))
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
      });
  }
  assert.deepEqual(
    offenders,
    [],
    `a line count next to a file path is stale the moment the file changes, and ` +
      `a reader cannot act on it. Drop the parenthesis:\n` +
      offenders.map((o) => `  - ${o}`).join('\n'),
  );
});

test('every "Implementation status" section carries a date', () => {
  /** How far below the heading a date still counts as belonging to it. */
  const LOOKAHEAD = 6;
  const heading = /^#{2,4} .*implementation status/i;
  const date = /20\d\d-\d\d/;
  const undated = [];
  for (const rel of MARKDOWN_FILES) {
    const lines = read(rel).split('\n');
    lines.forEach((line, i) => {
      if (!heading.test(line)) return;
      const window = lines.slice(i, i + LOOKAHEAD + 1).join('\n');
      if (!date.test(window)) undated.push(`${rel}:${i + 1}`);
    });
  }
  assert.deepEqual(
    undated,
    [],
    `an implementation-status note without a date is unfalsifiable — a reader ` +
      `cannot tell it from one that went stale. Add "(as of YYYY-MM-DD)" to the ` +
      `heading, or a date to the ${LOOKAHEAD} lines under it:\n` +
      undated.map((u) => `  - ${u}`).join('\n'),
  );
});
