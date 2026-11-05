/**
 * The OpenClaw script sends each MCP tool the arguments its schema names
 * (DY-841).
 *
 * `deckyard.py get` sent `{'id': ...}` to `get_presentation`, whose schema
 * requires `presentationId`, so the server refused every call. This reads
 * each `tool_call(...)` in the script, collects the argument keys the command
 * can send, and holds them to the registered tool's `inputSchema`: every key
 * is a property, every required property is sent.
 *
 * Run with: node --test tests/openclaw-script-tool-args.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { McpServer } from '../server/mcp/protocol.js';
import { registerTools } from '../server/mcp/tools.js';

const SCRIPT = path.join(
  process.cwd(),
  'skills/openclaw-skill/scripts/deckyard.py',
);

/** Each `def cmd_*` body with the tool it calls and the keys it can send. */
function scriptCalls(source) {
  const bodies = source.split(/^def /m).filter((b) => b.startsWith('cmd_'));
  return bodies.flatMap((body) => {
    const call = body.match(/tool_call\('([a-z_]+)'/);
    if (!call) return [];
    const keys = new Set();
    for (const m of body.matchAll(/'([A-Za-z_]+)'\s*:/g)) keys.add(m[1]);
    for (const m of body.matchAll(/arguments\['([A-Za-z_]+)'\]\s*=/g)) {
      keys.add(m[1]);
    }
    return [{ command: body.match(/^(cmd_\w+)/)[1], tool: call[1], keys }];
  });
}

const server = new McpServer();
registerTools(server, {});
const calls = scriptCalls(fs.readFileSync(SCRIPT, 'utf8'));

test('the parser finds every command that calls a tool', () => {
  assert.deepEqual(
    calls.map((c) => c.command),
    [
      'cmd_create',
      'cmd_list',
      'cmd_get',
      'cmd_iterate',
      'cmd_url',
      'cmd_list_themes',
      'cmd_validate',
      'cmd_append',
    ],
  );
});

for (const { command, tool, keys } of calls) {
  test(`${command} sends ${tool} only arguments its schema names`, () => {
    const registered = server.tools.get(tool);
    assert.ok(registered, `${tool} is a registered tool`);
    const schema = registered.inputSchema ?? registered.schema ?? {};
    const properties = Object.keys(schema.properties ?? {});
    for (const key of keys) {
      assert.ok(properties.includes(key), `${tool} has no argument ${key}`);
    }
    for (const key of schema.required ?? []) {
      assert.ok(keys.has(key), `${command} never sends required ${key}`);
    }
  });
}
