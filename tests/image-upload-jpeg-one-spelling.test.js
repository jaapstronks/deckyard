/**
 * JPEG has one content type: `image/jpeg` (B403).
 *
 * `image/jpg` is not a registered type and nothing that feeds the upload
 * paths sends it: browsers report `image/jpeg` for a .jpg/.jpeg file, the
 * Unsplash CDN answers with `image/jpeg`, and the server's own
 * `mimeFromExt` maps both extensions to `image/jpeg`. It nonetheless sat in
 * four tables, and B366 moved it into the one declared list, which made it
 * canonical. These tests pin the one spelling: the declared list carries one
 * content type per format, every intake refuses `image/jpg`, and a guard
 * fails if the literal comes back anywhere in the source.
 *
 * Run with: node --test tests/image-upload-jpeg-one-spelling.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  IMAGE_UPLOAD_FORMATS,
  IMAGE_UPLOAD_MIME_TO_EXT,
  IMAGE_UPLOAD_EXT_TO_MIME,
  imageUploadAccept,
} from '../shared/constants/image-uploads.js';
import {
  writeUploadedFile,
  replaceUploadFromDataUrl,
} from '../server/storage/uploads.js';
import { LocalProvider } from '../server/media/local.js';
import { ValidationError } from '../server/utils/errors.js';

const ROOT = path.resolve(import.meta.dirname, '..');

describe('the declared upload formats', () => {
  it('give every format exactly one content type', () => {
    for (const f of IMAGE_UPLOAD_FORMATS) {
      assert.equal(typeof f.mime, 'string', `${f.label} has one mime`);
      assert.equal('mimes' in f, false, `${f.label} carries no mime list`);
    }
  });

  it('spell JPEG as image/jpeg, under both extensions', () => {
    const jpeg = IMAGE_UPLOAD_FORMATS.find((f) => f.label === 'JPG');
    assert.equal(jpeg.mime, 'image/jpeg');
    assert.equal(IMAGE_UPLOAD_EXT_TO_MIME.jpg, 'image/jpeg');
    assert.equal(IMAGE_UPLOAD_EXT_TO_MIME.jpeg, 'image/jpeg');
    assert.equal(IMAGE_UPLOAD_MIME_TO_EXT['image/jpeg'], 'jpg');
    assert.equal('image/jpg' in IMAGE_UPLOAD_MIME_TO_EXT, false);
  });

  it('offer the picker one JPEG content type', () => {
    const accept = imageUploadAccept().split(',');
    assert.deepEqual(
      accept.filter((a) => a.startsWith('image/jp')),
      ['image/jpeg'],
    );
  });
});

describe('every intake refuses image/jpg', () => {
  const tmp = os.tmpdir();
  const buf = Buffer.from([0xff, 0xd8, 0xff]);

  it('writeUploadedFile', async () => {
    await assert.rejects(
      writeUploadedFile(tmp, buf, 'x.jpg', 'image/jpg'),
      ValidationError,
    );
  });

  it('replaceUploadFromDataUrl', async () => {
    await assert.rejects(
      replaceUploadFromDataUrl(
        tmp,
        '/uploads/x.jpg',
        `data:image/jpg;base64,${buf.toString('base64')}`,
      ),
      /does not match \.jpg/,
    );
  });

  it('LocalProvider.uploadBuffer', async () => {
    await assert.rejects(
      new LocalProvider(tmp).uploadBuffer({
        buffer: buf,
        filename: 'x.jpg',
        contentType: 'image/jpg',
      }),
      ValidationError,
    );
  });
});

describe('guard: image/jpg does not come back', () => {
  function* sourceFiles(dir) {
    for (const name of readdirSync(dir)) {
      if (name === 'vendor' || name === 'node_modules') continue;
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) yield* sourceFiles(abs);
      else if (/\.(m?js)$/.test(name)) yield abs;
    }
  }

  it('appears as a string literal nowhere in server/, client/ or shared/', () => {
    const hits = [];
    for (const top of ['server', 'client', 'shared']) {
      for (const file of sourceFiles(path.join(ROOT, top))) {
        if (/['"`]image\/jpg['"`]/.test(readFileSync(file, 'utf8'))) {
          hits.push(path.relative(ROOT, file));
        }
      }
    }
    assert.deepEqual(hits, []);
  });
});
