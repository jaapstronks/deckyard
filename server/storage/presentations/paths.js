import path from 'node:path';
import { dataDir } from '../../config/storage-paths.js';

export function presDir(repoRoot) {
  return path.join(dataDir(repoRoot), 'presentations');
}

export function presPath(repoRoot, id) {
  return path.join(presDir(repoRoot), `${id}.json`);
}
