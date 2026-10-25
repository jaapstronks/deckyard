/**
 * Fixtures for the render-bundle proof: one frozen edition, and the staging
 * trick the "two renderer revisions" tests rest on.
 *
 * **The trick.** A bundle's `files/` directory is itself a buildable source
 * root - it holds exactly the files the builder would collect, at their
 * repo-relative paths. So revision B is made by copying revision A's own files,
 * editing two of them, and building again. No second checkout, no copy of
 * `node_modules`, and the rebuild of an unedited copy is also the determinism
 * check: same bytes in, same hash out.
 */

import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EDITION_INPUT_SCHEMA } from '../../server/render/renderer-bundle/edition-input.js';
import { buildRendererBundle } from '../../scripts/build-renderer-bundle.js';

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

/** Markers chosen so they cannot occur in tens of thousands of lines of CSS. */
export const MARKERS = Object.freeze({
  title: 'Zarquon-edition-title',
  subheading: 'Zarquon-edition-subheading',
  body: 'Zarquon-edition-body',
  revisionB: 'rb-revision-b',
});

/**
 * The frozen edition every test in this family renders.
 *
 * Two core slide types, two languages of nothing in particular, a theme record
 * instead of a theme id, and font CSS as a string: everything an installation
 * would have had to look up is already in here, which is the contract.
 *
 * @returns {object} An {@link EDITION_INPUT_SCHEMA} input
 */
export function frozenEditionInput() {
  return {
    schema: EDITION_INPUT_SCHEMA,
    presentation: {
      id: 'edition-fixture',
      title: MARKERS.title,
      description: 'A sealed render of a frozen edition',
      lang: 'en',
      slides: [
        {
          id: 'slide-1',
          type: 'title-slide',
          content: {
            title: MARKERS.title,
            subheading: MARKERS.subheading,
          },
        },
        {
          id: 'slide-2',
          type: 'content-slide',
          content: {
            title: 'What a bundle freezes',
            body: `- ${MARKERS.body}\n- The core CSS\n- The fork seam`,
          },
        },
      ],
    },
    theme: {
      id: 'default',
      cssVars: { '--t-accent': '#13393a', '--t-slide-bg': '#fffdf8' },
    },
    css: { fontCss: '/* font faces frozen with the edition */' },
    metaDescription: 'A sealed render of a frozen edition',
    canonicalUrl: 'https://example.test/p/edition-fixture/1',
  };
}

/** A temp directory removed again by the caller's `after()`. */
export async function tempDir(prefix = 'deckyard-renderer-bundle-') {
  // Through `realpath`: a sealed worker is granted read access to a directory
  // and resolves its own entry point inside it, and on macOS `os.tmpdir()`
  // hands back the symlinked spelling of `/private/var/folders/...`.
  return realpath(await mkdtemp(path.join(os.tmpdir(), prefix)));
}

/**
 * Build a bundle and keep both halves of the answer.
 *
 * @param {object} options
 * @param {string} options.storeDir
 * @param {string} [options.sourceRoot] - Defaults to this checkout
 * @returns {Promise<{rendererHash: string, dir: string, manifest: object}>}
 */
export async function buildBundle({ storeDir, sourceRoot = repoRoot }) {
  return buildRendererBundle({ storeDir, sourceRoot });
}

/**
 * Copy a built bundle's renderer tree into a fresh source root.
 *
 * @param {string} filesDir - A bundle's `files/` directory
 * @param {string} dest - Directory to create
 * @returns {Promise<string>} `dest`
 */
export async function stageSource(filesDir, dest) {
  await rm(dest, { recursive: true, force: true });
  await cp(filesDir, dest, { recursive: true });
  return dest;
}

/** One edit, asserted to have applied: a silent no-op would fake the proof. */
async function patchFile(root, relPath, from, to) {
  const abs = path.join(root, relPath);
  const before = await readFile(abs, 'utf8');
  if (!before.includes(from)) {
    throw new Error(
      `renderer-bundle fixture: ${relPath} does not contain ${JSON.stringify(from)}`,
    );
  }
  await writeFile(abs, before.split(from).join(to));
}

/**
 * Turn a staged source root into "renderer revision B": one change to renderer
 * code, one to a core slide type, one to a stylesheet. All three are visible in
 * the rendered DOM or on screen, so "edition A did not change" is a claim with
 * something behind it.
 *
 * @param {string} sourceRoot - A staged copy of revision A's files
 */
export async function makeRevisionB(sourceRoot) {
  await patchFile(
    sourceRoot,
    'server/export/canvas-document.js',
    '<section class="deck-slide"',
    `<section class="deck-slide ${MARKERS.revisionB}"`,
  );
  await patchFile(
    sourceRoot,
    'shared/slide-types/types/title-slide/render.js',
    '<p class="tsu-subtitle"',
    '<p class="tsu-subtitle tsu-subtitle-b"',
  );
  // Appended rather than patched: it lands last in the chain, so the rule wins
  // without having to reason about specificity against 50 stylesheets.
  const cssPath = path.join(sourceRoot, 'client/styles/export.css');
  const css = await readFile(cssPath, 'utf8');
  await writeFile(
    cssPath,
    `${css}\n.${MARKERS.revisionB} .tsu-subtitle { outline: 8px solid #ff00ff; }\n`,
  );
}
