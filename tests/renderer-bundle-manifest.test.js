/**
 * The manifest is canonical, and the hash is the content (T1.1).
 *
 * A render bundle's identity is the SHA-256 of its manifest bytes. That only
 * means something if two honest implementations serialise the same manifest to
 * the same bytes, so the serialisation is defined in one module and pinned here
 * with vectors: key order, file order, the trailing newline, and what is
 * deliberately *not* in the hash.
 *
 * Why it matters beyond tidiness: `rendererVersion` and `sourceCommit` sitting
 * inside the hash would make a bundle rebuilt from the same sources on another
 * day a different renderer, and a published edition would then name a renderer
 * nobody can reproduce. The brief says it in one line - the hash is the
 * identity, version and commit are provenance - and these are the assertions
 * behind it.
 *
 * Run with: node --test tests/renderer-bundle-manifest.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RENDERER_BUNDLE_SCHEMA,
  canonicalManifestBytes,
  isRendererHash,
  rendererHashFor,
  sha256Hex,
  sriFromSha256Hex,
} from '../server/render/renderer-bundle/manifest.js';

const FILE_A = {
  path: 'b/second.js',
  sha256: 'a'.repeat(64),
  bytes: 2,
};
const FILE_B = {
  path: 'a/first.js',
  sha256: 'b'.repeat(64),
  bytes: 1,
};

function manifest(overrides = {}) {
  return {
    schema: RENDERER_BUNDLE_SCHEMA,
    entry: 'entry.js',
    worker: 'worker.js',
    files: [FILE_A, FILE_B],
    unsealed: [],
    ...overrides,
  };
}

test('the canonical form is minified JSON with a declared key order', () => {
  const bytes = canonicalManifestBytes(manifest());
  assert.equal(
    bytes.toString('utf8'),
    `{"schema":"${RENDERER_BUNDLE_SCHEMA}","entry":"entry.js","worker":"worker.js",` +
      `"files":[{"path":"a/first.js","sha256":"${'b'.repeat(64)}","bytes":1},` +
      `{"path":"b/second.js","sha256":"${'a'.repeat(64)}","bytes":2}],` +
      `"unsealed":[]}\n`,
  );
});

test('file order in the input does not change the bytes', () => {
  assert.deepEqual(
    canonicalManifestBytes(manifest({ files: [FILE_A, FILE_B] })),
    canonicalManifestBytes(manifest({ files: [FILE_B, FILE_A] })),
  );
});

test('key order in a file entry does not change the bytes', () => {
  const reordered = { bytes: 1, sha256: 'b'.repeat(64), path: 'a/first.js' };
  assert.deepEqual(
    canonicalManifestBytes(manifest({ files: [FILE_A, reordered] })),
    canonicalManifestBytes(manifest()),
  );
});

test('an unsealed edge is part of the identity', () => {
  const withEdge = manifest({
    unsealed: [{ specifier: 'jsdom', importer: 'x.js', kind: 'dynamic' }],
  });
  assert.notEqual(
    rendererHashFor(withEdge).rendererHash,
    rendererHashFor(manifest()).rendererHash,
    'a bundle that carries an unsealed import is not the same renderer as one that does not',
  );
});

test('two names for the same file is a build error, not a silent dedupe', () => {
  assert.throws(
    () => canonicalManifestBytes(manifest({ files: [FILE_A, FILE_A] })),
    /duplicate path/,
  );
});

test('provenance fields are not part of the hash', () => {
  const plain = rendererHashFor(manifest()).rendererHash;
  const withProvenance = rendererHashFor({
    ...manifest(),
    // A caller that puts these in the object anyway must not change the
    // identity: the canonical form writes the five declared keys and no more.
    rendererVersion: '1.87.0',
    sourceCommit: 'c'.repeat(40),
    builtAt: '2026-10-22T00:00:00.000Z',
  }).rendererHash;
  assert.equal(withProvenance, plain);
});

test('the hash is the digest of exactly those bytes', () => {
  const { rendererHash, bytes } = rendererHashFor(manifest());
  assert.equal(rendererHash, sha256Hex(bytes));
  assert.ok(isRendererHash(rendererHash));
});

test('only a 64-char lowercase hex digest counts as a renderer hash', () => {
  for (const bad of [
    '',
    null,
    undefined,
    'A'.repeat(64),
    'a'.repeat(63),
    'a'.repeat(65),
    `${'a'.repeat(63)}g`,
    '../../etc/passwd',
  ]) {
    assert.equal(isRendererHash(bad), false, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the SRI spelling is the same digest, not a second one', () => {
  const hex = sha256Hex('deckyard');
  assert.equal(
    sriFromSha256Hex(hex),
    `sha256-${Buffer.from(hex, 'hex').toString('base64')}`,
  );
});
