import test from 'node:test';
import assert from 'node:assert/strict';
import { createFakeDb } from './helpers/fake-db.js';
import { __setTestDb } from '../server/db/client.js';
import { crossOrganizationScope } from '../server/storage/scope.js';
import { requestGuestVerification } from '../server/storage/share-links/guests.js';

const ORG_A = 'org-alpha';
const ORG_B = 'org-beta';

function setup() {
  const db = createFakeDb({
    presentation_share_links: [
      {
        id: 'beta-link',
        organization_id: ORG_B,
        permission: 'comment',
        revoked_at: null,
      },
    ],
    share_link_guests: [
      {
        id: 'existing-guest',
        organization_id: ORG_B,
        share_link_id: 'beta-link',
        email: 'existing@example.com',
        name: 'Original',
        verification_token: 'original-token',
      },
    ],
  });
  __setTestDb(db);
  return db;
}

test.after(() => __setTestDb(null));

test('a foreign organization can neither create nor update share-link guests', async () => {
  const db = setup();
  const before = structuredClone(db.__tables.share_link_guests);
  for (const email of ['new@example.com', 'existing@example.com']) {
    assert.deepEqual(
      await requestGuestVerification(
        { organizationId: ORG_A },
        'beta-link',
        email,
        'Changed',
      ),
      { ok: false, reason: 'share_link_not_found' },
    );
    assert.deepEqual(db.__tables.share_link_guests, before);
  }
});

test('the owning organization and a prevalidated public token can create and update guests', async () => {
  for (const scope of [
    { organizationId: ORG_B },
    crossOrganizationScope(null, 'public share token already validated'),
  ]) {
    const db = setup();
    for (const email of ['new@example.com', 'existing@example.com']) {
      const result = await requestGuestVerification(
        scope,
        'beta-link',
        email,
        'Changed',
      );
      assert.equal(result.ok, true);
      const guest = db.__tables.share_link_guests.find(
        (row) => row.id === result.guestId,
      );
      assert.equal(guest.organization_id, ORG_B);
      assert.equal(guest.name, 'Changed');
      assert.equal(guest.verification_token, result.verificationToken);
      assert.notEqual(guest.verification_token, 'original-token');
    }
    assert.equal(db.__tables.share_link_guests.length, 2);
  }
});
