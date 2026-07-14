import fs from 'node:fs/promises';
import path from 'node:path';

function isJsonFile(f) {
  return String(f || '').toLowerCase().endsWith('.json');
}

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const repoRoot = process.cwd();
  const dataDir = path.join(repoRoot, 'server', 'data');
  const presDir = path.join(dataDir, 'presentations');
  const versionsRoot = path.join(dataDir, 'presentation-versions');

  await fs.mkdir(presDir, { recursive: true });

  const presFiles = new Set(
    (await fs.readdir(presDir))
      .filter(isJsonFile)
      .map((f) => f.replace(/\.json$/i, ''))
  );
  const versionDirs = (await fs.readdir(versionsRoot)).filter(Boolean);

  const orphanIds = versionDirs.filter((id) => !presFiles.has(id));
  if (!orphanIds.length) {
    console.log('No orphaned decks found.');
    return;
  }

  console.log(`Found ${orphanIds.length} orphaned deck(s). Restoring...`);
  for (const id of orphanIds) {
    const dir = path.join(versionsRoot, id);
    const files = (await fs.readdir(dir)).filter(isJsonFile).sort();
    const latest = files[files.length - 1];
    if (!latest) continue;
    const snapPath = path.join(dir, latest);
    const snap = await readJson(snapPath);

    // Ensure id + basic metadata exist.
    snap.id = String(snap?.id || id);
    const now = new Date().toISOString();
    if (!snap.created) snap.created = now;
    if (!snap.modified) snap.modified = now;

    const outPath = path.join(presDir, `${id}.json`);
    if (await exists(outPath)) {
      console.log(`- ${id}: already exists, skipping`);
      continue;
    }
    await fs.writeFile(outPath, JSON.stringify(snap, null, 2), 'utf8');
    console.log(`- ${id}: restored from ${latest}`);
  }

  console.log('Done.');
}

await main();








