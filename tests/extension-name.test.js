import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  assertExtensionDeclared,
  installationExtensionName,
} from '../server/export/extension-name.js';

test('loaded extension code requires one installation name', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckyard-extension-'));
  try {
    const custom = path.join(root, 'custom');
    await fs.mkdir(path.join(custom, 'slide-types'), { recursive: true });
    assert.equal(await assertExtensionDeclared(root), null);
    await fs.writeFile(
      path.join(custom, 'slide-types', 'example.js'),
      'export default {}',
    );
    await assert.rejects(assertExtensionDeclared(root), /extension.json/);
    await fs.writeFile(
      path.join(custom, 'extension.json'),
      JSON.stringify({ name: 'nl.example' }),
    );
    assert.equal(await assertExtensionDeclared(root), 'nl.example');
    assert.equal(await installationExtensionName(root), 'nl.example');
    await fs.writeFile(
      path.join(custom, 'extension.json'),
      JSON.stringify({ name: 'nl.example', permissions: ['admin'] }),
    );
    await assert.rejects(assertExtensionDeclared(root), /one non-empty name/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
