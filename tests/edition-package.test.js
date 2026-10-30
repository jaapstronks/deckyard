/**
 * The edition verification package and its offline verifier.
 *
 *   1. Fonts leave the package as hash references (D367), exactly reversibly:
 *      with the font files the stored input is rebuilt byte for byte.
 *   2. Valid bytes, corruption and chain gaps are reported apart.
 *   3. The chain refuses a mismatched predecessor, a version 1 that names
 *      one, and packages from two publications.
 *   4. The package is the same bytes on every download.
 *
 * The route-level proofs against PostgreSQL and real bundles are in
 * `tests/pg/publication-edition-reads.pgtest.js`.
 *
 * Run with: node --test tests/edition-package.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const {
  EDITION_INPUT_SCHEMA,
  buildEditionManifest,
  canonicalJsonBytes,
  sha256Hex,
} = await import('../server/render/renderer-bundle/index.js');
const {
  buildEditionPackage,
  readEditionPackage,
  verifyEditionPackages,
  withholdFonts,
} = await import('../server/export/edition-package.js');

const FONT = Buffer.from('not-really-a-woff2-but-font-bytes');
const PHOTO = Buffer.from('photo-bytes');
const SERIES = '11111111-2222-4333-8444-555555555555';

function inputBytes(title = 'Deck') {
  return canonicalJsonBytes({
    schema: EDITION_INPUT_SCHEMA,
    presentation: {
      title,
      slides: [
        {
          id: 's1',
          type: 'image-slide',
          content: {
            image: `data:image/png;base64,${PHOTO.toString('base64')}`,
          },
        },
      ],
    },
    theme: { label: 'T' },
    css: {
      fontCss: `@font-face{font-family:"F";src:url("data:font/woff2;base64,${FONT.toString('base64')}") format("woff2")}`,
    },
    metaDescription: '',
    canonicalUrl: '',
  });
}

/** An edition record plus bytes, as `getPublicEdition` returns it. */
function edition(version, previous = null, title = `Deck ${version}`) {
  const bytes = inputBytes(title);
  const manifestBytes = canonicalJsonBytes(buildEditionManifest(bytes));
  return {
    id: `e${version}`,
    publicationId: SERIES,
    version,
    rendererHash: 'a'.repeat(64),
    manifestHash: sha256Hex(manifestBytes),
    previousManifestHash: previous?.manifestHash ?? null,
    publishedAt: `2026-10-0${version}T10:00:00.000Z`,
    inputBytes: bytes,
    manifestBytes,
  };
}

async function packageOf(ed) {
  return {
    name: `v${ed.version}`,
    ...(await readEditionPackage(await buildEditionPackage(ed))),
  };
}

test('fonts leave the package as hashes, and come back byte for byte', async () => {
  const ed = edition(1);
  const { bytes, withheld } = withholdFonts(ed.inputBytes);
  assert.deepEqual(withheld, [
    { sha256: sha256Hex(FONT), mediaType: 'font/woff2' },
  ]);
  assert.equal(bytes.indexOf(FONT.toString('base64')), -1);
  assert.notEqual(bytes.indexOf(PHOTO.toString('base64')), -1, 'images stay');

  const pkg = await packageOf(ed);
  assert.ok(pkg.inputBytes.equals(bytes));
  assert.ok(pkg.manifestBytes.equals(ed.manifestBytes));

  const partial = verifyEditionPackages([pkg]);
  assert.equal(partial.ok, true);
  assert.equal(partial.packages[0].inputHashChecked, false);
  assert.deepEqual(partial.packages[0].withheld, [
    { sha256: sha256Hex(FONT), mediaType: 'font/woff2', bytes: FONT.length },
  ]);

  const full = verifyEditionPackages([pkg], { fonts: [FONT] });
  assert.equal(full.ok, true);
  assert.equal(full.packages[0].inputHashChecked, true);
  assert.deepEqual(full.packages[0].withheld, []);

  const wrongFont = verifyEditionPackages([pkg], {
    fonts: [Buffer.from('other')],
  });
  assert.equal(wrongFont.packages[0].inputHashChecked, false, 'unmatched font');
});

test('a font media type is withheld verbatim, so the rebuild is exact', async () => {
  const bytes = canonicalJsonBytes({
    ...JSON.parse(inputBytes().toString('utf8')),
    css: {
      fontCss: `@font-face{src:url("data:Font/WOFF2;base64,${FONT.toString('base64')}")}`,
    },
  });
  const manifestBytes = canonicalJsonBytes(buildEditionManifest(bytes));
  const ed = {
    ...edition(1),
    inputBytes: bytes,
    manifestBytes,
    manifestHash: sha256Hex(manifestBytes),
  };
  assert.deepEqual(withholdFonts(bytes).withheld, [
    { sha256: sha256Hex(FONT), mediaType: 'Font/WOFF2' },
  ]);
  const full = verifyEditionPackages([await packageOf(ed)], { fonts: [FONT] });
  assert.equal(full.ok, true);
  assert.equal(full.packages[0].inputHashChecked, true);
});

test('an input without fonts ships unchanged', () => {
  const plain = canonicalJsonBytes({
    schema: EDITION_INPUT_SCHEMA,
    presentation: { slides: [] },
    css: { fontCss: '' },
  });
  assert.ok(withholdFonts(plain).bytes.equals(plain));
});

test('two downloads of one edition are the same bytes', async () => {
  const ed = edition(1);
  assert.ok(
    (await buildEditionPackage(ed)).equals(await buildEditionPackage(ed)),
  );
});

test('corruption, a gap and a mismatch are three different findings', async () => {
  const e1 = edition(1);
  const e2 = edition(2, e1);
  const e3 = edition(3, e2);
  const [p1, p2, p3] = await Promise.all([e1, e2, e3].map(packageOf));

  const all = verifyEditionPackages([p3, p1, p2], { fonts: [FONT] });
  assert.equal(all.ok, true);
  assert.deepEqual(all.chain, { complete: true, missing: [], mismatched: [] });

  const gap = verifyEditionPackages([p1, p3]);
  assert.ok(gap.packages.every((p) => p.valid));
  assert.deepEqual(gap.chain.missing, [
    { version: 2, manifestHash: e2.manifestHash },
  ]);
  assert.deepEqual(gap.chain.mismatched, []);
  assert.equal(gap.ok, false);

  // One flipped byte in the deck: the bytes are corrupt, the chain is not.
  const bad = Buffer.from(p2.inputBytes);
  bad[bad.indexOf('Deck 2') + 5] = '9'.charCodeAt(0);
  const corrupt = verifyEditionPackages([p1, { ...p2, inputBytes: bad }, p3]);
  assert.equal(corrupt.packages[1].valid, false);
  assert.deepEqual(
    corrupt.packages[1].problems.map((p) => p.code),
    ['content_hash_mismatch'],
  );
  assert.equal(corrupt.chain.complete, true);

  // A manifest swapped for another edition's: the record no longer names it.
  const swapped = verifyEditionPackages([
    { ...p2, manifestBytes: p1.manifestBytes },
  ]);
  assert.ok(
    swapped.packages[0].problems.some(
      (p) => p.code === 'manifest_hash_mismatch',
    ),
  );

  // A v2 that names another predecessor than the v1 supplied.
  const other1 = await packageOf(edition(1, null, 'Another v1'));
  const mismatch = verifyEditionPackages([other1, p2]);
  assert.equal(mismatch.chain.complete, false);
  assert.equal(mismatch.chain.mismatched.length, 1);
  assert.equal(mismatch.chain.mismatched[0].version, 2);
});

test('the chain refuses a version 1 with a predecessor and mixed series', async () => {
  const e1 = edition(1);
  const forged = { ...edition(1), previousManifestHash: e1.manifestHash };
  const r = verifyEditionPackages([await packageOf(forged)]);
  assert.equal(r.chain.mismatched[0].version, 1);

  const elsewhere = {
    ...edition(2, e1),
    publicationId: '99999999-2222-4333-8444-555555555555',
  };
  const mixed = verifyEditionPackages([
    await packageOf(e1),
    await packageOf(elsewhere),
  ]);
  assert.ok(
    mixed.chain.mismatched.some((m) =>
      /different publications/.test(m.message),
    ),
  );
});

test('a package without one of its files is incomplete', async () => {
  const pkg = await packageOf(edition(1));
  const r = verifyEditionPackages([{ ...pkg, inputBytes: null }]);
  assert.equal(r.packages[0].valid, false);
  assert.deepEqual(
    r.packages[0].problems.map((p) => p.code),
    ['package_incomplete'],
  );
});
