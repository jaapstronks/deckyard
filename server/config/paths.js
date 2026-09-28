import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { customDirFor } from '../../shared/custom-root.js';
import { uploadsDir } from './storage-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, '../..');
export const CLIENT_DIR = path.join(repoRoot, 'client');
/**
 * The directories this installation serves as static files, per URL prefix,
 * for an installation root. The one table from URL prefix to disk: the static
 * mounts are this table for the process root, and every export that turns a
 * served ref back into a file ({@link resolveServedPath} in
 * `server/utils/served-asset-path.js`) reads it for its own root. Uploads come
 * from the env/sandbox-aware {@link uploadsDir}, the fork tree through
 * {@link customDirFor}, so an installation that moved either serves and
 * exports its own files rather than the checkout's.
 * @param {string} root - Installation root
 * @returns {Array<{urlPrefix: string, dir: string}>}
 */
export function servedDirsFor(root) {
  return [
    { urlPrefix: '/assets/', dir: path.join(root, 'assets') },
    { urlPrefix: '/css/', dir: path.join(root, 'css') },
    { urlPrefix: '/client/', dir: path.join(root, 'client') },
    { urlPrefix: '/shared/', dir: path.join(root, 'shared') },
    { urlPrefix: '/uploads/', dir: uploadsDir(root) },
    {
      urlPrefix: '/custom/assets/',
      dir: path.join(customDirFor(root), 'assets'),
    },
  ];
}

export const SHARED_PUBLIC_DIRS = servedDirsFor(repoRoot);
