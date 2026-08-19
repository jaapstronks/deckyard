/**
 * The authorization **read** path keyed on `users.id` (T10, PR A), end to end
 * against real PostgreSQL.
 *
 * PR 3 filled `presentations.owner_user_id`/`created_by_user_id` on write and
 * pinned those columns (presentation-owner-user-id.pgtest.js); nothing read
 * them. This file proves the other end: a deck stored by the PostgreSQL adapter
 * comes back carrying its ids, and the deciders use them.
 *
 * The pure rule is covered in tests/authz-identity-key.test.js. What only a real
 * database can show is the seam between them — that `getPresentation` and
 * `listPresentations` actually project the id columns, so the deciders are not
 * silently falling back to the email for every deck in production. A regression
 * there would leave every test in the pure file green.
 *
 * Runs only against a throwaway database named by DATABASE_URL — see
 * tests/pg/helpers/harness.js and docs/developer/pg-test-suite.md.
 *
 * Run with: DATABASE_URL=… npm run test:pg
 */

import { after, before, beforeEach, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeTestDb,
  installFacadeStorage,
  openTestDb,
  pgDescribe,
  truncate,
  uninstallFacadeStorage,
} from './helpers/harness.js';
import { seedDefaultOrganization } from './helpers/seed.js';
import { testScope } from '../helpers/storage-scope.js';
import {
  createPresentation,
  getPresentation,
  listPresentations,
} from '../../server/storage/presentations/index.js';
import {
  canReadPresentation,
  canWritePresentation,
  canActorAccessPresentation,
} from '../../server/utils/presentation-authz.js';
import { belongsInCollection } from '../../server/routes/api/presentations/list.js';
import { getDefaultOrganizationId } from '../../server/config/database.js';

const ORG = getDefaultOrganizationId();
const storageScope = testScope();

const OWNER_EMAIL = 'owner@example.com';
const OWNER_ID = '11111111-1111-1111-1111-111111111111';
// A second user who happens to carry the owner's address as their login — the
// shape an email key cannot tell apart from the owner, and an id key can.
const TWIN_ID = '22222222-2222-2222-2222-222222222222';

pgDescribe(
  'presentation authorization reads on users.id (real PostgreSQL)',
  () => {
    /** @type {import('kysely').Kysely<any>} */
    let db;

    before(async () => {
      db = await openTestDb();
      await installFacadeStorage();
    });

    after(async () => {
      uninstallFacadeStorage();
      await closeTestDb(db);
    });

    beforeEach(async () => {
      await truncate(db, 'organizations');
      await seedDefaultOrganization(db);
      await db
        .insertInto('users')
        .values([
          {
            id: OWNER_ID,
            organization_id: ORG,
            email: OWNER_EMAIL,
            name: 'Owner',
            role: 'user',
          },
          {
            id: TWIN_ID,
            organization_id: ORG,
            email: 'twin@example.com',
            name: 'Twin',
            role: 'user',
          },
        ])
        .execute();
    });

    it('a stored deck comes back carrying the owner and creator ids', async () => {
      const created = await createPresentation(storageScope, {
        title: 'Deck',
        ownerEmail: OWNER_EMAIL,
      });
      const pres = await getPresentation(storageScope, created.id);

      assert.equal(pres.ownerId, OWNER_ID);
      assert.equal(pres.createdById, OWNER_ID);
      // The email stays beside it as display/contact.
      assert.equal(pres.ownerEmail, OWNER_EMAIL);
    });

    it('the owner is authorized by id, with an address the deck never saw', async () => {
      const created = await createPresentation(storageScope, {
        title: 'Deck',
        ownerEmail: OWNER_EMAIL,
      });
      const pres = await getPresentation(storageScope, created.id);

      const ownerUnderAnotherAddress = {
        id: OWNER_ID,
        email: 'owner-elsewhere@example.com',
      };
      assert.equal(
        canReadPresentation({ user: ownerUnderAnotherAddress, pres }),
        true,
      );
      assert.equal(
        canWritePresentation({ user: ownerUnderAnotherAddress, pres }),
        true,
      );
    });

    it("a different user carrying the owner's address is refused", async () => {
      const created = await createPresentation(storageScope, {
        title: 'Deck',
        ownerEmail: OWNER_EMAIL,
      });
      const pres = await getPresentation(storageScope, created.id);

      const twin = { id: TWIN_ID, email: OWNER_EMAIL };
      assert.equal(canReadPresentation({ user: twin, pres }), false);
      assert.equal(canWritePresentation({ user: twin, pres }), false);
      assert.equal(belongsInCollection({ user: twin, pres }), false);
    });

    it('a deck whose owner has no users row belongs to nobody', async () => {
      const external = 'nobody@external.test'; // deliberately NOT in `users`
      const created = await createPresentation(storageScope, {
        title: 'Deck',
        ownerEmail: external,
      });
      const pres = await getPresentation(storageScope, created.id);

      assert.equal(pres.ownerId, null); // defined NULL, the external/legacy path
      // The address is stamped on the row, but it is not a key: the retired
      // fallback (D22, decision (a)) is what let it act as one.
      assert.equal(
        canReadPresentation({ user: { id: TWIN_ID, email: external }, pres }),
        false,
      );
      assert.equal(
        canReadPresentation({
          user: { id: TWIN_ID, email: 'twin@example.com' },
          pres,
        }),
        false,
      );
    });

    it('the machine-client check resolves the actor email to the same id', async () => {
      const created = await createPresentation(storageScope, {
        title: 'Deck',
        ownerEmail: OWNER_EMAIL,
      });
      const pres = await getPresentation(storageScope, created.id);

      // The API-key/MCP surfaces know only an email; actor-access resolves it.
      assert.equal(
        await canActorAccessPresentation(
          pres,
          { email: OWNER_EMAIL, organizationId: ORG },
          'write',
        ),
        true,
      );
      assert.equal(
        await canActorAccessPresentation(
          pres,
          { email: 'twin@example.com', organizationId: ORG },
          'read',
        ),
        false,
      );
    });

    it('the collection listing projects the ids too, so the list filter keys on them', async () => {
      await createPresentation(storageScope, {
        title: 'Deck',
        ownerEmail: OWNER_EMAIL,
      });
      const list = await listPresentations(storageScope);
      const summary = list.find((p) => p.title === 'Deck');

      assert.equal(summary.ownerId, OWNER_ID);
      assert.equal(summary.createdById, OWNER_ID);
      // Same conclusions as the per-deck reads, from the summary shape.
      assert.equal(
        belongsInCollection({
          user: { id: OWNER_ID, email: 'x@example.com' },
          pres: summary,
        }),
        true,
      );
      assert.equal(
        belongsInCollection({
          user: { id: TWIN_ID, email: OWNER_EMAIL },
          pres: summary,
        }),
        false,
      );
    });
  },
);
