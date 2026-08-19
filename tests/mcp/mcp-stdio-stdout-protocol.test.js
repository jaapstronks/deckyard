/**
 * The stdio MCP entrypoint must write **only** JSON-RPC to stdout.
 *
 * A single stray line there makes the client (Claude Desktop, Cursor, …) see
 * invalid JSON and drop the connection. The dangerous window is *import time*:
 * ESM evaluates every import before the importing module's body, so anything
 * `server/mcp/index.js` logged from its own body ran too late to catch the
 * registry and loader banners. `server/mcp/stdout-guard.js` closes that window
 * by being the first import; these tests pin both halves — the behaviour (boot
 * with a fork slide type installed, every stdout line parses) and the ordering
 * invariant that makes it work.
 *
 * Run with: node --test tests/mcp/mcp-stdio-stdout-protocol.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const ENTRYPOINT = path.join(REPO_ROOT, 'server', 'mcp', 'index.js');
const CUSTOM_DIR = path.join(REPO_ROOT, 'custom', 'slide-types');
const FIXTURE = 'fork-alpha-slide.js';
const FIXTURE_SRC = path.join(
  REPO_ROOT,
  'tests',
  'fixtures',
  'fork-slide-types',
  FIXTURE,
);

const INITIALIZE = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'stdout-guard-test', version: '1' },
  },
};

/**
 * Install the fork fixture into custom/slide-types/ unless the tree already has
 * it (the `test-fork` CI job copies the whole fixture tree in beforehand).
 * @returns {() => void} cleanup that removes only what this call created
 */
function installForkFixture() {
  const target = path.join(CUSTOM_DIR, FIXTURE);
  if (existsSync(target)) return () => {};
  const createdDir = !existsSync(CUSTOM_DIR);
  mkdirSync(CUSTOM_DIR, { recursive: true });
  copyFileSync(FIXTURE_SRC, target);
  return () => {
    rmSync(target, { force: true });
    if (createdDir) rmSync(CUSTOM_DIR, { recursive: true, force: true });
  };
}

/**
 * Boot the stdio server, send one initialize request, and collect both streams.
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function bootAndInitialize() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRYPOINT], {
      cwd: REPO_ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.kill('SIGTERM');
      resolve({ stdout, stderr });
    };

    const deadline = setTimeout(finish, 60_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      // The response frame is newline-delimited; one complete line is enough.
      if (stdout.includes('\n')) finish();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('exit', finish);

    child.stdin.write(JSON.stringify(INITIALIZE) + '\n');
  });
}

describe('MCP stdio transport — stdout carries protocol only', () => {
  it('boots with a fork slide type installed and writes only JSON to stdout', async () => {
    const cleanup = installForkFixture();
    let result;
    try {
      result = await bootAndInitialize();
    } finally {
      cleanup();
    }

    // Proof the noisy code path actually ran: without the guard this banner is
    // exactly what lands in the JSON-RPC stream.
    assert.match(
      result.stderr,
      /\[custom-loader\] Loaded custom slide type: fork-alpha-slide/,
      `expected the custom loader to announce the fixture on stderr; stderr was:\n${result.stderr}`,
    );

    const lines = result.stdout.split('\n').filter((l) => l.trim() !== '');
    assert.ok(
      lines.length > 0,
      `expected an initialize response on stdout; stderr was:\n${result.stderr}`,
    );
    const frames = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        assert.fail(`non-JSON line on stdout: ${JSON.stringify(line)}`);
      }
    });
    const response = frames.find((f) => f.id === 1);
    assert.ok(response, 'no JSON-RPC response for the initialize request');
    assert.equal(response.result?.serverInfo?.name, 'deckyard');
  });

  it('imports the stdout guard before any other module', () => {
    const source = readFileSync(ENTRYPOINT, 'utf8');
    // Any top-level `import …` or `export … from …` statement links a module
    // that evaluates before this file's body — so the first such line, not
    // just the first `import`, has to be the guard.
    const firstImport = source.match(/^(?:import|export)\b.*$/m);
    assert.ok(firstImport, 'no import statement found in the stdio entrypoint');
    assert.equal(
      firstImport[0],
      "import './stdout-guard.js';",
      'the stdout guard must be the first import — a later one runs after the ' +
        'modules it is meant to silence have already logged',
    );
  });
});
