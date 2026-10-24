/**
 * T1.1 reproducibility evidence and the network-isolation counterexample.
 *
 * Trusted fixtures establish reproducibility; production execution is blocked.
 * These tests distinguish document identity from execution isolation:
 *
 *   1. **Revision B does not reach edition A.** Renderer code, a core slide
 *      type's markup and a stylesheet all change in B; rendering the same
 *      edition with A afterwards gives byte-identical documents, and none of
 *      B's markers.
 *   2. **Losing the store changes nothing.** A bundle rebuilt from the same
 *      sources into a fresh store gets the same hash and renders the same
 *      bytes, so the store is a cache and not a source of truth.
 *   3. **Isolation is NOT established.** The trusted-fixture worker
 *      runs with a two-key environment, no write access, no child processes and
 *      an import filter (NOT network isolation), and its closure has no database,
 *      no media provider and no feature-flag snapshot
 *      (`tests/renderer-bundle-closure.test.js` measures dependencies). A real
 *      TCP connection still succeeds; production execution must refuse.
 *   4. **An unknown or damaged renderer refuses.** No fallback to the current
 *      one, in any of the five ways a bundle can be wrong.
 *
 * The screenshots that go with criterion 1 are in
 * `tests/renderer-bundle-screenshot.test.js`, which needs a browser.
 *
 * Run with: node --test tests/renderer-bundle-isolation.test.js
 */

import net from 'node:net';
import { scanClosure } from '../scripts/build-renderer-bundle.js';
import { renderEditionInBundle } from '../server/render/renderer-bundle/index.js';
import {
  renderTrustedEditionForProof,
  rendererWorkerArgs,
  workerEnv,
} from './helpers/renderer-bundle-process.js';

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  RENDERER_BUNDLE_ERRORS,
  openRendererBundle,
  listRendererBundles,
} from '../server/render/renderer-bundle/index.js';
import { assertSealableEdition } from '../server/render/renderer-bundle/bundle/entry.js';
import {
  MARKERS,
  buildBundle,
  frozenEditionInput,
  makeRevisionB,
  stageSource,
  tempDir,
} from './helpers/renderer-bundle.js';

let scratch;
/** Revision A, built from this checkout. */
let a;
/** Revision B: A's own files, with three edits. */
let b;
/** A staged, unedited copy of A's files - the source A is rebuilt from. */
let srcA;
/** Documents rendered from the fixture edition, by revision. */
const rendered = {};

before(async () => {
  scratch = await tempDir();
  const store = path.join(scratch, 'store');

  a = await buildBundle({ storeDir: store });
  srcA = await stageSource(
    path.join(a.dir, 'files'),
    path.join(scratch, 'srcA'),
  );

  const srcB = await stageSource(
    path.join(a.dir, 'files'),
    path.join(scratch, 'srcB'),
  );
  await makeRevisionB(srcB);
  b = await buildBundle({ storeDir: store, sourceRoot: srcB });

  const input = frozenEditionInput();
  rendered.a = await renderTrustedEditionForProof(
    await openRendererBundle(store, a.rendererHash),
    input,
  );
  rendered.b = await renderTrustedEditionForProof(
    await openRendererBundle(store, b.rendererHash),
    input,
  );
  // Rendered again only after B exists and after B's sources were edited: this
  // is the "has anything leaked" read, not a warm-up.
  rendered.aAgain = await renderTrustedEditionForProof(
    await openRendererBundle(store, a.rendererHash),
    input,
  );
});

after(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('a renderer revision is a content hash, and two revisions coexist', async () => {
  assert.notEqual(a.rendererHash, b.rendererHash);
  assert.deepEqual(
    await listRendererBundles(path.join(scratch, 'store')),
    [a.rendererHash, b.rendererHash].sort(),
  );
});

test('both views of the edition render, from one entry', () => {
  for (const view of ['canvas', 'reader']) {
    assert.match(rendered.a[view], /^<!doctype html>/i);
    assert.ok(rendered.a[view].includes(MARKERS.title), `${view}: no title`);
  }
  assert.ok(rendered.a.canvas.includes(MARKERS.subheading));
  assert.ok(
    rendered.a.reader.includes(MARKERS.body),
    'the reader projects the slide body',
  );
  assert.ok(
    rendered.a.canvas.includes('class="deck-slide"'),
    'the canvas renders the stage markup',
  );
});

test('revision B renders the same edition differently', () => {
  assert.ok(rendered.b.canvas.includes(MARKERS.revisionB), 'B changed no code');
  assert.ok(
    rendered.b.canvas.includes('tsu-subtitle tsu-subtitle-b'),
    "B's core slide type change did not take effect",
  );
  assert.ok(
    rendered.b.canvas.includes(`.${MARKERS.revisionB} .tsu-subtitle`),
    "B's stylesheet change did not take effect",
  );
  assert.notEqual(rendered.b.canvas, rendered.a.canvas);
});

test('edition A is byte-identical after B changed code, a type and CSS', () => {
  assert.equal(rendered.aAgain.canvas, rendered.a.canvas);
  assert.equal(rendered.aAgain.reader, rendered.a.reader);
  for (const marker of [MARKERS.revisionB, 'tsu-subtitle-b']) {
    assert.ok(
      !rendered.aAgain.canvas.includes(marker),
      `edition A picked up ${marker} from revision B`,
    );
  }
});

test('rebuilding into a fresh store gives the same renderer and the same bytes', async () => {
  const freshStore = path.join(scratch, 'store-rebuilt');
  const rebuilt = await buildBundle({ storeDir: freshStore, sourceRoot: srcA });
  assert.equal(
    rebuilt.rendererHash,
    a.rendererHash,
    'the same sources must give the same renderer hash, or the store is the source of truth',
  );
  const out = await renderTrustedEditionForProof(
    await openRendererBundle(freshStore, rebuilt.rendererHash),
    frozenEditionInput(),
  );
  assert.equal(out.canvas, rendered.a.canvas);
  assert.equal(out.reader, rendered.a.reader);
});

test('the proof worker scrubs credentials and reports its import filter', () => {
  const env = rendered.a.sealed.env;
  for (const secret of [
    'DATABASE_URL',
    'PGPASSWORD',
    'S3_SECRET_ACCESS_KEY',
    'OPENAI_API_KEY',
    'MISTRAL_API_KEY',
    'SESSION_SECRET',
    'DECKYARD_CUSTOM_DIR',
    'PATH',
    'HOME',
  ]) {
    assert.ok(
      !env.includes(secret),
      `the worker environment carries ${secret}`,
    );
  }
  assert.ok(env.includes('DECKYARD_RENDER_WORKER'));
  // macOS injects __CF_USER_TEXT_ENCODING into every spawned process whatever
  // env is handed over, so the assertion is about what is *not* there.
  assert.ok(env.length <= 4, `unexpected environment: ${env.join(', ')}`);

  assert.deepEqual(rendered.a.sealed.globals.sort(), [
    'WebSocket',
    'fetch',
    'navigator',
  ]);
  assert.deepEqual(
    rendered.a.sealed.keptGlobals,
    [],
    'the diagnostic must report every global it could not remove',
  );
  for (const spec of ['node:net', 'node:https', 'node:dns', 'net', 'https']) {
    assert.ok(
      rendered.a.sealed.specifiers.includes(spec),
      `${spec} is not sealed`,
    );
  }
});

test('Node permissions refuse filesystem/process operations; the filter refuses imports', async () => {
  // The same flags the host passes, read from the host rather than retyped,
  // against a probe that tries each escape in turn. The probe gets its own
  // readable directory: these probes measure the individual Node checks,
  // not an OS boundary. The TCP counterexample below proves the limitation.
  const probeDir = path.join(scratch, 'probe');
  await mkdir(probeDir, { recursive: true });
  const probe = path.join(probeDir, 'probe.mjs');
  await writeFile(
    probe,
    `import { writeFileSync, readFileSync } from 'node:fs';
import { sealNetwork } from ${JSON.stringify(path.join(a.dir, 'files/server/render/renderer-bundle/bundle/net-guard.js'))};
// Run twice, with and without the seal, so the two halves of the boundary are
// told apart: the permission model denies the process escapes on its own, and
// the filter rejects imports but does not prevent network connections.
if (process.env.PROBE_SEAL !== '0') sealNetwork();
const out = {};
const attempt = async (name, fn) => {
  try {
    await fn();
    out[name] = 'allowed';
  } catch (err) {
    out[name] = err.code || err.constructor.name;
  }
};
await attempt('writeOutside', () => writeFileSync('/tmp/deckyard-render-escape', 'x'));
await attempt('writeInside', () => writeFileSync(${JSON.stringify(path.join(probeDir, 'written'))}, 'x'));
await attempt('readOutside', () => readFileSync('/etc/hosts'));
await attempt('readProbeDir', () => readFileSync(${JSON.stringify(probe)}));
await attempt('spawn', async () => (await import('node:child_process')).spawnSync('true'));
await attempt('workerThread', async () => {
  const { Worker } = await import('node:worker_threads');
  // Constructed, not just imported: the permission model denies starting a
  // thread, and reading the export tells nobody anything.
  (new Worker('', { eval: true })).terminate();
});
await attempt('netImport', () => import('node:net'));
await attempt('httpsImport', () => import('https'));
await attempt('fetch', () => fetch('http://127.0.0.1:9/'));
process.stdout.write(JSON.stringify(out));
`,
  );

  const args = rendererWorkerArgs({
    script: probe,
    readable: [a.dir, probeDir],
  });
  assert.ok(args.includes('--permission'));
  assert.ok(
    !args.some((arg) => arg.startsWith('--allow-fs-write')),
    'the worker must get no write permission at all',
  );

  const run = (env) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        env: { ...workerEnv(), ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c) => (stdout += c));
      child.stderr.on('data', (c) => (stderr += c));
      child.on('close', (code) =>
        code === 0
          ? resolve(JSON.parse(stdout))
          : reject(new Error(`probe exited ${code}: ${stderr}`)),
      );
    });

  assert.deepEqual(await run({}), {
    writeOutside: 'ERR_ACCESS_DENIED',
    writeInside: 'ERR_ACCESS_DENIED',
    readOutside: 'ERR_ACCESS_DENIED',
    readProbeDir: 'allowed',
    // The seal refuses these at resolve time, before the permission model gets
    // to refuse them at call time; the run below shows the model refuses them
    // anyway.
    spawn: 'ERR_RENDERER_BUNDLE_NETWORK_SEALED',
    workerThread: 'ERR_RENDERER_BUNDLE_NETWORK_SEALED',
    netImport: 'ERR_RENDERER_BUNDLE_NETWORK_SEALED',
    httpsImport: 'ERR_RENDERER_BUNDLE_NETWORK_SEALED',
    fetch: 'ReferenceError',
  });

  const unsealed = await run({ PROBE_SEAL: '0' });
  assert.equal(unsealed.spawn, 'ERR_ACCESS_DENIED');
  assert.equal(unsealed.workerThread, 'ERR_ACCESS_DENIED');
  assert.equal(unsealed.writeOutside, 'ERR_ACCESS_DENIED');
  assert.equal(unsealed.readOutside, 'ERR_ACCESS_DENIED');
  // And the half the permission model does not cover, which is why the seal
  // exists: without it a frozen renderer could open a socket.
  assert.equal(unsealed.netImport, 'allowed');
});

test('an unknown renderer refuses instead of falling back', async () => {
  await assert.rejects(
    () => openRendererBundle(path.join(scratch, 'store'), 'f'.repeat(64)),
    (err) => err.code === RENDERER_BUNDLE_ERRORS.UNKNOWN,
  );
});

test('a renderer hash that is not a digest refuses before touching disk', async () => {
  for (const bad of ['', 'latest', '../../etc', 'A'.repeat(64)]) {
    await assert.rejects(
      () => openRendererBundle(path.join(scratch, 'store'), bad),
      (err) => err.code === RENDERER_BUNDLE_ERRORS.MALFORMED_HASH,
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('one changed byte in a bundle refuses the whole bundle', async () => {
  const store = await stageSource(
    path.join(a.dir, 'files'),
    path.join(scratch, 'tamper-files'),
  );
  // Rebuild into its own store so the tampering cannot affect the other tests.
  const tamperStore = path.join(scratch, 'tamper-store');
  const built = await buildBundle({ storeDir: tamperStore, sourceRoot: store });
  const target = path.join(built.dir, 'files/server/export/canvas-document.js');
  const source = await readFile(target, 'utf8');
  await writeFile(target, `${source}\n// one more byte\n`);
  await assert.rejects(
    () => openRendererBundle(tamperStore, built.rendererHash),
    (err) =>
      err.code === RENDERER_BUNDLE_ERRORS.CORRUPT &&
      /canvas-document\.js/.test(err.message),
  );
});

test('a missing file, and a file nobody declared, both refuse', async () => {
  const base = await stageSource(
    path.join(a.dir, 'files'),
    path.join(scratch, 'incomplete-files'),
  );
  const store = path.join(scratch, 'incomplete-store');
  const built = await buildBundle({ storeDir: store, sourceRoot: base });

  await rm(path.join(built.dir, 'files/server/export/reader-document.js'));
  await assert.rejects(
    () => openRendererBundle(store, built.rendererHash),
    (err) =>
      err.code === RENDERER_BUNDLE_ERRORS.INCOMPLETE &&
      /reader-document\.js/.test(err.message),
  );

  const second = path.join(scratch, 'planted-store');
  const planted = await buildBundle({ storeDir: second, sourceRoot: base });
  await writeFile(
    path.join(planted.dir, 'files/server/export/extra.js'),
    'export const backdoor = 1;\n',
  );
  await assert.rejects(
    () => openRendererBundle(second, planted.rendererHash),
    (err) =>
      err.code === RENDERER_BUNDLE_ERRORS.INCOMPLETE &&
      /does not name/.test(err.message),
  );
});

test('a manifest edited to match its own tampering still refuses', async () => {
  const base = await stageSource(
    path.join(a.dir, 'files'),
    path.join(scratch, 'remanifest-files'),
  );
  const store = path.join(scratch, 'remanifest-store');
  const built = await buildBundle({ storeDir: store, sourceRoot: base });
  const manifestPath = path.join(built.dir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.files[0].sha256 = '0'.repeat(64);
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(
    () => openRendererBundle(store, built.rendererHash),
    (err) => err.code === RENDERER_BUNDLE_ERRORS.CORRUPT,
    'the directory name is a claim about the manifest bytes',
  );
});

test('an edition input of an unknown schema refuses', async () => {
  const bundle = await openRendererBundle(
    path.join(scratch, 'store'),
    a.rendererHash,
  );
  await assert.rejects(
    () =>
      renderTrustedEditionForProof(bundle, {
        ...frozenEditionInput(),
        schema: 'deckyard.edition-input/2',
      }),
    (err) => err.code === RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
  );
  await assert.rejects(
    () =>
      renderTrustedEditionForProof(bundle, {
        schema: 'deckyard.edition-input/1',
      }),
    (err) => err.code === RENDERER_BUNDLE_ERRORS.INPUT_INVALID,
  );
});

test('a slide type the bundle does not carry refuses, by name', async () => {
  const bundle = await openRendererBundle(
    path.join(scratch, 'store'),
    a.rendererHash,
  );
  const input = frozenEditionInput();
  input.presentation.slides[1].type = 'org-custom-hero';
  await assert.rejects(
    () => renderTrustedEditionForProof(bundle, input),
    (err) =>
      err.code === RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT &&
      /org-custom-hero/.test(err.message),
    'a database-backed slide type must refuse, not render from the current registry',
  );
});

test('author markup in a markup field refuses: the sanitizer is not in the bundle', () => {
  // No core slide type declares `markup: true` today, so the registry is given
  // here. A fork type may declare one, and then this is the branch that runs.
  const registry = {
    'fork-embed-slide': {
      fields: [{ key: 'code', type: 'code', markup: true }],
    },
  };
  const presentation = {
    slides: [
      { id: 's1', type: 'fork-embed-slide', content: { code: '<b>hi</b>' } },
    ],
  };
  assert.throws(
    () => assertSealableEdition(presentation, registry),
    (err) =>
      err.code === RENDERER_BUNDLE_ERRORS.UNSEALABLE_INPUT &&
      /author markup/.test(err.message),
  );
  // An empty markup field needs no sanitizer, so it is not a refusal.
  assert.doesNotThrow(() =>
    assertSealableEdition(
      { slides: [{ id: 's1', type: 'fork-embed-slide', content: {} }] },
      registry,
    ),
  );
});

test('production execution refuses before inspecting or running a bundle', async () => {
  const bundle = new Proxy(
    {},
    {
      get() {
        assert.fail('a blocked runner must not inspect bundle paths');
      },
    },
  );
  await assert.rejects(
    () => renderEditionInBundle(bundle, frozenEditionInput()),
    { code: RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE },
  );
});

test('counterproof: getBuiltinModule opens real TCP despite the filter and scan', async (t) => {
  const connections = [];
  const listener = net.createServer((socket) => {
    connections.push(true);
    socket.end('local-proof');
  });
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => listener.close(resolve)));
  const probeDir = path.join(scratch, 'network-counterproof');
  await mkdir(probeDir);
  const probe = path.join(probeDir, 'probe.mjs');
  // The source contains no imports. Even a dependency scanner that rejects
  // literal calls to getBuiltinModule would not be a runtime boundary.
  await writeFile(
    probe,
    `
const socket = process.getBuiltinModule('net').connect(${listener.address().port}, '127.0.0.1');
socket.setTimeout(2000, () => { socket.destroy(); process.exitCode = 1; });
socket.on('data', bytes => process.stdout.write(bytes));
socket.on('error', () => { process.exitCode = 1; });
`,
  );
  assert.deepEqual((await scanClosure(probeDir, ['probe.mjs'])).reasons, []);
  const launcher = path.join(probeDir, 'launcher.mjs');
  await writeFile(
    launcher,
    `
import { sealNetwork } from ${JSON.stringify(path.join(a.dir, 'files/server/render/renderer-bundle/bundle/net-guard.js'))};
sealNetwork();
await import('./probe.mjs');
`,
  );
  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      rendererWorkerArgs({
        script: launcher,
        readable: [a.dir, probeDir],
      }),
      { env: workerEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, 'local-proof');
  assert.equal(connections.length, 1);
});
