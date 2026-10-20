import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

/** Run a test with uploads owned and removed by one callback scope. */
export async function withTestUploads(repoRoot, callback) {
  const dir = path.join(repoRoot, 'server', 'uploads');
  const files = [];

  async function add(bytes, { prefix, ext }) {
    const name = `${prefix}${randomUUID()}.${ext}`;
    const file = path.join(dir, name);
    files.push(file);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(file, bytes);
    return `/uploads/${name}`;
  }

  try {
    return await callback(add);
  } finally {
    for (const file of files.reverse()) {
      await fs.rm(file, { force: true });
    }
  }
}
