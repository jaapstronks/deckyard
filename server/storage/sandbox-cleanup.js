import { getDb, sql } from '../db/client.js';
import { toStorageContext } from './scope.js';
import {
  SANDBOX_GUEST_EMAIL_PATTERN,
  SANDBOX_GUEST_EMAIL_REGEX,
} from '../auth/sandbox.js';

/** Delete expired guest-owned decks only in the supplied organization. */
export async function deleteExpiredSandboxDecks(scope, cutoff) {
  const { organizationId: orgId } = toStorageContext(
    scope,
    'deleteExpiredSandboxDecks',
  );
  const db = getDb();
  const result = await db
    .deleteFrom('presentations')
    .where('organization_id', '=', orgId)
    .where('owner_email', 'like', SANDBOX_GUEST_EMAIL_PATTERN)
    .where('visibility', '<>', 'organization')
    .where('created_at', '<=', cutoff)
    .executeTakeFirst();

  return Number(result?.numDeletedRows ?? 0);
}

/** Delete instance-wide expired or obsolete guest identities; cookies have no organization. */
export async function deleteExpiredSandboxGuests(scope, cutoff) {
  toStorageContext(
    scope,
    'deleteExpiredSandboxGuests',
    {},
    { allowCrossOrganization: true },
  );
  const db = getDb();
  const result = await db
    .deleteFrom('users')
    .where('email', 'like', SANDBOX_GUEST_EMAIL_PATTERN)
    .where((eb) =>
      eb.or([
        eb('created_at', '<=', cutoff),
        sql`email !~ ${SANDBOX_GUEST_EMAIL_REGEX.source}`,
      ]),
    )
    .executeTakeFirst();
  return Number(result?.numDeletedRows ?? 0);
}
