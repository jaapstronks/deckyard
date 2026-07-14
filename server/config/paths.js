import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { uploadsDir } from './storage-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '../..');
export const CLIENT_DIR = path.join(repoRoot, 'client');
export const SHARED_PUBLIC_DIRS = [
  { urlPrefix: '/assets/', dir: path.join(repoRoot, 'assets') },
  { urlPrefix: '/css/', dir: path.join(repoRoot, 'css') },
  { urlPrefix: '/client/', dir: path.join(repoRoot, 'client') },
  { urlPrefix: '/shared/', dir: path.join(repoRoot, 'shared') },
  { urlPrefix: '/themes/', dir: path.join(repoRoot, 'themes') },
  { urlPrefix: '/uploads/', dir: uploadsDir(repoRoot) },
  // Custom directories for fork-specific content
  { urlPrefix: '/custom/assets/', dir: path.join(repoRoot, 'custom/assets') },
  { urlPrefix: '/custom/themes/', dir: path.join(repoRoot, 'custom/themes') },
];
