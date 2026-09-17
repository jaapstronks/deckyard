import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customDirFor } from '../../shared/custom-root.js';
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
  // Fork-specific content, served from the fork root so an installation that
  // moved it serves the files its loaders and pickers actually list.
  {
    urlPrefix: '/custom/assets/',
    dir: path.join(customDirFor(repoRoot), 'assets'),
  },
  {
    urlPrefix: '/custom/themes/',
    dir: path.join(customDirFor(repoRoot), 'themes'),
  },
];
