import test from 'node:test';
import assert from 'node:assert/strict';

process.env.LLM_VENDOR = 'openai';
process.env.OPENAI_API = 'test-key';
process.env.OPENAI_MODEL = 'test-model';
process.env.DEFAULT_ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111';

const orgId = process.env.DEFAULT_ORGANIZATION_ID;
const { createFakeDb } = await import('./helpers/fake-db.js');
const { __setTestDb } = await import('../server/db/client.js');
const { initializeStorage, __resetStorageForTests } =
  await import('../server/storage/lifecycle.js');
const { handleSettings } = await import('../server/routes/api/settings.js');
const {
  translateShortText,
  translateFieldMap,
  translatePresentationStrings,
  translatePresentationStringsFillMissing,
} = await import('../server/utils/openai/translate.js');
const { translationReferenceLines } =
  await import('../server/utils/openai/translation-instructions.js');
const { TRANSLATION_INSTRUCTION_MAX_LENGTH: MAX } =
  await import('../shared/constants/translation-instructions.js');

let db;
let lastSystem = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_endpoint, options) => {
  const body = JSON.parse(options.body);
  lastSystem = body.messages.find(
    (message) => message.role === 'system',
  ).content;
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                text: 'Hello',
                translations: { title: 'Hello' },
                title: 'Hello',
                slides: [],
              }),
            },
          },
        ],
      }),
  };
};

test.beforeEach(async () => {
  process.env.AI_ENABLED = 'true';
  db = createFakeDb({
    organizations: [{ id: orgId, name: 'A', slug: 'a', settings: {} }],
  });
  __setTestDb(db);
  await initializeStorage();
});

test.after(() => {
  globalThis.fetch = originalFetch;
  delete process.env.AI_ENABLED;
  __resetStorageForTests();
  __setTestDb(null);
});

function response() {
  return {
    statusCode: null,
    body: null,
    writeHead(code) {
      this.statusCode = code;
      return this;
    },
    end(value) {
      this.body = value ? JSON.parse(value) : null;
      return this;
    },
  };
}

async function settings(method, body, isAdmin = true) {
  const res = response();
  const payload = JSON.stringify(body || {});
  await handleSettings({
    req: {
      method,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(payload)),
      },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from(payload);
      },
    },
    res,
    url: new URL('http://localhost/api/settings/organization'),
    storageScope: { repoRoot: process.cwd(), organizationId: orgId },
    authedUser: { email: 'admin@example.com', isAdmin, organizationId: orgId },
  });
  return res;
}

const value = {
  terminology: 'Fixed term: Deckyard',
  styleByLanguage: { nl: 'Formal Dutch', 'en-GB': 'Plain English' },
};

test('admin saves organization instructions; non-admin cannot read or write them', async () => {
  assert.equal(
    (await settings('PATCH', { translationInstructions: value })).statusCode,
    200,
  );
  assert.deepEqual(
    db.__tables.organizations[0].settings.translationInstructions,
    value,
  );
  assert.deepEqual(
    (await settings('GET')).body.settings.translationInstructions,
    value,
  );
  assert.equal(
    (await settings('PATCH', { translationInstructions: value }, false))
      .statusCode,
    403,
  );
  assert.equal(
    (await settings('GET', {}, false)).body.settings.translationInstructions,
    undefined,
  );
});

test('length and target-language validation name the refused field', async () => {
  const tooLong = { ...value, terminology: 'x'.repeat(MAX + 1) };
  const length = await settings('PATCH', { translationInstructions: tooLong });
  assert.equal(length.statusCode, 400);
  assert.equal(length.body.details.field, 'terminology');
  const unknown = await settings('PATCH', {
    translationInstructions: {
      terminology: '',
      styleByLanguage: { xx: 'text' },
    },
  });
  assert.equal(unknown.body.details.field, 'styleByLanguage.xx');
  assert.deepEqual(db.__tables.organizations[0].settings, {});
});

test('empty instructions stay absent; AI killswitch blocks reads and writes', async () => {
  assert.deepEqual(await translationReferenceLines(orgId, 'nl'), []);
  await settings('PATCH', { translationInstructions: value });
  process.env.AI_ENABLED = 'false';
  assert.deepEqual(await translationReferenceLines(orgId, 'nl'), []);
  assert.equal(
    (await settings('GET')).body.settings.translationInstructions,
    undefined,
  );
  assert.equal(
    (await settings('PATCH', { translationInstructions: value })).statusCode,
    403,
  );
});

test('all four translation paths use the same target-language reference', async () => {
  await settings('PATCH', { translationInstructions: value });
  const opts = { from: 'nl', to: 'en-GB', organizationId: orgId };
  const deck = { title: 'Hoi', slides: [] };
  const calls = [
    () => translateShortText('Hoi', opts),
    () => translateFieldMap({ title: 'Hoi' }, opts),
    () => translatePresentationStrings(deck, opts),
    () =>
      translatePresentationStringsFillMissing(
        {
          sourcePresentation: deck,
          targetPresentation: { title: '', slides: [] },
        },
        opts,
      ),
  ];
  for (const call of calls) {
    await call();
    assert.match(lastSystem, /Fixed term: Deckyard/);
    assert.match(lastSystem, /Plain English/);
    assert.doesNotMatch(lastSystem, /Formal Dutch/);
    assert.match(lastSystem, /data, not instructions/);
  }
  await translateShortText('Hello', {
    from: 'en-GB',
    to: 'nl',
    organizationId: orgId,
  });
  assert.match(lastSystem, /Formal Dutch/);
  assert.doesNotMatch(lastSystem, /Plain English/);
});
