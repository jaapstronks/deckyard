import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../server/config/paths.js';

async function rmIfExists(p) {
  try {
    await fs.rm(p, { recursive: true, force: true });
  } catch {}
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function resetDemoData() {
  // WARNING: this deletes data in server/data + server/uploads for a demo instance.
  // Only run this on the demo deployment.
  const dataRoot = path.join(repoRoot, 'server', 'data');

  // Presentations + publish state
  await rmIfExists(path.join(dataRoot, 'presentations'));
  await rmIfExists(path.join(dataRoot, 'published'));

  // Live/session-ish data
  await rmIfExists(path.join(dataRoot, 'present-sessions'));
  await rmIfExists(path.join(dataRoot, 'questions'));
  await rmIfExists(path.join(dataRoot, 'feedback'));
  await rmIfExists(path.join(dataRoot, 'interactions'));
  await rmIfExists(path.join(dataRoot, 'polls'));
  await rmIfExists(path.join(dataRoot, 'trivia-sessions'));

  // Note: keep follow codes + image library unless you want to reset them too.
  // await rmIfExists(path.join(dataRoot, 'follow-codes.json'));
  // await rmIfExists(path.join(dataRoot, 'image-library.json'));

  // Uploads (demo should typically disable uploads anyway).
  await rmIfExists(path.join(repoRoot, 'server', 'uploads'));

  // Recreate required dirs so the server can boot cleanly.
  await ensureDir(path.join(dataRoot, 'presentations'));
  await ensureDir(path.join(dataRoot, 'published'));
  await ensureDir(path.join(dataRoot, 'polls'));
  await ensureDir(path.join(repoRoot, 'server', 'uploads'));
}

await resetDemoData();
// eslint-disable-next-line no-console
console.log('Demo reset complete.');











