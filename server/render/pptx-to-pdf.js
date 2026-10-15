import { spawn } from 'node:child_process';
import { accessSync, constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import JSZip from 'jszip';

import { envStr } from '../config/utils.js';

/**
 * Where LibreOffice usually lives. `SOFFICE_PATH` wins over all of them.
 * LibreOffice is a system package, not an npm dependency: without it the PPTX
 * raster import is off and everything else works (B700).
 */
export const SOFFICE_CANDIDATE_PATHS = Object.freeze([
  '/usr/bin/soffice',
  '/usr/bin/libreoffice',
  '/usr/lib/libreoffice/program/soffice',
  '/opt/libreoffice/program/soffice',
  '/opt/homebrew/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
]);

/** A deck that takes longer than this to convert is not going to finish. */
const CONVERT_TIMEOUT_MS = 120_000;

/** The last lookup, per `SOFFICE_PATH`: installing LibreOffice means a restart. */
let resolved = null;

/**
 * The LibreOffice binary this server converts PPTX with, or '' when there is
 * none. Synchronous, so the feature-flag snapshot can ask it, and remembered,
 * because that snapshot is built on every request.
 * @returns {string}
 */
export function resolveSofficePath() {
  const envPath = envStr('SOFFICE_PATH');
  if (resolved?.envPath === envPath) return resolved.path;
  let found = '';
  for (const candidate of [envPath, ...SOFFICE_CANDIDATE_PATHS]) {
    const p = String(candidate || '').trim();
    if (!p) continue;
    try {
      accessSync(p, fsConstants.X_OK);
      found = p;
      break;
      // eslint-disable-next-line no-restricted-syntax -- a missing candidate is the normal case; the next one is tried
    } catch {
      // not here
    }
  }
  resolved = { envPath, path: found };
  return found;
}

/**
 * Whether this server can turn a PPTX into images: the `pptxRasterImport`
 * flag the editor offers PowerPoint files on.
 * @returns {boolean}
 */
export function isPptxRasterAvailable() {
  return resolveSofficePath() !== '';
}

/**
 * Convert a PPTX to a PDF with headless LibreOffice, one page per shown slide
 * (hidden slides are left out, as in a slide show).
 *
 * The file is an upload, so LibreOffice gets as little as possible to act on:
 * every external relationship target (linked images, linked media, hyperlinks)
 * is blanked first, so the conversion cannot be made to fetch a URL or read a
 * local file; it runs in a fresh temp directory with a throwaway profile, and
 * is killed on timeout or when `signal` aborts.
 *
 * @param {object} options
 * @param {Buffer} options.buffer - The PPTX file contents
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<Buffer>} The PDF
 */
export async function pptxToPdf({ buffer, signal = null } = {}) {
  const soffice = resolveSofficePath();
  if (!soffice) {
    const err = new Error(
      'PowerPoint import needs LibreOffice. Install it, or set SOFFICE_PATH to the soffice binary.',
    );
    err.code = 'SOFFICE_MISSING';
    throw err;
  }
  signal?.throwIfAborted();

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-pptx-'));
  try {
    const input = path.join(dir, 'deck.pptx');
    await fs.writeFile(input, await withoutExternalTargets(buffer));
    await runSoffice(
      soffice,
      [
        '--headless',
        '--invisible',
        '--norestore',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        `-env:UserInstallation=${pathToFileURL(path.join(dir, 'profile')).href}`,
        '--convert-to',
        'pdf',
        '--outdir',
        dir,
        input,
      ],
      { cwd: dir, signal },
    );
    try {
      return await fs.readFile(path.join(dir, 'deck.pdf'));
    } catch {
      throw new Error('LibreOffice did not produce a PDF for this file');
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The same package with every `TargetMode="External"` relationship pointing
 * nowhere. The relationship stays, so the parts that reference its id still
 * resolve; only the address is gone.
 * @param {Buffer} buffer
 * @returns {Promise<Buffer>}
 */
async function withoutExternalTargets(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const relParts = Object.keys(zip.files).filter((name) =>
    name.endsWith('.rels'),
  );
  for (const name of relParts) {
    const xml = await zip.file(name).async('string');
    const blanked = xml.replace(/<Relationship\b[^>]*>/g, (tag) =>
      /\bTargetMode="External"/.test(tag)
        ? tag.replace(/\bTarget="[^"]*"/, 'Target=""')
        : tag,
    );
    if (blanked !== xml) zip.file(name, blanked);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * Run soffice to completion. It is started in its own process group: the
 * `soffice` on PATH is often a wrapper that starts `soffice.bin`, and a
 * timeout or cancel must stop both.
 */
function runSoffice(bin, args, { cwd, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, HOME: cwd },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      if (stderr.length < 4000) stderr += chunk;
    });

    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve();
    };
    const kill = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
        // eslint-disable-next-line no-restricted-syntax -- the group is already gone; there is nothing left to stop
      } catch {
        // ignore
      }
    };
    const onAbort = () => {
      kill();
      finish(signal.reason);
    };
    const timer = setTimeout(() => {
      kill();
      finish(new Error('LibreOffice took too long to convert this file'));
    }, CONVERT_TIMEOUT_MS);
    signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      if (code === 0) finish();
      else
        finish(
          new Error(
            `LibreOffice exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
    });
  });
}
