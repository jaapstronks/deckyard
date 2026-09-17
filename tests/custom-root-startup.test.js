import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));

// Preserve symlink paths so real entrypoints see this installation's .env,
// without writing fixtures into the working tree or copying node_modules.
function installation(t, value) {
  const root = mkdtempSync(path.join(tmpdir(), 'deckyard-env-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, 'app');
  const fork = path.join(root, 'fork with spaces');
  mkdirSync(app);
  mkdirSync(path.join(fork, 'styles'), { recursive: true });
  writeFileSync(
    path.join(fork, 'styles/probe.css'),
    '.env-probe { color: red; }',
  );
  mkdirSync(path.join(fork, 'slide-types'), { recursive: true });
  for (const entry of readdirSync(repoRoot)) {
    if (entry.startsWith('.')) continue;
    symlinkSync(path.join(repoRoot, entry), path.join(app, entry));
  }
  copyFileSync(
    path.join(repoRoot, 'tests/fixtures/fork-slide-types/fork-alpha-slide.js'),
    path.join(fork, 'slide-types/fork-alpha-slide.js'),
  );
  writeFileSync(path.join(fork, 'package.json'), '{"type":"module"}');
  writeFileSync(
    path.join(fork, 'mcp-tools.js'),
    `export default (server) => server.tool('env_fork_probe', 'Env fork probe.',
      { type: 'object', properties: {} }, async () => ({ content: [] }));`,
  );
  writeFileSync(
    path.join(app, '.env'),
    `DECKYARD_CUSTOM_DIR="${value ?? fork}"\n`,
  );
  return { app, fork };
}

function run(app, args, override) {
  const env = { ...process.env };
  delete env.DECKYARD_CUSTOM_DIR;
  if (override !== undefined) env.DECKYARD_CUSTOM_DIR = override;
  return spawnSync(
    process.execPath,
    ['--preserve-symlinks', '--preserve-symlinks-main', ...args],
    { cwd: app, env, encoding: 'utf8', timeout: 30_000 },
  );
}

const inspectHttp = [
  '--input-type=module',
  '-e',
  `await import('./server/server.js');
   const root = await import('./shared/custom-root.js');
   const { SHARED_PUBLIC_DIRS } = await import('./server/config/paths.js');
   const { readCustomStylesCss } = await import('./server/utils/css-chain.js');
   const { SLIDE_TYPES } = await import('./shared/slide-types/registry.js');
   process.env.DECKYARD_CUSTOM_DIR = '/changed-after-import';
   console.log(JSON.stringify({
     root: root.customDirFor('/another-installation'),
     slideTypes: root.CUSTOM_SLIDE_TYPES_DIR,
     fonts: root.CUSTOM_FONTS_FILE,
     mounts: SHARED_PUBLIC_DIRS.filter(m => m.urlPrefix.startsWith('/custom/')),
     loaded: !!SLIDE_TYPES['fork-alpha-slide'],
     css: readCustomStylesCss('/another-installation'),
   }));`,
];

test('HTTP imports load .env before fork loaders and static mounts snapshot it', (t) => {
  const { app, fork } = installation(t);
  const result = run(app, inspectHttp);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(output.root, fork);
  assert.equal(output.slideTypes, path.join(fork, 'slide-types'));
  assert.equal(output.fonts, path.join(fork, 'fonts.js'));
  assert.equal(output.css, '.env-probe { color: red; }');
  assert.equal(output.loaded, true);
  assert.deepEqual(output.mounts, [
    { urlPrefix: '/custom/assets/', dir: path.join(fork, 'assets') },
    { urlPrefix: '/custom/themes/', dir: path.join(fork, 'themes') },
  ]);
});

test('MCP help loads .env fork tools with stdout reserved for protocol', (t) => {
  const { app } = installation(t);
  const result = run(app, ['server/mcp/index.js', '--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /env_fork_probe/);
  assert.match(result.stderr, /Loaded custom slide type: fork-alpha-slide/);
});

test('process environment takes precedence over the installation .env', (t) => {
  const { app, fork } = installation(t, 'invalid-relative-env-path');
  const result = run(app, inspectHttp, fork);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(output.root, fork);
  assert.equal(output.loaded, true);
});

test('both entrypoints reject a relative custom root from .env', (t) => {
  const { app } = installation(t, 'relative-fork');
  for (const args of [inspectHttp, ['server/mcp/index.js', '--help']]) {
    const result = run(app, args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /DECKYARD_CUSTOM_DIR must be an absolute path/);
  }
});
