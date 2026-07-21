import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { presDir, presPath } from './paths.js';
import { readJsonIfExists } from '../io.js';
import { migratePresentation } from '../../../shared/slide-types/schema-version.js';

// Re-exported for callers that import it from this presentations-scoped module.
export { readJsonIfExists };

// The single durable read funnel: every stored deck is migrated up to the
// current schema version in memory here, so callers never see a legacy shape.
// Reads don't write; the upgraded deck is persisted on the next writePresentation.
export async function readPresentation(repoRoot, id) {
  const pres = await readJsonIfExists(presPath(repoRoot, id));
  return pres ? migratePresentation(pres) : pres;
}

export async function writePresentation(repoRoot, pres) {
  const dir = presDir(repoRoot);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `${pres.id}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(pres, null, 2), 'utf8');
  await fs.rename(tmp, presPath(repoRoot, pres.id));
}

export async function deletePresentationFile(repoRoot, id) {
  try {
    await fs.unlink(presPath(repoRoot, id));
    return true;
  } catch {
    return false;
  }
}
