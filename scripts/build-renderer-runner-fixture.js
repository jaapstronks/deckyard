#!/usr/bin/env node
// Operator-only adversarial fixture builder. Never changes the trusted image.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalManifestBytes,
  sha256Hex,
} from '../server/render/renderer-bundle/manifest.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [storeArg, scratchArg] = process.argv.slice(2);
if (!storeArg || !scratchArg || process.version !== 'v24.22.1')
  throw new Error(
    'usage: Node 24.22.1 build-renderer-runner-fixture.js <source-store> <new-scratch>',
  );
const store = path.resolve(storeArg),
  scratch = path.resolve(scratchArg);
mkdirSync(scratch, { mode: 0o700 });
execFileSync('/usr/bin/cc', [
  '-O2',
  '-g0',
  '-Wall',
  '-Wextra',
  '-Werror',
  '-shared',
  '-fPIC',
  `-I${path.resolve(process.execPath, '../../include/node')}`,
  `${root}/tests/fixtures/renderer-runner/probe.c`,
  '-o',
  `${scratch}/probe.node`,
]);
const entries = [
  [
    'worker.js',
    readFileSync(`${root}/tests/fixtures/renderer-runner/worker.js`),
  ],
  ['probe.node', readFileSync(`${scratch}/probe.node`)],
  ['package.json', Buffer.from('{"type":"module"}\n')],
];
const manifest = canonicalManifestBytes({
  schema: 'deckyard.renderer-bundle/1',
  entry: 'worker.js',
  worker: 'worker.js',
  files: entries.map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha256Hex(bytes),
  })),
  unsealed: [],
});
const hash = sha256Hex(manifest),
  bundle = path.join(store, hash);
mkdirSync(`${bundle}/files`, { recursive: true });
writeFileSync(`${bundle}/manifest.json`, manifest);
for (const [name, bytes] of entries)
  writeFileSync(`${bundle}/files/${name}`, bytes);
process.stdout.write(`${hash}\n`);
