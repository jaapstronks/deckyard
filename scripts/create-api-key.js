#!/usr/bin/env node

/**
 * Create a Deckyard API key from the command line.
 *
 * Usage:
 *   node scripts/create-api-key.js --email you@example.com --name "My MCP Key"
 *   node scripts/create-api-key.js --email you@example.com --name "My MCP Key" --scopes read,write,ai
 *
 * The full API key is printed once — save it, it cannot be retrieved later.
 */

import { loadDotEnv } from '../server/config/env.js';
import { repoRoot } from '../server/config/paths.js';
import { initializeStorage, closeStorage } from '../server/storage/adapters/index.js';
import { createApiKey } from '../server/storage/api-keys.js';

const args = process.argv.slice(2);

function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

async function main() {
  const email = getArg('email');
  const name = getArg('name') || 'MCP Key';
  const scopesStr = getArg('scopes') || 'read,write,ai';
  const scopes = scopesStr.split(',').map(s => s.trim());

  if (!email) {
    console.error('Usage: node scripts/create-api-key.js --email you@example.com [--name "Key name"] [--scopes read,write,ai]');
    process.exit(1);
  }

  await loadDotEnv(repoRoot);
  await initializeStorage(repoRoot);

  const result = await createApiKey({ name, ownerEmail: email, scopes }, { repoRoot });

  if (!result.ok) {
    console.error('Failed to create API key:', result.reason);
    process.exit(1);
  }

  console.log('');
  console.log('✅ API key created');
  console.log('');
  console.log(`  Name:   ${result.name}`);
  console.log(`  Email:  ${email}`);
  console.log(`  Scopes: ${scopes.join(', ')}`);
  console.log(`  Prefix: ${result.prefix}`);
  console.log('');
  console.log(`  🔑 Key: ${result.key}`);
  console.log('');
  console.log('  Save this key — it cannot be retrieved later.');
  console.log('');
  console.log('  Usage with MCP SSE transport:');
  console.log(`    curl -X POST http://localhost:4177/mcp \\`);
  console.log(`      -H "Authorization: Bearer ${result.key}" \\`);
  console.log(`      -H "Content-Type: application/json" \\`);
  console.log(`      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'`);

  await closeStorage();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
