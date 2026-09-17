/**
 * Database slide types travel in the `.deck` bundle (B251, D91).
 *
 * Two organizations in one fake database stand in for two instances: the
 * sender owns a published database type, the receiver has never seen it. Pins:
 *
 *   - export: each database type the deck uses is `slide-types/<slug>.json`,
 *     the record without ids, listed in the manifest with its hash; a core or
 *     file-JS type carries no definition; `bundleVersion` is 3; a database
 *     type's translations travel;
 *   - import, the three paths: `canManage` + `install=slideTypes` installs it
 *     published and the slides resolve to it; `canManage` without the flag, or
 *     the flag without `canManage`, imports the placeholder that names the
 *     bundle and says `bundledSlideTypes`;
 *   - dedup: a second import reuses the installed type, a taken slug gets a
 *     suffix and never an overwrite, a not-installed type never resolves to a
 *     same-named type of the receiver, a same-instance import lands on the type
 *     it came from;
 *   - a file-JS type travels by name: the same fork resolves it, another
 *     install imports the plain placeholder;
 *   - reading: a tampered definition and a mismatched slug are refused; a
 *     version-2 bundle without slide types still reads.
 *
 * Run with: node --test tests/deck-bundle-slide-types.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { testScope, otherOrganizationScope } from './helpers/storage-scope.js';
import { userRows } from './helpers/identity-fixtures.js';

process.env.DEFAULT_ORGANIZATION_ID ||= '00000000-0000-0000-0000-0000000000aa';
const SENDER = process.env.DEFAULT_ORGANIZATION_ID;
const RECEIVER = '00000000-0000-0000-0000-0000000000bb';
const OWNER = 'owner@example.com';

const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { createCustomSlideType, listCustomSlideTypes, getCustomSlideType } =
  await import('../server/storage/custom-slide-types.js');
const { SLIDE_TYPES } = await import('../shared/slide-types/registry.js');

let tmpUploads;
let buildDeckBundle;
let readDeckBundle;
let handlePresentationsImportDeck;
let buildMergedSlideTypes;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452CCCC', 'hex');

const senderScope = () => testScope(null, { actorEmail: OWNER });
const receiverScope = () => otherOrganizationScope(null, RECEIVER);
const designer = { email: OWNER, isDesigner: true };
const member = { email: 'member@example.com' };

test.before(async () => {
  tmpUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'deckyard-types-up-'));
  process.env.UPLOADS_DIR = tmpUploads;
  fs.writeFileSync(path.join(tmpUploads, 'hero.png'), PNG);
  __setTestDb(
    createFakeDb({
      organizations: [
        { id: SENDER, name: 'Sender', slug: 'sender' },
        { id: RECEIVER, name: 'Receiver', slug: 'receiver' },
      ],
      users: userRows(OWNER),
    }),
  );
  await initializeStorage();
  ({ buildDeckBundle, readDeckBundle } =
    await import('../server/export/deck-bundle.js'));
  ({ handlePresentationsImportDeck } =
    await import('../server/routes/api/presentations/import-deck.js'));
  ({ buildMergedSlideTypes } =
    await import('../server/utils/custom-slide-type-runtime.js'));
});

test.after(() => {
  __resetStorageForTests();
  __setTestDb(null);
  fs.rmSync(tmpUploads, { recursive: true, force: true });
});

let slugCounter = 0;
/** A published type in `scope`, with a text field, an image default and CSS. */
async function publishedType(scope, overrides = {}) {
  slugCounter += 1;
  const result = await createCustomSlideType(
    scope,
    {
      label: 'Hero',
      slug: `hero-src-${slugCounter}`,
      fields: [
        { key: 'title', type: 'string', label: 'Title' },
        { key: 'image', type: 'image', label: 'Image' },
      ],
      defaults: { title: 'Hello', image: '/uploads/hero.png' },
      template: '<div class="slide"><h2>{{title}}</h2></div>',
      css: 'h2 { color: #ff0055; }',
      ...overrides,
    },
    { published: true },
  );
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.customSlideType;
}

/** A stored sender presentation with one slide of `type`, in two languages. */
const deckWith = (type) => ({
  organizationId: SENDER,
  title: 'Typed deck',
  theme: 'default',
  lang: 'en',
  slides: [{ id: 's1', type, content: { title: 'Launch' } }],
  i18n: {
    dominant: 'en',
    active: 'en',
    versions: {
      en: {
        title: 'Typed deck',
        slides: [{ id: 's1', type, content: { title: 'Launch' } }],
      },
      nl: {
        title: 'Getypt deck',
        slides: [{ id: 's1', type, content: { title: 'Lancering' } }],
      },
    },
  },
});

async function bundleFor(type) {
  return buildDeckBundle(null, deckWith(`custom-${type.slug}`), {
    slideTypes: await buildMergedSlideTypes(senderScope()),
  });
}

function fakeReq(buf) {
  return (async function* () {
    yield buf;
  })();
}

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headersSent: false,
    writableEnded: false,
    writeHead(status) {
      this.statusCode = status;
      return this;
    },
    end(payload) {
      this.body = payload;
    },
  };
}

async function importInto(
  scope,
  buf,
  { install = null, user = designer } = {},
) {
  const res = fakeRes();
  const url = new URL('http://x/api/presentations/import/deck');
  if (install) url.searchParams.set('install', install);
  await handlePresentationsImportDeck({
    repoRoot: null,
    storageScope: { ...scope, actorEmail: user.email },
    req: fakeReq(buf),
    res,
    url,
    authedUser: user,
  });
  return { res, body: res.body ? JSON.parse(res.body) : null };
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function rezip(bundle, mutate) {
  const zip = await JSZip.loadAsync(bundle);
  await mutate(zip);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('export: each database type the deck uses is its record without ids', async () => {
  const type = await publishedType(senderScope());
  const bundle = await bundleFor(type);
  const { manifest, deck, slideTypes, assets } = await readDeckBundle(bundle);

  assert.equal(manifest.bundleVersion, 3);
  const ref = `slide-types/${type.slug}.json`;
  assert.equal(manifest.slideTypes.length, 1);
  assert.equal(manifest.slideTypes[0].slug, type.slug);
  assert.equal(manifest.slideTypes[0].ref, ref);
  const zip = await JSZip.loadAsync(bundle);
  const bytes = await zip.file(ref).async('nodebuffer');
  assert.equal(manifest.slideTypes[0].hash, sha(bytes));

  const [carried] = slideTypes;
  assert.deepEqual(Object.keys(carried).sort(), [
    'baseType',
    'css',
    'defaults',
    'defaultsByLang',
    'fields',
    'label',
    'slug',
    'template',
    'usage',
  ]);
  assert.ok(!JSON.stringify(carried).includes(type.id), 'no type id');
  const imageRef = `assets/${sha(PNG)}.png`;
  assert.equal(carried.defaults.image, imageRef, 'an upload rides as an asset');
  assert.ok(assets.get(imageRef).equals(PNG));

  // The slide keeps its key, and its translation travels: the text field is
  // known through the organization's registry.
  assert.equal(deck.slides[0].type, `custom-${type.slug}`);
  assert.deepEqual(deck.slides[0].translations, {
    nl: { title: 'Lancering' },
  });
});

test('export: a core type carries no definition', async () => {
  const bundle = await buildDeckBundle(null, deckWith('content-slide'));
  const { manifest, slideTypes } = await readDeckBundle(bundle);
  assert.equal(manifest.slideTypes, undefined);
  assert.deepEqual(slideTypes, []);
});

test('import with canManage + install=slideTypes installs it and the slides resolve', async () => {
  const type = await publishedType(senderScope());
  const { res, body } = await importInto(
    receiverScope(),
    await bundleFor(type),
    { install: 'slideTypes' },
  );
  assert.equal(res.statusCode, 201, res.body);
  const [report] = body.bundledSlideTypes;
  assert.equal(report.status, 'installed');
  assert.equal(report.slug, type.slug);
  assert.equal(report.label, 'Hero');

  const installed = await getCustomSlideType(receiverScope(), report.typeId);
  assert.ok(installed, 'the type lives in the receiving organization');
  assert.notEqual(installed.id, type.id);
  assert.equal(installed.isPublished, true);
  assert.equal(installed.template, type.template);
  assert.ok(installed.defaults.image.startsWith('/uploads/'));

  assert.equal(body.slides[0].type, `custom-${installed.slug}`);
  assert.equal(body.slides[0].content.title, 'Launch');
  assert.equal(body.i18n.versions.nl.slides[0].content.title, 'Lancering');
});

test('a second import of the same bundle makes no second type', async () => {
  const type = await publishedType(senderScope(), { label: 'Twice' });
  const bundle = await bundleFor(type);
  const first = await importInto(receiverScope(), bundle, {
    install: 'slideTypes',
  });
  const before = (await listCustomSlideTypes(receiverScope())).length;

  const second = await importInto(receiverScope(), bundle, {
    install: 'slideTypes',
  });
  const [report] = second.body.bundledSlideTypes;
  assert.equal(report.status, 'existing');
  assert.equal(report.typeId, first.body.bundledSlideTypes[0].typeId);
  assert.equal((await listCustomSlideTypes(receiverScope())).length, before);
  assert.equal(second.body.slides[0].type, first.body.slides[0].type);
});

test('canManage without install imports the placeholder that names the bundle', async () => {
  const type = await publishedType(senderScope(), { label: 'Not asked' });
  const before = (await listCustomSlideTypes(receiverScope())).length;

  const { res, body } = await importInto(
    receiverScope(),
    await bundleFor(type),
  );
  assert.equal(res.statusCode, 201, res.body);
  assert.deepEqual(body.bundledSlideTypes, [
    {
      slug: type.slug,
      label: 'Not asked',
      status: 'not-installed',
      reason: 'install-not-requested',
    },
  ]);
  const [slide] = body.slides;
  assert.equal(slide.type, 'content-slide');
  assert.match(slide.content.body, new RegExp(`custom-${type.slug}`));
  assert.match(slide.content.body, /definition is in the \.deck bundle/);
  assert.equal((await listCustomSlideTypes(receiverScope())).length, before);
});

test('install without canManage imports the placeholder', async () => {
  const type = await publishedType(senderScope(), { label: 'Not permitted' });
  const { res, body } = await importInto(
    receiverScope(),
    await bundleFor(type),
    { install: 'slideTypes', user: member },
  );
  assert.equal(res.statusCode, 201, res.body);
  assert.equal(body.bundledSlideTypes[0].status, 'not-installed');
  assert.equal(body.bundledSlideTypes[0].reason, 'not-permitted');
  assert.equal(body.slides[0].type, 'content-slide');
});

test('a taken slug gets a suffix, never an overwrite or a borrowed type', async () => {
  const type = await publishedType(senderScope(), {
    label: 'Clash',
    slug: 'clash',
  });
  const squatter = await publishedType(receiverScope(), {
    label: 'Something else',
    slug: 'clash',
    template: '<div class="slide">other</div>',
  });
  const bundle = await bundleFor(type);

  // Not installed: the slide does not borrow the receiver's `custom-clash`.
  const refused = await importInto(receiverScope(), bundle);
  assert.equal(refused.body.slides[0].type, 'content-slide');

  const first = await importInto(receiverScope(), bundle, {
    install: 'slideTypes',
  });
  const [report] = first.body.bundledSlideTypes;
  assert.equal(report.status, 'installed');
  const installed = await getCustomSlideType(receiverScope(), report.typeId);
  assert.equal(installed.slug, 'clash-2');
  assert.equal(first.body.slides[0].type, 'custom-clash-2');
  const kept = await getCustomSlideType(receiverScope(), squatter.id);
  assert.equal(kept.template, '<div class="slide">other</div>');

  const again = await importInto(receiverScope(), bundle, {
    install: 'slideTypes',
  });
  assert.equal(again.body.bundledSlideTypes[0].status, 'existing');
  assert.equal(
    again.body.slides[0].type,
    'custom-clash-2',
    'slug is no content',
  );
});

test('a same-instance import lands on the type it came from', async () => {
  const type = await publishedType(senderScope(), { label: 'Home' });
  const { body } = await importInto(testScope(), await bundleFor(type), {
    user: member,
  });
  assert.equal(body.bundledSlideTypes[0].status, 'existing');
  assert.equal(body.bundledSlideTypes[0].typeId, type.id);
  assert.equal(body.slides[0].type, `custom-${type.slug}`);
});

test('a file-JS type travels by name: the same fork resolves it', async () => {
  const bundle = await buildDeckBundle(null, deckWith('acme-hero'));
  const { manifest, deck } = await readDeckBundle(bundle);
  assert.equal(manifest.slideTypes, undefined, 'code carries no definition');
  assert.equal(deck.slides[0].type, 'acme-hero');

  const elsewhere = await importInto(receiverScope(), bundle);
  assert.equal(elsewhere.body.slides[0].type, 'content-slide');
  assert.doesNotMatch(elsewhere.body.slides[0].content.body, /\.deck bundle/);
  assert.equal(elsewhere.body.bundledSlideTypes, undefined);

  SLIDE_TYPES['acme-hero'] = SLIDE_TYPES['content-slide'];
  try {
    const sameFork = await importInto(receiverScope(), bundle);
    assert.equal(sameFork.body.slides[0].type, 'acme-hero');
  } finally {
    delete SLIDE_TYPES['acme-hero'];
  }
});

test('reading refuses a tampered definition and a mismatched slug', async () => {
  const type = await publishedType(senderScope(), { label: 'Tamper' });
  const bundle = await bundleFor(type);
  const ref = `slide-types/${type.slug}.json`;

  const tampered = await rezip(bundle, (zip) => {
    zip.file(ref, JSON.stringify({ slug: type.slug, label: 'Evil' }));
  });
  await assert.rejects(
    readDeckBundle(tampered),
    /slide type .* failed its integrity check/,
  );

  const renamed = await rezip(bundle, async (zip) => {
    const json = JSON.stringify({ slug: 'other', label: 'Renamed' });
    zip.file(ref, json);
    const manifest = JSON.parse(
      await zip.file('manifest.json').async('string'),
    );
    manifest.slideTypes[0].hash = sha(Buffer.from(json, 'utf8'));
    zip.file('manifest.json', JSON.stringify(manifest));
  });
  await assert.rejects(readDeckBundle(renamed), /names another slug/);

  const moved = await rezip(bundle, async (zip) => {
    const manifest = JSON.parse(
      await zip.file('manifest.json').async('string'),
    );
    manifest.slideTypes[0].ref = '../escape.json';
    zip.file('manifest.json', JSON.stringify(manifest));
  });
  await assert.rejects(readDeckBundle(moved), /unexpected path/);
});

test('a version-2 bundle without slide types still reads', async () => {
  const bundle = await rezip(
    await buildDeckBundle(null, deckWith('content-slide')),
    async (zip) => {
      const manifest = JSON.parse(
        await zip.file('manifest.json').async('string'),
      );
      zip.file(
        'manifest.json',
        JSON.stringify({ ...manifest, bundleVersion: 2 }),
      );
    },
  );
  const read = await readDeckBundle(bundle);
  assert.equal(read.manifest.bundleVersion, 2);
  assert.deepEqual(read.slideTypes, []);
  const { res } = await importInto(receiverScope(), bundle);
  assert.equal(res.statusCode, 201, res.body);
});
