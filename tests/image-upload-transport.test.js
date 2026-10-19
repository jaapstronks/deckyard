import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { uploadFile } from '../client/lib/net/image-upload.js';

const dom = new JSDOM('<!doctype html><body></body>', {
  url: 'http://localhost/app',
});
for (const key of [
  'window',
  'document',
  'localStorage',
  'FileReader',
  'File',
  'Event',
  'HTMLElement',
  'Element',
  'Node',
]) {
  globalThis[key] = dom.window[key];
}
const file = () => new File(['image'], 'photo.png', { type: 'image/png' });

function provider({ exists = true, publicUrl = '/confirmed.png' } = {}) {
  const calls = [];
  const api = async (path, opts) => {
    calls.push([path, opts]);
    if (path === '/api/media/status') return { presignedSupported: true };
    if (path === '/api/media/presign')
      return {
        uploadUrl: 'https://storage.example/upload',
        headers: { 'Content-Type': 'image/png', 'x-signed': 'yes' },
        key: 'object-key',
      };
    if (path === '/api/media/confirm') return { exists, publicUrl };
    throw new Error(`Unexpected request: ${path}`);
  };
  return { api, calls };
}

test('local upload reads the file and retains its original name', async () => {
  const image = file();
  const calls = [];
  const api = async (path, opts) => {
    calls.push(path);
    if (path === '/api/media/status') return { presignedSupported: false };
    assert.equal(path, '/api/uploads');
    assert.equal(opts.method, 'POST');
    assert.deepEqual(opts.body, {
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
      originalName: 'photo.png',
    });
    return { url: '/uploads/photo.png' };
  };
  assert.deepEqual(await uploadFile(api, image), { url: '/uploads/photo.png' });
  assert.deepEqual(calls, ['/api/media/status', '/api/uploads']);
});

test('presigned upload sends only storage headers and confirms the exact key', async (t) => {
  const { api, calls } = provider();
  const image = file();
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    assert.equal(url, 'https://storage.example/upload');
    assert.deepEqual(opts, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png', 'x-signed': 'yes' },
      body: image,
    });
    return { ok: true };
  });
  assert.deepEqual(await uploadFile(api, image), { url: '/confirmed.png' });
  assert.deepEqual(calls[1][1].body, {
    filename: image.name,
    contentType: image.type,
    size: image.size,
  });
  assert.deepEqual(calls[2], [
    '/api/media/confirm',
    { method: 'POST', body: { key: 'object-key' } },
  ]);
});

test('failed PUT rejects without confirm or another upload', async (t) => {
  const { api, calls } = provider();
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false,
    status: 403,
    statusText: 'Forbidden',
  }));
  await assert.rejects(uploadFile(api, file()), /Upload failed: 403/);
  assert.deepEqual(
    calls.map(([path]) => path),
    ['/api/media/status', '/api/media/presign'],
  );
});

test('missing object and empty URLs reject, even after HTTP success', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  for (const result of [
    { exists: false },
    { publicUrl: '' },
    { publicUrl: '   ' },
  ]) {
    await assert.rejects(
      uploadFile(provider(result).api, file()),
      /Upload confirmation failed/,
    );
  }
  await assert.rejects(
    uploadFile(
      async (path) => (path.endsWith('status') ? {} : { url: '' }),
      file(),
    ),
    /Upload confirmation failed/,
  );
});

test('status is fresh per attempt; status failure falls back only for that attempt', async (t) => {
  let statusCalls = 0;
  const paths = [];
  const remote = provider();
  const api = async (path, opts) => {
    paths.push(path);
    if (path === '/api/media/status' && ++statusCalls === 1)
      throw new Error('Offline');
    if (path === '/api/uploads') return { url: '/local.png' };
    return remote.api(path, opts);
  };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true }));
  assert.equal((await uploadFile(api, file())).url, '/local.png');
  assert.equal((await uploadFile(api, file())).url, '/confirmed.png');
  assert.equal(statusCalls, 2);
  assert.equal(paths.filter((p) => p === '/api/uploads').length, 1);
});

test('theme logo keeps its previous URL and never calls onChange on missing object', async (t) => {
  const { setFeatures } = await import('../client/lib/state/features.js');
  const { createLogoUploader } =
    await import('../client/views/settings/theme-editor/logo-uploader.js');
  setFeatures({ enableUploads: true });
  const remote = provider({ exists: false, publicUrl: '' });
  t.mock.method(globalThis, 'fetch', async (path, opts) => {
    if (String(path) === 'https://storage.example/upload') return { ok: true };
    return Response.json(await remote.api(path, opts));
  });
  const changes = [];
  const { el } = createLogoUploader({
    value: '/existing.svg',
    onChange: (url) => changes.push(url),
  });
  document.body.replaceChildren(el);
  const input = el.querySelector('input[type=file]');
  Object.defineProperty(input, 'files', { value: [file()] });
  input.dispatchEvent(new Event('change'));
  for (let i = 0; i < 10; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(changes, []);
  assert.equal(el.querySelector('img').getAttribute('src'), '/existing.svg');
  assert.match(el.textContent, /Upload confirmation failed/);
});

test('client media upload endpoints have one owner', async () => {
  const owners = [];
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory() && entry.name !== 'vendor') await scan(path);
      else if (entry.name.endsWith('.js')) {
        const source = await readFile(path, 'utf8');
        if (/\/api\/media\/(?:presign|confirm)/.test(source)) owners.push(path);
      }
    }
  }
  await scan('client');
  assert.deepEqual(owners, ['client/lib/net/image-upload.js']);
});
