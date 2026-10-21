/**
 * Pins the job gates in `.github/workflows/ci.yml` (B814). Every job that
 * needs `classify` must survive a failed classify (fail-closed: the full path
 * runs) but must not start when the run itself is cancelled, which
 * `cancel-in-progress` does to a superseded push. `always()` is true in both
 * cases; `!cancelled()` only in the first.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const workflow = parse(
  fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8'),
);
const FULL_PATH =
  "needs.classify.result != 'success' || needs.classify.outputs.doc_only != 'true'";

const dependents = Object.entries(workflow.jobs).filter(([, job]) =>
  [job.needs].flat().includes('classify'),
);

test('the follow-up jobs of classify are the expected five', () => {
  assert.deepEqual(dependents.map(([name]) => name).sort(), [
    'migrations',
    'test',
    'test-fork',
    'test-postgres',
    'vendor-freshness',
  ]);
});

test('no job gates on always(), which outlives a cancelled run', () => {
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.doesNotMatch(String(job.if ?? ''), /always\(\)/, name);
  }
});

test('test runs unless cancelled; its steps pick the light or full path', () => {
  const job = workflow.jobs.test;
  assert.equal(job.if, '${{ !cancelled() }}');
});

test('the other follow-up jobs run the full path unless cancelled', () => {
  for (const [name, job] of dependents) {
    if (name === 'test') continue;
    assert.equal(job.if, `\${{ !cancelled() && (${FULL_PATH}) }}`, name);
  }
});
