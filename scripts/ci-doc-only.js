/** Classify a GitHub Actions diff. Errors deliberately keep the full CI route. */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readForkManifest } from './lib/fork-manifest.js';
import { isDocOnlyChange } from './lib/ci-doc-only.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const [base, head] = process.argv.slice(2);
let docOnly = false;
try {
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head)) {
    throw new Error('missing or invalid commit SHA');
  }
  const changed = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', base, head],
    { cwd: root },
  )
    .toString('utf8')
    .split('\0')
    .filter(Boolean);
  docOnly = isDocOnlyChange(changed, readForkManifest(root));
  console.log(`${changed.length} changed paths; doc-only: ${docOnly}`);
} catch (error) {
  console.warn(`Cannot classify diff: ${error.message}; running full CI`);
}
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `doc_only=${docOnly}\n`);
}
