/**
 * The dead-CSS gate, over the real tracked tree.
 *
 * `tests/lint-dead-css.test.js` unit-tests the scanner with an injected reader;
 * this file is the gate itself — it runs the same scan CI runs, over
 * `git ls-files`, and fails when a CSS class selector is referenced by nothing.
 *
 * It lives in the suite rather than in `npm run lint` because that is how every
 * other CSS gate here hangs (`css-spacing-tokens`, `slide-css-tokens`): `npm
 * test` is what CI runs, and a red mark reads as "a stylesheet grew an orphan"
 * without opening the run. `npm run lint:deadcss` is the same check as a
 * standalone command, with a report you can read.
 *
 * When this fails, the fix is almost always to delete the selector. The escape
 * hatch is `dead-css-allowlist.json`, and it is deliberately narrow: only a
 * writer outside the scanned corpus (vendored code, or deck/fork authors) earns
 * an entry, and every entry must carry a reason. See the header of
 * scripts/lint-dead-css.js.
 *
 * Run with: node --test tests/dead-css-gate.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const {
  ALLOWLIST_FILE,
  ALLOWLIST_KINDS,
  auditAllowlist,
  isCssFile,
  isSourceFile,
  readAllowlist,
  scan,
  trackedFiles,
} = await import('../scripts/lint-dead-css.js');

const all = trackedFiles();
const sourceFiles = all.filter(isSourceFile);
const cssFiles = all.filter(isCssFile);
const { dead, byName, totalClasses } = scan({ sourceFiles, cssFiles });
const allowlist = readAllowlist();
const audit = auditAllowlist({ dead, byName, allowlist });

describe('dead CSS gate', () => {
  it('scans a corpus worth scanning', () => {
    // A gate that passes because it found nothing is the one failure mode a
    // guard must not have.
    assert.ok(
      sourceFiles.length > 500,
      `expected the source tree, got ${sourceFiles.length} files`,
    );
    assert.ok(
      totalClasses > 1000,
      `expected the full class census, got ${totalClasses}`,
    );
  });

  it('excludes client/vendor from the source corpus', () => {
    // Vendored bundles are not our source, and the harvester desyncs inside
    // them — see VENDOR IS NOT SOURCE in scripts/lint-dead-css.js.
    assert.deepEqual(
      sourceFiles.filter((f) => f.startsWith('client/vendor/')),
      [],
    );
  });

  it('declares no CSS class that nothing references', () => {
    const lines = audit.unexpected.map(
      (rec) => `  ${rec.file}:${rec.line}  .${rec.name}`,
    );
    assert.deepEqual(
      lines,
      [],
      `${lines.length} unreferenced CSS selector(s):\n${lines.join('\n')}\n\n` +
        'Delete them. Only a writer outside the scanned corpus — vendored code,\n' +
        `or deck/fork authors — earns an entry in ${ALLOWLIST_FILE}, and every\n` +
        'entry needs a kind, a reason and a `see`.\n' +
        'Report: npm run lint:deadcss',
    );
  });

  it('keeps every allowlist entry reasoned', () => {
    assert.deepEqual(
      audit.malformed.map((m) => `${m.name}: ${m.problem}`),
      [],
      `${ALLOWLIST_FILE} entries must carry kind ` +
        `(${[...ALLOWLIST_KINDS].join(' | ')}), reason and see. ` +
        'A bare list of names is the tolerance the allowlist exists to prevent.',
    );
  });

  it('carries no stale allowlist entry', () => {
    assert.deepEqual(
      audit.stale.map((s) => `${s.name}: ${s.why}`),
      [],
      `${ALLOWLIST_FILE} describes selectors that no longer need excusing.\n` +
        'Delete those entries — the gate stays green without them.',
    );
  });

  it('exits 0 from the command line', () => {
    // The library being green is not the same claim as `npm run lint:deadcss`
    // being green: the CLI also reads the allowlist off disk and owns the exit
    // code. Cheap enough (~0.1s) to assert directly.
    execFileSync('node', ['scripts/lint-dead-css.js'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
  });
});
