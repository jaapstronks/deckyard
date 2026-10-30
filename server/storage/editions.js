/**
 * Publication editions storage: series, immutable editions, local deliveries
 * and the staging they are committed from (T1.3).
 *
 * The write is two steps on purpose. {@link stageEditionInput} stores the
 * prepared bytes (`server/export/edition-input.js`) in a private staging row;
 * that may take a while and holds no lock. {@link commitEdition} then makes
 * the edition in one transaction: series row, idempotency check, version
 * number, edition, asset references, audit row and local delivery, with the
 * staging row removed. Either all of it is visible or none of it, and the
 * bytes move inside the database (`INSERT … SELECT`), so the series lock is
 * held only as long as that copy.
 *
 * Every function takes a storage scope. The series is always found from a deck
 * *in the scope's organization*, so a caller in organization B cannot append
 * to a series of A: there is no write addressed by publication id at all.
 *
 * Schema and invariants: `server/db/migrations/103_publication_editions.js`
 * and `docs/reference/publication-editions.md`.
 */

import { sql } from 'kysely';

import { getDb } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { AppError, NotFoundError } from '../utils/errors.js';
import {
  sha256Hex,
  verifyEditionInput,
} from '../render/renderer-bundle/index.js';
import { resolveScope } from './scope.js';

/** The only destination there is until a second one is built (T12). */
export const EDITION_DESTINATION_LOCAL = 'local';

/**
 * How long prepared bytes may wait for their commit before the retention
 * sweep counts them as abandoned. A publish commits within seconds of staging;
 * a day leaves a wide margin for a slow commit and costs only disk.
 */
export const EDITION_STAGING_TTL_MS = 24 * 60 * 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The constraint a second use of one idempotency key runs into. */
const IDEMPOTENCY_CONSTRAINT =
  'publication_editions_organization_id_idempotency_key_key';

/**
 * @typedef {Object} EditionRecord
 * @property {string} id
 * @property {string} publicationId - The series' public UUID
 * @property {number} version
 * @property {number} sourceRevision - The deck revision the input was sealed from
 * @property {string} rendererHash
 * @property {string} manifestHash - sha256 hex of the manifest bytes
 * @property {string} publishedAt - ISO timestamp
 * @property {{destination: string, status: string, receipt: object|null}|null} delivery
 */

function mapEdition(row, delivery = null) {
  return {
    id: row.id,
    publicationId: row.publication_id,
    version: Number(row.version),
    sourceRevision: Number(row.source_revision),
    rendererHash: row.renderer_hash,
    manifestHash: row.manifest_hash,
    publishedAt: new Date(row.published_at).toISOString(),
    delivery: delivery
      ? {
          destination: delivery.destination,
          status: delivery.status,
          receipt: delivery.receipt ?? null,
        }
      : null,
  };
}

const SUMMARY_COLUMNS = [
  'publication_editions.id',
  'publication_editions.publication_id',
  'publication_editions.version',
  'publication_editions.source_revision',
  'publication_editions.renderer_hash',
  'publication_editions.manifest_hash',
  'publication_editions.published_at',
  'publication_editions.request_hash',
];

/** One edition by its organization's idempotency key, with its local delivery. */
async function editionByKey(executor, orgId, idempotencyKey) {
  const row = await executor
    .selectFrom('publication_editions')
    .leftJoin('publication_deliveries', (join) =>
      join
        .onRef(
          'publication_deliveries.edition_id',
          '=',
          'publication_editions.id',
        )
        .on(
          'publication_deliveries.destination',
          '=',
          EDITION_DESTINATION_LOCAL,
        ),
    )
    .select([
      ...SUMMARY_COLUMNS,
      'publication_deliveries.destination',
      'publication_deliveries.status',
      'publication_deliveries.receipt',
    ])
    .where('publication_editions.organization_id', '=', orgId)
    .where('publication_editions.idempotency_key', '=', idempotencyKey)
    .executeTakeFirst();
  if (!row) return null;
  return {
    requestHash: row.request_hash,
    edition: mapEdition(row, row.destination ? row : null),
  };
}

/**
 * The refusal for an idempotency key that already named a different request.
 * @returns {AppError}
 */
export function idempotencyKeyReused() {
  return new AppError(
    'This idempotency key was already used for a different publish request',
    409,
    null,
    'idempotency_key_reused',
  );
}

/**
 * The answer for a key that is already taken: the same request gets its
 * edition back, any other request a refusal.
 */
function replayOrRefuse(prior, requestHash) {
  if (prior.requestHash !== requestHash) throw idempotencyKeyReused();
  return { replayed: true, edition: prior.edition };
}

/**
 * Store prepared edition bytes in a private staging row of the scope's
 * organization, for {@link commitEdition}.
 *
 * The bytes are verified against their manifest first
 * (`verifyEditionInput`), so nothing that fails the offline check can become
 * an edition. Staging is never served and never counted as published; a row
 * nobody commits is removed by {@link deleteAbandonedEditionStaging}.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {{presentationId: string, inputBytes: Buffer, manifestBytes: Buffer}} data
 * @returns {Promise<{stagingId: string}>}
 * @throws {NotFoundError} The deck is not in the scope's organization.
 * @throws {AppError} `edition_input_invalid` when the bytes do not verify.
 */
export async function stageEditionInput(
  scope,
  { presentationId, inputBytes, manifestBytes },
) {
  const orgId = getOrgId(resolveScope(scope, 'stageEditionInput'));
  const check = verifyEditionInput({ manifestBytes, inputBytes });
  if (!check.ok) {
    throw new AppError(
      `The prepared edition does not verify: ${check.problems
        .map((p) => p.code)
        .join(', ')}`,
      422,
      null,
      'edition_input_invalid',
    );
  }
  if (!UUID_RE.test(String(presentationId || ''))) {
    throw new NotFoundError('Presentation not found');
  }

  const { rows } = await sql`
    INSERT INTO publication_staging
      (organization_id, presentation_id, input_bytes, manifest_bytes)
    SELECT organization_id, id, ${inputBytes}, ${manifestBytes}
    FROM presentations
    WHERE id = ${presentationId} AND organization_id = ${orgId}
    RETURNING id
  `.execute(getDb());
  if (!rows[0]) throw new NotFoundError('Presentation not found');
  return { stagingId: rows[0].id };
}

/**
 * The edition an idempotency key already produced in the scope's
 * organization, or null. Lets a retry answer without preparing again;
 * {@link commitEdition} asks again under the series lock, which is the check
 * that counts.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} idempotencyKey
 * @returns {Promise<{requestHash: string, edition: EditionRecord}|null>}
 */
export async function findEditionByIdempotencyKey(scope, idempotencyKey) {
  const orgId = getOrgId(resolveScope(scope, 'findEditionByIdempotencyKey'));
  return editionByKey(getDb(), orgId, String(idempotencyKey));
}

/**
 * Commit a staged input as the next edition of the deck's series, in one
 * transaction.
 *
 * 1. The deck's series in the scope's organization is created on first
 *    publish and then row-locked: concurrent publishes of one deck queue here.
 * 2. Under that lock the idempotency key is looked up again. The same request
 *    gets its existing edition back (`replayed: true`) and its staging row is
 *    dropped; a different request under the same key is refused.
 * 3. The version is the series counter plus one; the edition copies the staged
 *    bytes, its asset references come from the manifest, the audit row names
 *    the actor and the local delivery is recorded as delivered. The staging
 *    row goes in the same transaction.
 *
 * A failure anywhere rolls all of it back: no edition, no number used, the
 * staging row kept for a retry or the sweep.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {object} data
 * @param {string} data.presentationId
 * @param {string} data.stagingId - From {@link stageEditionInput}
 * @param {number} data.sourceRevision
 * @param {string} data.rendererHash
 * @param {string} data.idempotencyKey
 * @param {string} data.requestHash
 * @param {string|null} [data.actorUserId]
 * @returns {Promise<{replayed: boolean, edition: EditionRecord}>}
 * @throws {NotFoundError} The deck is not in the scope's organization.
 * @throws {AppError} `idempotency_key_reused` (409); `edition_staging_missing`
 *   (409) when the staging row is gone (swept, or committed by a racing call).
 */
export async function commitEdition(
  scope,
  {
    presentationId,
    stagingId,
    sourceRevision,
    rendererHash,
    idempotencyKey,
    requestHash,
    actorUserId = null,
  },
) {
  const orgId = getOrgId(resolveScope(scope, 'commitEdition'));
  if (!UUID_RE.test(String(presentationId || ''))) {
    throw new NotFoundError('Presentation not found');
  }
  const key = String(idempotencyKey);

  try {
    return await getDb()
      .transaction()
      .execute(async (trx) => {
        // 1. The series, from a deck of this organization only.
        await sql`
          INSERT INTO publications (organization_id, presentation_id)
          SELECT organization_id, id FROM presentations
          WHERE id = ${presentationId} AND organization_id = ${orgId}
          ON CONFLICT (organization_id, presentation_id) DO NOTHING
        `.execute(trx);
        const series = await trx
          .selectFrom('publications')
          .select(['id', 'last_version'])
          .where('organization_id', '=', orgId)
          .where('presentation_id', '=', presentationId)
          .forUpdate()
          .executeTakeFirst();
        if (!series) throw new NotFoundError('Presentation not found');

        // 2. The key, now that no other publish of this deck can commit.
        const prior = await editionByKey(trx, orgId, key);
        if (prior) {
          const answer = replayOrRefuse(prior, requestHash);
          await trx
            .deleteFrom('publication_staging')
            .where('id', '=', stagingId)
            .where('organization_id', '=', orgId)
            .execute();
          return answer;
        }

        // 3. The edition, from the staged bytes.
        const staged = await trx
          .selectFrom('publication_staging')
          .select('manifest_bytes')
          .where('id', '=', stagingId)
          .where('organization_id', '=', orgId)
          .where('presentation_id', '=', presentationId)
          .forUpdate()
          .executeTakeFirst();
        if (!staged) {
          throw new AppError(
            'The prepared edition is no longer staged; prepare it again',
            409,
            null,
            'edition_staging_missing',
          );
        }
        const manifestBytes = Buffer.from(staged.manifest_bytes);
        const manifest = JSON.parse(manifestBytes.toString('utf8'));
        const version = Number(series.last_version) + 1;

        await trx
          .updateTable('publications')
          .set({ last_version: version })
          .where('id', '=', series.id)
          .execute();

        const { rows } = await sql`
          INSERT INTO publication_editions (
            publication_id, organization_id, version, source_revision,
            renderer_hash, manifest_hash, manifest_bytes, input_bytes,
            idempotency_key, request_hash
          )
          SELECT ${series.id}, ${orgId}, ${version}, ${sourceRevision},
            ${rendererHash}, ${sha256Hex(manifestBytes)}, manifest_bytes,
            input_bytes, ${key}, ${requestHash}
          FROM publication_staging WHERE id = ${stagingId}
          RETURNING id, publication_id, version, source_revision,
            renderer_hash, manifest_hash, published_at
        `.execute(trx);
        const edition = rows[0];

        const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
        if (assets.length) {
          await trx
            .insertInto('publication_edition_assets')
            .values(
              assets.map((a) => ({
                edition_id: edition.id,
                sha256: a.sha256,
                media_type: a.mediaType,
                bytes: a.bytes,
              })),
            )
            .execute();
        }
        await trx
          .insertInto('publication_edition_audit')
          .values({ edition_id: edition.id, actor_user_id: actorUserId })
          .execute();
        const delivery = await trx
          .insertInto('publication_deliveries')
          .values({
            edition_id: edition.id,
            destination: EDITION_DESTINATION_LOCAL,
            status: 'delivered',
            receipt: JSON.stringify({
              editionId: edition.id,
              manifestHash: edition.manifest_hash,
            }),
          })
          .returning(['destination', 'status', 'receipt'])
          .executeTakeFirstOrThrow();
        await trx
          .deleteFrom('publication_staging')
          .where('id', '=', stagingId)
          .execute();

        return { replayed: false, edition: mapEdition(edition, delivery) };
      });
  } catch (err) {
    // The same key on another deck commits under another series lock; the
    // unique index is what orders those two, and the loser is answered here.
    if (err?.code === '23505' && err?.constraint === IDEMPOTENCY_CONSTRAINT) {
      const prior = await editionByKey(getDb(), orgId, key);
      if (prior) return replayOrRefuse(prior, requestHash);
    }
    throw err;
  }
}

/**
 * One edition of a series in the scope's organization, with its frozen
 * bytes. An authoring read: the public read path is T1.4's.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} publicationId
 * @param {number} version
 * @returns {Promise<(EditionRecord & {inputBytes: Buffer, manifestBytes: Buffer, assets: Array<{sha256: string, mediaType: string, bytes: number}>})|null>}
 */
export async function getEdition(scope, publicationId, version) {
  const orgId = getOrgId(resolveScope(scope, 'getEdition'));
  if (!UUID_RE.test(String(publicationId || ''))) return null;
  const db = getDb();
  const row = await db
    .selectFrom('publication_editions')
    .leftJoin('publication_deliveries', (join) =>
      join
        .onRef(
          'publication_deliveries.edition_id',
          '=',
          'publication_editions.id',
        )
        .on(
          'publication_deliveries.destination',
          '=',
          EDITION_DESTINATION_LOCAL,
        ),
    )
    .select([
      ...SUMMARY_COLUMNS,
      'publication_editions.input_bytes',
      'publication_editions.manifest_bytes',
      'publication_deliveries.destination',
      'publication_deliveries.status',
      'publication_deliveries.receipt',
    ])
    .where('publication_editions.organization_id', '=', orgId)
    .where('publication_editions.publication_id', '=', publicationId)
    .where('publication_editions.version', '=', Number(version))
    .executeTakeFirst();
  if (!row) return null;
  const assets = await db
    .selectFrom('publication_edition_assets')
    .select(['sha256', 'media_type', 'bytes'])
    .where('edition_id', '=', row.id)
    .orderBy('sha256')
    .orderBy('media_type')
    .execute();
  return {
    ...mapEdition(row, row.destination ? row : null),
    inputBytes: Buffer.from(row.input_bytes),
    manifestBytes: Buffer.from(row.manifest_bytes),
    assets: assets.map((a) => ({
      sha256: a.sha256,
      mediaType: a.media_type,
      bytes: Number(a.bytes),
    })),
  };
}

/**
 * Remove staging rows older than `cutoffIso`: prepared bytes whose commit
 * never came (a crash, a refused commit, a client that went away). Never
 * touches an edition; a committed input has already left staging.
 *
 * @param {import('./scope.js').StorageScope} scope - Cross-organization (the
 *   window is instance configuration), or one organization's rows only
 * @param {string} cutoffIso
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteAbandonedEditionStaging(scope, cutoffIso) {
  const ctx = resolveScope(scope, 'deleteAbandonedEditionStaging', {
    allowCrossOrganization: true,
  });
  let query = getDb()
    .deleteFrom('publication_staging')
    .where('created_at', '<', cutoffIso);
  if (ctx.organizationId) {
    query = query.where('organization_id', '=', ctx.organizationId);
  }
  const result = await query.executeTakeFirst();
  return { deleted: Number(result.numDeletedRows || 0) };
}
