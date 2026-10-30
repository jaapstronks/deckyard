/**
 * The edition-input preparer (T1.2): one deck, sealed into bytes a render
 * bundle can read alone.
 *
 * What is pinned, per acceptance line of `publication-records.md` § T1.2:
 *
 *   1. Notes, AI review fields, hidden slides and private deck metadata are
 *      absent in every language *and* in the raw bytes.
 *   2. The theme is copied by value; every served ref becomes a data URL and
 *      appears in the manifest's asset inventory.
 *   3. Unsealable dependencies (unknown type, live embed, remote image,
 *      external font service, unreadable asset, foreign or unreadable font,
 *      oversize) are refused together, as a list.
 *   4. Uploaded fonts of the deck's own organization are inlined; another
 *      organization's are refused.
 *   5. A source changed after preparation started does not reach the input.
 *   6. One flipped byte turns verification red.
 *   7. The bundle's render entry renders the sealed input.
 *
 * Run with: node --test tests/edition-input.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 't1-2-edition-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.UPLOADS_DIR = path.join(tmp, 'uploads');
process.env.MEDIA_STORAGE_MODE = 'local';
// The live page downsamples through sharp; these fixtures are not real images,
// and the sealing is what is under test, not the compression.
process.env.EXPORT_IMAGE_COMPRESSION = 'false';
process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
delete process.env.MULTI_ORG_ENABLED;

const ORG = process.env.DEFAULT_ORGANIZATION_ID;
const repoRoot = process.cwd();

const { createMockStreamRes } = await import('./helpers/http-mocks.js');
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage } = await import('../server/db/lifecycle.js');
const { createStorageScope } = await import('../server/utils/context.js');
const { handleFontFamilies } =
  await import('../server/routes/api/font-families.js');
const { initializeMediaProvider } = await import('../server/media/index.js');
const { prepareEditionInput } =
  await import('../server/export/edition-input.js');
const {
  EDITION_MANIFEST_SCHEMA,
  canonicalJson,
  canonicalJsonBytes,
  verifyEditionInput,
} = await import('../server/render/renderer-bundle/index.js');
const { sha256Hex, RUNNER_REQUEST_LIMIT } =
  await import('../server/render/renderer-bundle/index.js');
const { renderEdition } =
  await import('../server/render/renderer-bundle/bundle/entry.js');

const DESIGNER = {
  email: 'designer@example.com',
  name: 'Dana Designer',
  organizationId: ORG,
  isDesigner: true,
};
const scope = () => createStorageScope(DESIGNER, { repoRoot });

const PNG = Buffer.from('not-really-a-png-but-distinct-t1-2');
const LOGO = Buffer.from('logo-bytes-t1-2');
const FONT_BYTES = Buffer.concat([
  Buffer.from([0x77, 0x4f, 0x46, 0x32]),
  Buffer.from('licensed-glyph-outlines-t1-2'),
]);

const SECRET = {
  notes: 'Zarquon-speaker-note',
  ai: 'Zarquon-ai-reasoning',
  hidden: 'Zarquon-hidden-slide',
  source: 'Zarquon-translation-source',
  collaborator: 'zarquon-collaborator@example.com',
};

function seed() {
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'D', slug: 'd' }],
      users: [
        {
          id: 'user-designer',
          organization_id: ORG,
          email: DESIGNER.email,
          name: DESIGNER.name,
          role: 'user',
          auth_source: 'database',
          settings: {},
          created_at: '2026-01-01T00:00:00.000Z',
          updated_at: '2026-01-01T00:00:00.000Z',
        },
      ],
      font_families: [],
      font_variants: [],
    }),
  );
}

test.before(async () => {
  seed();
  await initializeStorage();
  await initializeMediaProvider(repoRoot);
  await fs.mkdir(process.env.UPLOADS_DIR, { recursive: true });
  await fs.writeFile(path.join(process.env.UPLOADS_DIR, 'photo-1.png'), PNG);
  await fs.writeFile(path.join(process.env.UPLOADS_DIR, 'logo-1.png'), LOGO);
});

test.after(async () => {
  __setTestDb(null);
  await fs.rm(tmp, { recursive: true, force: true });
});

/** A deck with something private in every place a reader must not see. */
function deck() {
  const slides = () => [
    {
      id: 's1',
      type: 'title-slide',
      content: { title: 'Public title', subheading: 'Public sub' },
      notes: SECRET.notes,
      _aiReasoning: SECRET.ai,
    },
    {
      id: 's2',
      type: 'image-slide',
      content: {
        title: 'Photo',
        image: '/uploads/photo-1.png',
        alt: 'A photo',
      },
    },
    {
      id: 's3',
      type: 'content-slide',
      content: { title: SECRET.hidden, body: SECRET.hidden },
      visibility: { hideInPublished: true },
    },
  ];
  return {
    id: 'deck-private-id',
    title: 'Edition deck',
    description: 'A deck to seal',
    lang: 'en',
    theme: 'default',
    collaborators: [{ email: SECRET.collaborator }],
    published: { id: 'abcd1234', slug: 'edition-deck' },
    slides: slides(),
    i18n: {
      active: 'en',
      dominant: 'en',
      versions: {
        nl: {
          title: 'Editie-deck',
          slides: slides(),
          translationSources: { s1: SECRET.source },
        },
      },
    },
  };
}

const THEME = {
  id: 'theme-uuid-private',
  organizationId: ORG,
  label: 'House',
  cssVars: {
    '--t-accent': '#13393a',
    '--t-logo-url': "url('/uploads/logo-1.png')",
  },
  assets: { logo: '/uploads/logo-1.png' },
};

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    assert.equal(err.code, 'renderer_edition_input_unsealable');
    return err.details.problems;
  }
  assert.fail('expected the preparation to be refused');
}

test('canonical JSON sorts keys at every depth and refuses what JSON cannot say', () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: [2, 'x'], c: null } }),
    '{"a":{"c":null,"d":[2,"x"]},"b":1}',
  );
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(canonicalJsonBytes({}).toString(), '{}\n');
  assert.throws(() => canonicalJson({ a: Number.NaN }), /non-finite/);
  assert.throws(() => canonicalJson([undefined]), /undefined/);
});

test('the sealed input carries no author material, in any language or byte', async () => {
  seed();
  const { inputBytes } = await prepareEditionInput(repoRoot, deck(), {
    scope: scope(),
    theme: THEME,
  });
  const raw = inputBytes.toString('utf8');
  for (const value of Object.values(SECRET)) {
    assert.ok(!raw.includes(value), `${value} leaked into the input bytes`);
  }
  for (const leak of [
    'deck-private-id',
    'theme-uuid-private',
    ORG,
    'abcd1234',
  ]) {
    assert.ok(!raw.includes(leak), `${leak} leaked into the input bytes`);
  }
  const input = JSON.parse(raw);
  assert.equal(input.presentation.slides.length, 2);
  assert.equal(input.presentation.i18n.versions.nl.slides.length, 2);
  assert.equal(input.presentation.i18n.versions.nl.title, 'Editie-deck');
  assert.deepEqual(Object.keys(input.presentation).sort(), [
    'description',
    'i18n',
    'lang',
    'slides',
    'title',
  ]);
});

test('every served ref, in every language and the theme, becomes an inventoried data URL', async () => {
  seed();
  const { inputBytes, manifest } = await prepareEditionInput(repoRoot, deck(), {
    scope: scope(),
    theme: THEME,
  });
  const raw = inputBytes.toString('utf8');
  assert.ok(!raw.includes('/uploads/'), 'no served path survives');
  const input = JSON.parse(raw);
  const photo = `data:image/png;base64,${PNG.toString('base64')}`;
  assert.equal(input.presentation.slides[1].content.image, photo);
  assert.equal(
    input.presentation.i18n.versions.nl.slides[1].content.image,
    photo,
  );
  assert.match(
    input.theme.cssVars['--t-logo-url'],
    /^url\('data:image\/png;base64,/,
  );
  assert.equal(
    input.theme.assets.logo.startsWith('data:image/png;base64,'),
    true,
  );
  assert.equal(input.theme.label, 'House');

  assert.equal(manifest.schema, EDITION_MANIFEST_SCHEMA);
  assert.deepEqual(
    manifest.assets.map((a) => a.sha256).sort(),
    [sha256Hex(PNG), sha256Hex(LOGO)].sort(),
  );
  assert.equal(manifest.input.sha256, sha256Hex(inputBytes));
});

test('unsealable dependencies are refused together, as one list', async () => {
  seed();
  const pres = deck();
  pres.slides.push(
    { id: 'x1', type: 'org-db-type', content: { title: 'Custom' } },
    {
      id: 'x2',
      type: 'embed-slide',
      content: { embedUrl: 'https://example.com/live' },
    },
    {
      id: 'x3',
      type: 'image-slide',
      content: { image: 'https://cdn.example.com/a.png', alt: 'a' },
    },
    {
      id: 'x4',
      type: 'image-slide',
      content: { image: '/uploads/missing-9.png', alt: 'b' },
    },
  );
  const problems = await refusal(
    prepareEditionInput(repoRoot, pres, {
      scope: scope(),
      theme: {
        ...THEME,
        externalFontLinks: [
          { type: 'css', url: 'https://use.typekit.net/x.css' },
        ],
      },
    }),
  );
  const reasons = new Set(problems.map((p) => p.reason));
  for (const r of [
    'unknown_slide_type',
    'live_embed',
    'remote_resource',
    'asset_unreadable',
    'external_font',
  ]) {
    assert.ok(reasons.has(r), `missing ${r} in ${[...reasons]}`);
  }
  // Located by slide id: a position in the published list would not match
  // the editor's numbering once a hidden slide is left out.
  const embed = problems.find((p) => p.reason === 'live_embed');
  assert.deepEqual([embed.lang, embed.slideId], [null, 'x2']);
  const nl = problems.filter((p) => p.lang === 'nl');
  assert.deepEqual(nl, [], 'the nl version has none of the added slides');
});

test('an input over the renderer limit is refused before it is sealed', async () => {
  seed();
  const big = path.join(process.env.UPLOADS_DIR, 'big-1.png');
  await fs.writeFile(
    big,
    Buffer.alloc(Math.ceil((RUNNER_REQUEST_LIMIT * 3) / 4) + 1024, 7),
  );
  const pres = deck();
  pres.slides[1].content.image = '/uploads/big-1.png';
  delete pres.i18n;
  const problems = await refusal(
    prepareEditionInput(repoRoot, pres, { scope: scope(), theme: THEME }),
  );
  assert.deepEqual(
    problems.map((p) => p.reason),
    ['too_large'],
  );
  await fs.rm(big);
});

test('an edition is sealed against its effective theme, never without one', async () => {
  await assert.rejects(
    prepareEditionInput(repoRoot, deck(), { scope: scope(), theme: null }),
    TypeError,
  );
});

test('a change to the source after preparation started does not reach the input', async () => {
  seed();
  const pres = deck();
  const theme = structuredClone(THEME);
  const pending = prepareEditionInput(repoRoot, pres, {
    scope: scope(),
    theme,
  });
  pres.slides[0].content.title = 'Changed after publish was pressed';
  pres.i18n.versions.nl.slides[0].content.title = 'Later gewijzigd';
  theme.cssVars['--t-accent'] = '#ff0000';
  const raw = (await pending).inputBytes.toString('utf8');
  assert.ok(raw.includes('Public title'));
  assert.ok(!raw.includes('Changed after publish'));
  assert.ok(!raw.includes('Later gewijzigd'));
  assert.ok(raw.includes('#13393a') && !raw.includes('#ff0000'));
});

test('verification is green for the package and red for one flipped byte anywhere', async () => {
  seed();
  const { inputBytes, manifestBytes } = await prepareEditionInput(
    repoRoot,
    deck(),
    {
      scope: scope(),
      theme: THEME,
    },
  );
  assert.deepEqual(verifyEditionInput({ manifestBytes, inputBytes }), {
    ok: true,
    problems: [],
  });

  const flip = (buf, at) => {
    const out = Buffer.from(buf);
    out[at] ^= 0x01;
    return out;
  };
  for (const at of [
    0,
    Math.floor(inputBytes.length / 2),
    inputBytes.length - 2,
  ]) {
    const r = verifyEditionInput({
      manifestBytes,
      inputBytes: flip(inputBytes, at),
    });
    assert.equal(r.ok, false, `input byte ${at}`);
    assert.equal(r.problems[0].code, 'input_hash_mismatch');
  }
  for (let at = 0; at < manifestBytes.length; at += 97) {
    const r = verifyEditionInput({
      manifestBytes: flip(manifestBytes, at),
      inputBytes,
    });
    assert.equal(r.ok, false, `manifest byte ${at}`);
  }

  // A manifest re-serialised by another writer is named as such.
  const pretty = Buffer.from(
    JSON.stringify(JSON.parse(manifestBytes), null, 2),
  );
  assert.deepEqual(
    verifyEditionInput({ manifestBytes: pretty, inputBytes }).problems.map(
      (p) => p.code,
    ),
    ['manifest_not_canonical'],
  );
});

async function api(method, pathname, body) {
  const payload = JSON.stringify(body);
  const req = {
    method,
    headers: { host: 'decks.example.test', 'content-type': 'application/json' },
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(payload, 'utf8');
    },
  };
  const res = createMockStreamRes();
  await handleFontFamilies({
    repoRoot,
    storageScope: scope(),
    req,
    res,
    url: new URL(`http://decks.example.test${pathname}`),
    authedUser: DESIGNER,
  });
  return res;
}

async function uploadVariant() {
  const family = await api('POST', '/api/font-families', {
    name: 'Licensed Sans',
    source: 'upload',
  });
  assert.equal(family.statusCode, 201);
  const up = await api(
    'POST',
    `/api/font-families/${family.json().id}/upload-variant`,
    {
      dataUrl: `data:font/woff2;base64,${FONT_BYTES.toString('base64')}`,
      weight: 400,
      style: 'normal',
      format: 'woff2',
    },
  );
  assert.equal(up.statusCode, 201, JSON.stringify(up.json()));
  return up.json();
}

test("the organization's own uploaded font is inlined; its address is not", async () => {
  seed();
  const variant = await uploadVariant();
  const { inputBytes, manifest } = await prepareEditionInput(repoRoot, deck(), {
    scope: scope(),
    theme: {
      ...THEME,
      embedFonts: [{ family: 'Licensed Sans', url: variant.url, weight: 400 }],
    },
  });
  const raw = inputBytes.toString('utf8');
  assert.ok(raw.includes(FONT_BYTES.toString('base64')));
  assert.ok(!raw.includes('/fonts/managed/'));
  assert.ok(manifest.assets.some((a) => a.sha256 === sha256Hex(FONT_BYTES)));
});

test("another organization's uploaded font is refused, and so is an unreadable one", async () => {
  seed();
  const variant = await uploadVariant();
  // A fresh database: the object is still in storage, but no family of this
  // organization names it any more.
  seed();
  const foreign = await refusal(
    prepareEditionInput(repoRoot, deck(), {
      scope: scope(),
      theme: {
        ...THEME,
        embedFonts: [{ family: 'Licensed Sans', url: variant.url }],
      },
    }),
  );
  assert.deepEqual(
    foreign.map((p) => p.reason),
    ['foreign_font'],
  );

  const missing = await refusal(
    prepareEditionInput(repoRoot, deck(), {
      scope: scope(),
      theme: {
        ...THEME,
        embedFonts: [
          { family: 'Pinned Serif', path: 'assets/fonts/does-not-exist.woff2' },
        ],
      },
    }),
  );
  assert.deepEqual(
    missing.map((p) => p.reason),
    ['font_unreadable'],
  );
});

test('the render entry renders the sealed input, canvas and reader', async () => {
  seed();
  const { inputBytes } = await prepareEditionInput(repoRoot, deck(), {
    scope: scope(),
    theme: THEME,
    canonicalUrl: 'https://example.test/p/series/1',
  });
  const { canvas, reader } = await renderEdition(
    repoRoot,
    JSON.parse(inputBytes),
  );
  assert.ok(canvas.includes('Public title'));
  assert.ok(reader.includes('Public title'));
  assert.ok(!canvas.includes('/uploads/'));
  assert.ok(!canvas.includes(SECRET.hidden));
});
