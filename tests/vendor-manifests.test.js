import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  PRISM_BASE_COMPONENTS,
  PRISM_LANGUAGE_COMPONENTS,
} from '../shared/prism-languages.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const vendorDir = path.join(repoRoot, 'client', 'vendor');

/**
 * Every vendor manifest that records per-file sha256 hashes must match the
 * checked-in blobs byte for byte — the machine-verifiable pin that
 * google-fonts.lock.json already gives the fonts. A mismatch means someone
 * edited a vendored file by hand (or a vendor script changed without being
 * re-run): re-run `npm run vendor:dompurify` / `npm run vendor:prism-katex` /
 * `npm run vendor:pdfjs`.
 */
const HASHED_MANIFESTS = ['dompurify', 'prism', 'katex', 'pdfjs'];

for (const name of HASHED_MANIFESTS) {
  test(`client/vendor/${name} matches its manifest hashes`, async () => {
    const dir = path.join(vendorDir, name);
    const manifest = JSON.parse(
      await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'),
    );
    assert.ok(manifest.version, 'manifest records the vendored version');
    assert.ok(
      Array.isArray(manifest.files) && manifest.files.length > 0,
      'manifest lists the vendored files',
    );
    for (const entry of manifest.files) {
      assert.match(
        entry.sha256 ?? '',
        /^[0-9a-f]{64}$/,
        `${name}/${entry.path} has a sha256 in the manifest`,
      );
      const buf = await fs.readFile(path.join(dir, entry.path));
      assert.equal(
        createHash('sha256').update(buf).digest('hex'),
        entry.sha256,
        `${name}/${entry.path} differs from its manifest hash`,
      );
    }
  });
}

test('every component the language map resolves to is vendored', async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(vendorDir, 'prism', 'manifest.json'), 'utf8'),
  );
  const vendored = new Set(manifest.files.map((f) => f.path));
  const needed = new Set([
    'components/prism-core.min.js',
    ...[
      ...PRISM_BASE_COMPONENTS,
      ...Object.values(PRISM_LANGUAGE_COMPONENTS).flat(),
    ].map((c) => `components/prism-${c}.min.js`),
  ]);
  for (const file of needed) {
    assert.ok(
      vendored.has(file),
      `${file} is in shared/prism-languages.js but not vendored — re-run \`npm run vendor:prism-katex\``,
    );
  }
});
