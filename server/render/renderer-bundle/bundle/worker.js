/**
 * The render worker: the process a published edition is rendered in.
 *
 * It is started by `server/render/renderer-bundle/host.js` as a child process
 * with `--permission --allow-fs-read=<bundleDir>` and an environment scrubbed
 * down to nothing the renderer could use, so by the time this file runs the
 * process can read the bundle and little else: no write access anywhere, no
 * database credentials, no child processes, no worker threads, no native
 * addons. This file adds the one dimension the permission model has not got -
 * the network - and then renders.
 *
 * Protocol, deliberately the simplest thing that cannot be half-successful:
 * the edition input arrives as JSON on stdin, one JSON object leaves on stdout.
 * `{ok: true, canvas, reader, sealed}` for a render, `{ok: false, code,
 * message}` for a refusal; a crash is a non-zero exit with stderr. The host
 * never sees a partial document, because nothing is written until the whole
 * render returned.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sealNetwork } from './net-guard.js';

// Before the render entry, and therefore before any module in its closure, can
// capture a socket API.
const sealedWhat = sealNetwork();

/** The unpacked renderer tree: four levels up from this file. */
const bundleRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);

/** Read all of stdin as UTF-8. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

/** Write one JSON object to stdout and resolve once it is flushed. */
function writeResult(value) {
  return new Promise((resolve) => {
    process.stdout.write(JSON.stringify(value), () => resolve());
  });
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    await writeResult({
      ok: false,
      code: 'renderer_edition_input_invalid',
      message: `edition input is not JSON: ${err.message}`,
    });
    return;
  }

  // Imported here, not at the top: the seal has to be in place first, and a
  // refusal from the entry has to come back as a result rather than as an
  // import-time crash.
  const { renderEdition } = await import('./entry.js');
  try {
    const { canvas, reader } = await renderEdition(bundleRoot, input);
    await writeResult({
      ok: true,
      canvas,
      reader,
      // What the seal closed, reported back rather than assumed: the test that
      // proves the isolation reads this, and so does an operator wondering
      // what a frozen renderer could still have reached.
      sealed: { ...sealedWhat, env: Object.keys(process.env).sort() },
    });
  } catch (err) {
    await writeResult({
      ok: false,
      code: err?.code || 'renderer_bundle_worker_failed',
      message: err?.message || String(err),
      details: err?.details ?? null,
    });
  }
}

await main();
