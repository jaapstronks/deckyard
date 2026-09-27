import { before, after, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openTestDb,
  closeTestDb,
  installFacadeStorage,
  uninstallFacadeStorage,
  pgDescribe,
  truncate,
} from './helpers/harness.js';
import { seedDefaultOrganization, seedPresentation } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  getPresentation,
  updatePresentation,
  duplicatePresentation,
  createPresentationVersion,
  getPresentationVersion,
} from '../../server/storage/presentations/index.js';

pgDescribe('extension provenance in PostgreSQL', () => {
  let db;
  let id;
  const scope = testScope();

  before(async () => {
    db = await openTestDb();
    await installFacadeStorage();
    await truncate(db, 'organizations');
    await seedDefaultOrganization(db);
    id = await seedPresentation(db);
  });

  after(async () => {
    uninstallFacadeStorage();
    await closeTestDb(db);
  });

  it('defaults to [], then preserves imported names through save, snapshot, restore and duplication', async () => {
    const initial = await getPresentation(scope, id);
    assert.deepEqual(initial.extensions, []);
    const names = ['nl.ciiic', 'old.extension'];
    const imported = await updatePresentation(scope, id, { extensions: names });
    assert.deepEqual(imported.extensions, names);
    const saved = await updatePresentation(scope, id, { title: 'Saved' });
    assert.deepEqual(saved.extensions, names);

    const version = await createPresentationVersion(scope, id, saved);
    const snapshot = await getPresentationVersion(scope, id, version.id);
    assert.deepEqual(snapshot.presentation.extensions, names);
    await updatePresentation(scope, id, { extensions: [] });
    const restored = await updatePresentation(scope, id, snapshot.presentation);
    assert.deepEqual(restored.extensions, names);

    const duplicate = await duplicatePresentation(scope, id);
    assert.equal(duplicate.ok, true);
    assert.deepEqual(duplicate.presentation.extensions, names);
  });
});
