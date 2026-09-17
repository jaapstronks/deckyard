/**
 * `node server/mcp/index.js --help` lists what the server registers.
 * Run with: node --test tests/mcp/mcp-help.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { McpServer } from '../../server/mcp/protocol.js';
import { registerTools } from '../../server/mcp/tools.js';
import { registerPrompts } from '../../server/mcp/prompts.js';
import { helpText, summaryOf } from '../../server/mcp/help.js';

const INDEX = fileURLToPath(
  new URL('../../server/mcp/index.js', import.meta.url),
);

/** Section body between a heading line and the next blank line. */
function section(text, heading) {
  const start = text.indexOf(`\n${heading}`);
  assert.notStrictEqual(start, -1, `no ${heading} section`);
  const body = text.slice(text.indexOf('\n', start + 1) + 1);
  return body.slice(0, body.indexOf('\n\n'));
}

/** First column of a two-column section. */
function names(text, heading) {
  return section(text, heading)
    .split('\n')
    .map((line) => line.trim().split(/\s+/)[0]);
}

describe('MCP --help', () => {
  it('names every registered tool and prompt, in registration order', () => {
    const server = new McpServer();
    registerTools(server);
    registerPrompts(server);
    const text = helpText(server, { repoRoot: '/repo' });
    assert.deepStrictEqual(names(text, 'TOOLS'), [...server.tools.keys()]);
    assert.deepStrictEqual(names(text, 'PROMPTS'), [...server.prompts.keys()]);
  });

  it('includes tools added by a fork registrar', () => {
    const server = new McpServer();
    registerTools(server, {
      registerCustom: (srv) => {
        srv.tool(
          'fork_probe',
          'Inspect the fork. More detail.',
          {},
          async () => ({}),
        );
      },
    });
    const text = helpText(server, { repoRoot: '/repo' });
    assert.deepStrictEqual(names(text, 'TOOLS'), [...server.tools.keys()]);
    assert.match(text, /^ {2}fork_probe\s+Inspect the fork\.$/m);
  });

  it('the CLI prints the help built from the running registry', () => {
    const run = spawnSync(process.execPath, [INDEX, '--help'], {
      encoding: 'utf8',
    });
    assert.strictEqual(run.status, 0, run.stderr);
    const server = new McpServer();
    registerTools(server);
    registerPrompts(server);
    for (const name of [...server.tools.keys(), ...server.prompts.keys()]) {
      assert.match(run.stderr, new RegExp(`^  ${name}\\s`, 'm'));
    }
  });

  it('summarizes a description by its first sentence', () => {
    assert.strictEqual(summaryOf('One thing. Then more.'), 'One thing.');
    assert.strictEqual(
      summaryOf('Reply (e.g. "fixed in slide 7"). Replying attaches.'),
      'Reply (e.g. "fixed in slide 7").',
    );
    assert.strictEqual(summaryOf('No full stop'), 'No full stop');
  });
});
