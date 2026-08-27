/**
 * The advisory-mirror checklist, made mechanical (B151).
 *
 * `docs/reference/permission-model.md` already names the client-side advisory
 * mirrors — the modules that decide *which affordance to show*, never whether
 * an operation is allowed. That paragraph is a checklist written in prose, and
 * a checklist nothing reads goes stale: the share modal's owner gate sat on it
 * untested from the day it was added.
 *
 * So this file reads the paragraph and turns it into a gate: every module path
 * the doc names must be imported by at least one test file. Add a fourth mirror
 * to the doc without a test and CI says so; move or rename one and the path
 * stops resolving and CI says that too.
 *
 * Deliberately shallow. It asserts that a mirror is *exercised somewhere*, not
 * that it is exercised well — a presence check is a weak gate and is only worth
 * having because the doc is the thing keeping the list. What it does buy is
 * that doc and tests cannot drift apart silently.
 *
 * The parse is pinned as tightly as the coverage: an empty match is a failure,
 * never a pass. A doc rewrite that drops the paragraph, renames the heading or
 * stops backticking the paths would otherwise yield "0 mirrors, all covered".
 *
 * Run with: node --test tests/client-authz-mirror-coverage.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const docFile = path.join(repoRoot, 'docs', 'reference', 'permission-model.md');
const testsDir = path.join(repoRoot, 'tests');

/** The sentence that opens the advisory-mirrors paragraph. */
const PARAGRAPH_ANCHOR = /^The client's advisory mirrors\b/m;

/**
 * The paragraph that names the mirrors, as raw markdown.
 * A markdown paragraph ends at the first blank line.
 */
function readMirrorParagraph(doc) {
  const match = PARAGRAPH_ANCHOR.exec(doc);
  if (!match) return null;
  const rest = doc.slice(match.index);
  const end = rest.search(/\n[ \t]*\n/);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every backticked `client/*.js` path in the paragraph, in document order. */
function mirrorPathsIn(paragraph) {
  const paths = [...paragraph.matchAll(/`(client\/[^`\s]+\.js)`/g)].map(
    (m) => m[1],
  );
  return [...new Set(paths)];
}

/** Every `*.test.js` under tests/, recursively. */
async function testFiles(dir = testsDir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await testFiles(full)));
    else if (entry.name.endsWith('.test.js')) found.push(full);
  }
  return found;
}

const doc = await fs.readFile(docFile, 'utf8');
const paragraph = readMirrorParagraph(doc);
const mirrors = paragraph ? mirrorPathsIn(paragraph) : [];

describe('client-side advisory mirrors are covered', () => {
  it('the doc still carries the advisory-mirrors paragraph', () => {
    assert.ok(
      paragraph,
      `no paragraph matching ${PARAGRAPH_ANCHOR} in docs/reference/permission-model.md — ` +
        'the checklist this gate reads has moved or been rewritten; ' +
        'point the anchor at its new wording rather than deleting the gate',
    );
  });

  it('the paragraph names at least the three known mirrors', () => {
    // A parse that silently yields nothing would report perfect coverage.
    assert.ok(
      mirrors.length >= 3,
      `parsed ${mirrors.length} mirror path(s) from the paragraph, expected >= 3; ` +
        `paragraph was:\n${paragraph}`,
    );
  });

  it('every named mirror exists on disk', async () => {
    for (const rel of mirrors) {
      const abs = path.join(repoRoot, rel);
      const exists = await fs
        .stat(abs)
        .then(() => true)
        .catch(() => false);
      assert.ok(
        exists,
        `permission-model.md names ${rel}, which does not exist — ` +
          'update the doc when a mirror moves',
      );
    }
  });

  it('every named mirror is imported by at least one test file', async () => {
    const files = await testFiles();
    const sources = await Promise.all(
      files.map(async (file) => ({
        file: path.relative(repoRoot, file),
        text: await fs.readFile(file, 'utf8'),
      })),
    );

    const uncovered = [];
    for (const rel of mirrors) {
      // Test files reach up out of tests/ (or tests/<sub>/) to the module.
      const needle = new RegExp(
        `(\\.\\./)+${rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      );
      const covered = sources.some(({ text }) => needle.test(text));
      if (!covered) uncovered.push(rel);
    }

    assert.deepEqual(
      uncovered,
      [],
      `advisory mirror(s) named in permission-model.md with no test importing them: ${uncovered.join(', ')}. ` +
        'A mirror decides what a collaborator is shown; add a test or take it off the list.',
    );
  });
});
