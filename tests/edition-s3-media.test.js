import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

process.env.MEDIA_STORAGE_MODE = 's3';
process.env.S3_ACCESS_KEY = 'test';
process.env.S3_SECRET_KEY = 'test';
process.env.S3_BUCKET = 'edition-test';
process.env.S3_ENDPOINT = 'https://s3.example.test';
process.env.S3_PUBLIC_URL = 'https://media.example.test/content';
process.env.EXPORT_IMAGE_COMPRESSION = 'false';

const { initializeMediaProvider, getMediaProvider } =
  await import('../server/media/index.js');
const { editionUploadKey } = await import('../server/export/edition-media.js');
const { prepareEditionInput } =
  await import('../server/export/edition-input.js');
const { renderEdition } =
  await import('../server/render/renderer-bundle/bundle/entry.js');
const { verifyEditionInput } =
  await import('../server/render/renderer-bundle/index.js');

await initializeMediaProvider(process.cwd());
const provider = getMediaProvider();
const BASE = process.env.S3_PUBLIC_URL;
const PHOTO = Buffer.from('sealed-s3-image-bytes');
const DATA = `data:image/png;base64,${PHOTO.toString('base64')}`;

function deck(image = `${BASE}/uploads/2026/10/photo.png`) {
  return {
    title: 'S3 edition',
    lang: 'en',
    slides: [
      {
        id: 'photo',
        type: 'image-slide',
        content: { title: 'Photo', image, alt: 'Photo' },
      },
    ],
  };
}

test('only public uploads under the exact configured bucket/CDN base resolve', () => {
  assert.equal(
    editionUploadKey(`${BASE}/uploads/2026/10/a%20b.png`),
    'uploads/2026/10/a b.png',
  );
  assert.equal(
    editionUploadKey('/uploads/2026/10/a.png'),
    'uploads/2026/10/a.png',
  );
  for (const ref of [
    'https://media.example.test.evil/content/uploads/a.png',
    'http://media.example.test/content/uploads/a.png',
    'https://evil.test/content/uploads/a.png',
    'https://media.example.test:444/content/uploads/a.png',
    'https://media.example.test/content-other/uploads/a.png',
    `${BASE}/private/fonts/secret.woff2`,
    `${BASE}/uploads/../private/a.png`,
    `${BASE}/uploads/%2e%2e/private/a.png`,
    `${BASE}/uploads/a%2fb.png`,
    `${BASE}/uploads/%252e%252e.png`,
    `${BASE}/uploads/%00.png`,
    `${BASE}/uploads//a.png`,
    `${BASE}/uploads/./a.png`,
    `${BASE}/uploads/a.png?signature=secret`,
    `${BASE}/uploads/a.png#fragment`,
    'https://user@media.example.test/content/uploads/a.png',
    '/uploads/../../private/a.png',
    '/uploads/%5cprivate.png',
    '/uploads/bad%.png',
  ])
    assert.equal(editionUploadKey(ref), null, ref);
});

test('S3-backed edition seals slide/theme/all-language bytes, and renders after the source disappears', async (t) => {
  const calls = [];
  let sourceRemoved = false;
  t.mock.method(provider, 'readFile', async (key, options) => {
    assert.equal(sourceRemoved, false, 'render must use the sealed bytes');
    calls.push({ key, options });
    return PHOTO;
  });
  t.mock.method(globalThis, 'fetch', () =>
    assert.fail('no URL from deck content is fetched'),
  );
  const pres = deck();
  pres.slides.push({
    id: 'gallery',
    type: 'image-set-slide',
    content: {
      title: 'Gallery',
      images: [{ src: `${BASE}/uploads/gallery.png`, alt: 'Gallery photo' }],
    },
  });
  // A link to the same image is still a hyperlink, never a data URL.
  pres.slides.push({
    id: 'link',
    type: 'title-slide',
    content: {
      title: `[Download](${pres.slides[0].content.image})`,
      subheading: '',
    },
  });
  pres.i18n = {
    versions: {
      nl: {
        title: 'S3 editie',
        slides: deck('/uploads/2026/10/nl.png').slides,
      },
    },
  };
  const theme = {
    label: 'S3',
    assets: { logo: `${BASE}/uploads/logo.png` },
    cssVars: {
      '--t-logo-url': `url('${BASE}/uploads/logo.png')`,
    },
  };
  const sealed = await prepareEditionInput(process.cwd(), pres, { theme });
  const input = JSON.parse(sealed.inputBytes);
  assert.equal(input.presentation.slides[0].content.image, DATA);
  assert.equal(
    input.presentation.i18n.versions.nl.slides[0].content.image,
    DATA,
  );
  assert.equal(input.theme.assets.logo, DATA);
  assert.equal(input.theme.cssVars['--t-logo-url'], `url('${DATA}')`);
  assert.equal(input.presentation.slides[1].content.images[0].src, DATA);
  assert.equal(
    input.presentation.slides[2].content.title,
    pres.slides[2].content.title,
  );
  assert.deepEqual(calls.map((c) => c.key).sort(), [
    'uploads/2026/10/nl.png',
    'uploads/2026/10/photo.png',
    'uploads/gallery.png',
    'uploads/logo.png',
  ]);
  assert.ok(
    calls.every(
      (c) =>
        c.options.maxBytes === 20 * 1024 * 1024 && c.options.timeoutMs === 8000,
    ),
  );
  assert.ok(verifyEditionInput(sealed).ok);
  sourceRemoved = true;
  const rendered = await renderEdition(process.cwd(), input);
  assert.ok(rendered.canvas.includes(DATA));
  assert.ok(rendered.reader.includes('Photo'));
});

test('missing own media and foreign/private URLs refuse without a private read or remote fetch', async (t) => {
  const calls = [];
  t.mock.method(provider, 'readFile', async (key) => {
    calls.push(key);
    return null;
  });
  t.mock.method(globalThis, 'fetch', () =>
    assert.fail('untrusted URLs must not be fetched'),
  );
  for (const url of [
    `${BASE}/uploads/missing.png`,
    `${BASE}/private/fonts/secret.woff2`,
    'http://169.254.169.254/uploads/a.png',
    'https://ik.imagekit.io/account/a.png',
  ]) {
    await assert.rejects(
      prepareEditionInput(process.cwd(), deck(url), {
        theme: { label: 'Plain' },
      }),
      (err) => err.code === 'renderer_edition_input_unsealable',
    );
  }
  assert.deepEqual(calls, ['uploads/missing.png']);
});

test('bounded S3 reads stop oversized streams and pass a deadline to the SDK', async (t) => {
  await provider._getClient();
  let destroyed = false;
  let options;
  t.mock.method(provider, '_getClient', async () => ({
    async send(_cmd, opts) {
      options = opts;
      const body = Readable.from([Buffer.alloc(4), Buffer.alloc(4)]);
      body.on('close', () => {
        destroyed = true;
      });
      return { Body: body };
    },
  }));
  await assert.rejects(
    provider.readFile('uploads/large.png', { maxBytes: 6, timeoutMs: 1000 }),
    /byte limit/,
  );
  assert.ok(options.abortSignal);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(destroyed);
  assert.deepEqual(
    await provider.readFile('uploads/small.png', { maxBytes: 8 }),
    Buffer.alloc(8),
  );
});

test('S3 content-length refusal closes the body without consuming it', async (t) => {
  let consumed = false;
  let destroyed = false;
  t.mock.method(provider, '_getClient', async () => ({
    async send() {
      return {
        ContentLength: 9,
        Body: {
          async *[Symbol.asyncIterator]() {
            consumed = true;
            yield Buffer.alloc(9);
          },
          destroy() {
            destroyed = true;
          },
        },
      };
    },
  }));
  await assert.rejects(
    provider.readFile('uploads/large.png', { maxBytes: 8 }),
    /byte limit/,
  );
  assert.equal(consumed, false);
  assert.equal(destroyed, true);
});

test('the size scan counts own S3 images, including language versions', async () => {
  const { estimateEditionInput } =
    await import('../scripts/scan-edition-input-size.js');
  const pres = deck();
  pres.i18n = {
    versions: { nl: { slides: deck('/uploads/2026/10/nl.png').slides } },
  };
  const refs = [];
  const measured = await estimateEditionInput(pres, async (ref) => {
    refs.push(ref);
    return 30;
  });
  assert.equal(measured.assets, 2);
  assert.equal(measured.assetBytes, 80);
  assert.equal(measured.unresolved, 0);
  assert.deepEqual(refs, [
    pres.slides[0].content.image,
    '/uploads/2026/10/nl.png',
  ]);
});
