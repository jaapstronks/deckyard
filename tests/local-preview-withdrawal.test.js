/**
 * The local media provider withdraws nothing (B806): its public files are
 * served by the app's own route, which refuses a preview whose proof expired
 * (`server/routes/static/published-preview.js`), so a generated preview stays
 * on disk on unpublish and after its proof expires. The remote half is
 * tests/remote-preview-withdrawal.test.js.
 *
 * Run with: node --test tests/local-preview-withdrawal.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

for (const k of ['S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET', 'S3_ENDPOINT'])
  delete process.env[k];
process.env.MEDIA_STORAGE_MODE = 'local';

const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'local-preview-'));
const { initializeMediaProvider, getMediaProvider } =
  await import('../server/media/index.js');
const { withdrawPublishedPreview } =
  await import('../server/services/publish-presentation.js');

await initializeMediaProvider(repoRoot);
const provider = getMediaProvider();

test('a generated local preview is kept on disk', async () => {
  assert.equal(provider.getStatus().name, 'local');
  const name =
    'og-v2-abcd1234-0123456789abcdef0123-00000000-0000-4000-8000-000000000001.png';
  await fs.mkdir(provider.uploadsDir, { recursive: true });
  const file = path.join(provider.uploadsDir, name);
  await fs.writeFile(file, 'png');
  try {
    assert.ok(provider.ownsUrl(`/uploads/${name}`));
    assert.equal(
      await withdrawPublishedPreview(`/uploads/${name}`, 'abcd1234'),
      'kept',
    );
    assert.equal(await fs.readFile(file, 'utf8'), 'png');
  } finally {
    await fs.rm(repoRoot, { recursive: true, force: true });
  }
});
