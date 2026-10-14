import test from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';

const eslint = new ESLint();

test('server consumers cannot import SQL, handles or the storage guard', async () => {
  for (const source of [
    'kysely',
    '../db/client.js',
    '../storage/utils/index.js',
    '../storage/utils/db-guard.js',
  ]) {
    for (const filePath of [
      'server/auth/boundary-probe.js',
      'server/utils/ai/schemas/boundary-probe.js',
    ]) {
      const [result] = await eslint.lintText(
        `import * as database from '${source}';\nexport { database };\n`,
        { filePath },
      );
      assert.ok(
        result.messages.some(
          (message) => message.ruleId === 'no-restricted-imports',
        ),
        source,
      );
    }
  }
});

test('storage can import database primitives through its canonical paths', async () => {
  const [result] = await eslint.lintText(
    "import { getDb } from '../db/client.js';\nexport { getDb };\n",
    { filePath: 'server/storage/boundary-probe.js' },
  );
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});
