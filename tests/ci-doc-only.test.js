import assert from 'node:assert/strict';
import test from 'node:test';
import { isDocOnlyChange } from '../scripts/lib/ci-doc-only.js';

const manifest = {
  owned: ['docs/plans/', 'docs/internal/', 'docs/ops/one.md'],
  deviations: {},
};

test('only fork-owned Markdown under allowed documentation trees is light', () => {
  assert.equal(isDocOnlyChange(['docs/plans/next.md'], manifest), true);
  assert.equal(
    isDocOnlyChange(
      ['docs/plans/next.md', 'docs/internal/runbook.md'],
      manifest,
    ),
    true,
  );
  assert.equal(isDocOnlyChange(['docs/ops/one.md'], manifest), true);
  for (const paths of [
    [],
    ['docs/reference/api.md'],
    ['docs/ops/two.md'],
    ['docs/plans/data.json'],
    ['custom/fork.json'],
    ['.github/workflows/ci.yml'],
    ['tests/ci-doc-only.test.js'],
    ['docs/plans/next.md', 'server/server.js'],
    ['docs/plans/next.md', 'custom/fork.json'],
  ]) {
    assert.equal(isDocOnlyChange(paths, manifest), false, paths.join(', '));
  }
});

test('a manifest cannot turn arbitrary code paths into documentation', () => {
  assert.equal(
    isDocOnlyChange(['tests/fork-docs.test.js'], {
      owned: ['tests/fork-docs.test.js'],
      deviations: {},
    }),
    false,
  );
});
