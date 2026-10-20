import { isForkOwned } from './fork-manifest.js';

// Only Markdown in fork-owned documentation trees can take the short route.
// Other documents can carry contracts that are exercised by the full suite.
const DOC_TREES = [
  'docs/admin/',
  'docs/internal/',
  'docs/ops/',
  'docs/plans/',
  'docs/reports/',
];

/**
 * Decide whether every changed path is a fork document. The caller supplies
 * both sides of renames (git diff --no-renames), so moving code into a doc tree
 * cannot hide a code change. An empty or uncertain diff takes the full route.
 *
 * @param {string[]} paths
 * @param {import('./fork-manifest.js').ForkManifest} manifest
 */
export function isDocOnlyChange(paths, manifest) {
  return (
    paths.length > 0 &&
    paths.every(
      (rel) =>
        DOC_TREES.some((tree) => rel.startsWith(tree)) &&
        rel.endsWith('.md') &&
        isForkOwned(manifest, rel),
    )
  );
}
