import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * The app-shell policy: client/index.html references no third-party origin at
 * all. DOMPurify, Prism and KaTeX are self-hosted under client/vendor/ (B32,
 * B33) and the fonts are self-hosted under assets/fonts/google/, so every
 * src/href in the head resolves against this server. This gate is what keeps
 * a CDN tag from quietly coming back.
 */
test('the app shell references no third-party URLs', async () => {
  const html = await fs.readFile(
    path.join(repoRoot, 'client', 'index.html'),
    'utf8',
  );
  const external = [
    ...html.matchAll(/(?:src|href)\s*=\s*"((?:https?:)?\/\/[^"]*)"/g),
  ].map((m) => m[1]);
  assert.deepEqual(
    external,
    [],
    `client/index.html loads from a third-party origin: ${external.join(', ')}`,
  );
});
