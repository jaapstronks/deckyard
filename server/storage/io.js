import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export async function readJsonIfExists(p) {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function writeJsonAtomic(p, obj) {
  const dir = path.dirname(p);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `${path.basename(p)}.${crypto.randomUUID()}.tmp`
  );
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8');
  await fs.rename(tmp, p);
}
