/**
 * Collab Y.Doc state facade.
 *
 * Every function takes a **storage scope** rather than a bare `repoRoot`: the
 * organization comes from the caller, never from a default (see
 * server/storage/scope.js). A Y.Doc binary belongs to one deck in one
 * organization, so a write that guessed the organization would park collab
 * state on the wrong organization's deck.
 *
 * Queries run directly through Kysely (B79/D34 removed the adapter
 * indirection); getDb() throws on an uninitialized database. The binary is
 * stored in the `presentation_ydocs.state` bytea column: reads hand back a
 * `Uint8Array`, writes take one and land as a `Buffer`.
 */

import { getDb } from '../../db/client.js';
import { getOrgId } from '../../utils/context.js';
import { nowIso } from '../../utils/normalize.js';
import { toStorageContext } from '../scope.js';

/**
 * Read the stored Y.Doc state (one merged yjs update) for a presentation.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id - Presentation ID
 * @returns {Promise<Uint8Array|null>}
 */
export async function getYDocState(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'getYDocState');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const row = await db
    .selectFrom('presentation_ydocs')
    .select('state')
    .where('presentation_id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();

  if (!row?.state) return null;
  return new Uint8Array(row.state);
}

/**
 * Store the Y.Doc state for a presentation.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id - Presentation ID
 * @param {Uint8Array} state - Merged yjs update
 * @returns {Promise<boolean>}
 */
export async function setYDocState(storageScope, id, state) {
  const ctx = toStorageContext(storageScope, 'setYDocState');
  const db = getDb();
  const orgId = getOrgId(ctx);
  const buf = Buffer.from(state);
  const timestamp = nowIso();

  await db
    .insertInto('presentation_ydocs')
    .values({
      presentation_id: id,
      organization_id: orgId,
      state: buf,
      updated_at: timestamp,
    })
    .onConflict((oc) =>
      oc.column('presentation_id').doUpdateSet({
        state: buf,
        updated_at: timestamp,
      }),
    )
    .execute();
  return true;
}

/**
 * Delete the stored Y.Doc state for a presentation.
 * @param {import('../scope.js').StorageScope} storageScope
 * @param {string} id - Presentation ID
 * @returns {Promise<boolean>}
 */
export async function deleteYDocState(storageScope, id) {
  const ctx = toStorageContext(storageScope, 'deleteYDocState');
  const db = getDb();
  const orgId = getOrgId(ctx);

  const result = await db
    .deleteFrom('presentation_ydocs')
    .where('presentation_id', '=', id)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  return Number(result?.numDeletedRows || 0) > 0;
}
