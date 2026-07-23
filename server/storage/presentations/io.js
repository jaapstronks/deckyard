import fs from 'node:fs/promises';
import { presPath } from './paths.js';
import { readJsonIfExists, writeJsonAtomic } from '../io.js';
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
  // Same atomic tmp-write-rename as every other snapshot; the shared helper
  // creates the presentations dir (dirname of the target) on demand.
  await writeJsonAtomic(presPath(repoRoot, pres.id), pres);
}

export async function deletePresentationFile(repoRoot, id) {
  try {
    await fs.unlink(presPath(repoRoot, id));
    return true;
  } catch {
    return false;
  }
}
