import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import {
  initializeStorage,
  __resetStorageForTests,
} from '../server/storage/lifecycle.js';
import { getDefaultThemeId } from '../server/storage/settings.js';
import { handleThemes } from '../server/routes/api/themes.js';

const ORG = '00000000-0000-0000-0000-0000000000aa';
const BRAND = '11111111-1111-4111-8111-111111111111';
const COPY = '22222222-2222-4222-8222-222222222222';
const scope = { organizationId: ORG, repoRoot: process.cwd() };

test('fresh settings expose the seed UUID as default and mark only that record', async () => {
  const previousEnv = process.env.DEFAULT_THEME;
  delete process.env.DEFAULT_THEME;
  __setTestDb(
    createFakeDb({
      organizations: [{ id: ORG, name: 'Default', slug: 'default' }],
      themes: [
        {
          id: BRAND,
          organization_id: null,
          slug: 'brand',
          label: 'Brand',
          colors: {},
          fonts: {},
          config: {},
        },
        {
          id: COPY,
          organization_id: ORG,
          slug: 'brand-copy',
          label: 'Brand Copy',
          colors: {},
          fonts: {},
          config: {},
        },
      ],
      app_settings: [{ id: true, settings: {} }],
    }),
  );
  try {
    await initializeStorage();
    assert.equal(await getDefaultThemeId(scope), BRAND);
    const res = {
      statusCode: null,
      body: null,
      writeHead(status) {
        this.statusCode = status;
        return this;
      },
      end(payload) {
        this.body = JSON.parse(payload);
        return this;
      },
    };
    await handleThemes({
      repoRoot: process.cwd(),
      storageScope: scope,
      req: { method: 'GET', headers: { host: 'localhost' } },
      res,
      url: new URL('http://localhost/api/themes'),
      authedUser: { organizationId: ORG, email: 'member@example.com' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.defaultThemeId, BRAND);
    assert.equal(
      res.body.themes.find((theme) => theme.id === BRAND).isDefault,
      true,
    );
    assert.equal(
      res.body.themes.find((theme) => theme.id === COPY).isDefault,
      false,
    );
  } finally {
    __resetStorageForTests();
    __setTestDb(null);
    if (previousEnv === undefined) delete process.env.DEFAULT_THEME;
    else process.env.DEFAULT_THEME = previousEnv;
  }
});
