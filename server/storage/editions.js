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
      if (prior) {
        // The loser's prepared bytes will never commit: drop them now rather
        // than leave them to the staging sweep.
        await getDb()
          .deleteFrom('publication_staging')
          .where('id', '=', stagingId)
          .where('organization_id', '=', orgId)
          .execute();
        return replayOrRefuse(prior, requestHash);
      }
    }
    throw err;
  }
}

/**
 * One edition of a series in the scope's organization, with its frozen
 * bytes. An authoring read; the public read path is {@link getPublicEdition}.
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
 * @typedef {Object} PublicEdition
 * @property {string} id
 * @property {string} publicationId
 * @property {number} version
 * @property {string} rendererHash
 * @property {string} manifestHash
 * @property {string|null} previousManifestHash - The manifest hash of
 *   version - 1 in the same series; null for version 1, and null when that
 *   edition no longer exists (a verifier then reports the link as missing)
 * @property {string} publishedAt - ISO timestamp
 * @property {string|null} revokedAt - ISO timestamp once revoked
 * @property {Buffer} [inputBytes] - Only with `withBytes`, and never for a
 *   revoked edition
 * @property {Buffer} [manifestBytes] - Likewise
 */

/**
 * One edition as the public read path sees it: addressed by its series'
 * public id and its version, in whatever organization it lives (the public id
 * is the authorization, as for `getPublishedById`).
 *
 * It answers only about that edition. There is no "latest" and no fallback to
 * the deck: an unknown `(publicationId, version)` is null, and a revoked one
 * comes back with `revokedAt` and without its bytes, so a caller that forgets
 * to check cannot serve them.
 *
 * @param {import('./scope.js').StorageScope} scope - Normally a
 *   cross-organization scope; an organization scope limits the read to it
 * @param {string} publicationId
 * @param {number} version
 * @param {{withBytes?: boolean}} [options] - Load the input and manifest bytes
 *   (they can be megabytes; a revocation check does not need them)
 * @returns {Promise<PublicEdition|null>}
 */
export async function getPublicEdition(
  scope,
  publicationId,
  version,
  { withBytes = false } = {},
) {
  const ctx = resolveScope(scope, 'getPublicEdition', {
    allowCrossOrganization: true,
  });
  if (!UUID_RE.test(String(publicationId || ''))) return null;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1 || v > 2147483647) return null;

  let query = getDb()
    .selectFrom('publication_editions as e')
    .leftJoin('publication_edition_revocations as r', 'r.edition_id', 'e.id')
    .leftJoin('publication_editions as prev', (join) =>
      join
        .onRef('prev.publication_id', '=', 'e.publication_id')
        .on('prev.version', '=', sql`e.version - 1`),
    )
    .select([
      'e.id',
      'e.publication_id',
      'e.version',
      'e.renderer_hash',
      'e.manifest_hash',
      'e.published_at',
      'r.revoked_at',
      'prev.manifest_hash as previous_manifest_hash',
    ])
    .where('e.publication_id', '=', publicationId)
    .where('e.version', '=', v);
  if (ctx.organizationId) {
    query = query.where('e.organization_id', '=', ctx.organizationId);
  }
  if (withBytes) {
    // Bytes only while the edition is public: a revoked edition's input never
    // leaves the database on the read path.
    query = query.select([
      sql`CASE WHEN r.edition_id IS NULL THEN e.input_bytes END`.as(
        'input_bytes',
      ),
      sql`CASE WHEN r.edition_id IS NULL THEN e.manifest_bytes END`.as(
        'manifest_bytes',
      ),
    ]);
  }
  const row = await query.executeTakeFirst();
  if (!row) return null;

  const edition = {
    id: row.id,
    publicationId: row.publication_id,
    version: Number(row.version),
    rendererHash: row.renderer_hash,
    manifestHash: row.manifest_hash,
    previousManifestHash: row.previous_manifest_hash ?? null,
    publishedAt: new Date(row.published_at).toISOString(),
    revokedAt: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  };
  if (withBytes && !edition.revokedAt) {
    edition.inputBytes = Buffer.from(row.input_bytes);
    edition.manifestBytes = Buffer.from(row.manifest_bytes);
  }
  return edition;
}

/**
 * Internal analytics destination for a served edition. The series owns the
 * optional source reference; neither the frozen input nor the visitor does.
 * No source identity is added to the public document or manifest.
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} publicationId
 * @returns {Promise<{presentationId: string, organizationId: string}|null>}
 */
export async function getEditionAnalyticsSource(scope, publicationId) {
  const ctx = resolveScope(scope, 'getEditionAnalyticsSource', {
    allowCrossOrganization: true,
  });
  let query = getDb()
    .selectFrom('publications')
    .select(['presentation_id', 'organization_id'])
    .where('id', '=', publicationId);
  if (ctx.organizationId) {
    query = query.where('organization_id', '=', ctx.organizationId);
  }
  const row = await query.executeTakeFirst();
  return row?.presentation_id
    ? {
        presentationId: row.presentation_id,
        organizationId: row.organization_id,
      }
    : null;
}

/**
 * Revoke one edition of a series in the scope's organization. From then on
 * every public surface of it answers 410 (`docs/reference/publication-editions.md`
 * § Revocation); other editions of the series are not touched.
 *
 * Revoking twice keeps the first revocation. The authorization check (who may
 * revoke) belongs to the service that calls this; the storage layer only
 * guarantees that organization B cannot revoke an edition of A.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} publicationId
 * @param {number} version
 * @param {{actorUserId?: string|null}} [options]
 * @returns {Promise<{editionId: string, revokedAt: string}>}
 * @throws {NotFoundError} No such edition in the scope's organization.
 */
export async function revokeEdition(
  scope,
  publicationId,
  version,
  { actorUserId = null } = {},
) {
  const orgId = getOrgId(resolveScope(scope, 'revokeEdition'));
  const v = Number(version);
  if (
    !UUID_RE.test(String(publicationId || '')) ||
    !Number.isInteger(v) ||
    v < 1 ||
    v > 2147483647
  ) {
    throw new NotFoundError('Edition not found');
  }
  const { rows } = await sql`
    WITH target AS (
      SELECT id, organization_id FROM publication_editions
      WHERE publication_id = ${publicationId} AND version = ${v}
        AND organization_id = ${orgId}
    ), inserted AS (
      INSERT INTO publication_edition_revocations
        (edition_id, organization_id, actor_user_id)
      SELECT id, organization_id, ${actorUserId} FROM target
      ON CONFLICT (edition_id) DO NOTHING
      RETURNING edition_id, revoked_at
    )
    SELECT t.id AS edition_id,
      COALESCE(i.revoked_at, r.revoked_at) AS revoked_at
    FROM target t
    LEFT JOIN inserted i ON i.edition_id = t.id
    LEFT JOIN publication_edition_revocations r ON r.edition_id = t.id
  `.execute(getDb());
  if (!rows[0]) throw new NotFoundError('Edition not found');
  return {
    editionId: rows[0].edition_id,
    revokedAt: new Date(rows[0].revoked_at).toISOString(),
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

/**
 * @typedef {Object} DeckPublication
 * @property {string} publicationId - The series' public UUID
 * @property {number} version - The newest edition that is not revoked
 * @property {string} path - `/p/{publicationId}/{version}`
 * @property {string} publishedAt - ISO timestamp of that edition
 */

/** The canvas path of an edition; the one spelling every caller links to. */
export function editionPath({ publicationId, version }) {
  return `/p/${publicationId}/${version}`;
}

/**
 * The newest public (not revoked) edition of each deck's series, keyed by
 * deck id. A deck without one is absent from the map: it is not published.
 * A cross-organization scope is allowed: whether a deck is published is
 * public, and a caller that resolved the deck by a public token has no other
 * organization to state.
 *
 * This is the only answer to "is this deck published": the deck row carries no
 * copy of it that could drift (migration 105).
 *
 * @param {import('./scope.js').StorageScope} scope - The decks' organization,
 *   or cross-organization
 * @param {string[]} presentationIds
 * @returns {Promise<Map<string, DeckPublication>>}
 */
export async function latestPublicEditionsForDecks(scope, presentationIds) {
  const ctx = resolveScope(scope, 'latestPublicEditionsForDecks', {
    allowCrossOrganization: true,
  });
  const ids = [...new Set(presentationIds)].filter((id) =>
    UUID_RE.test(String(id || '')),
  );
  const out = new Map();
  if (!ids.length) return out;
  let query = getDb()
    .selectFrom('publications as p')
    .innerJoin('publication_editions as e', 'e.publication_id', 'p.id')
    .leftJoin('publication_edition_revocations as r', 'r.edition_id', 'e.id')
    .select([
      'p.presentation_id',
      'e.publication_id',
      'e.version',
      'e.published_at',
    ])
    .distinctOn('p.presentation_id')
    .where('p.presentation_id', 'in', ids)
    .where('r.edition_id', 'is', null)
    .orderBy('p.presentation_id')
    .orderBy('e.version', 'desc');
  if (ctx.organizationId) {
    query = query.where('p.organization_id', '=', ctx.organizationId);
  }
  for (const row of await query.execute()) {
    const edition = {
      publicationId: row.publication_id,
      version: Number(row.version),
    };
    out.set(row.presentation_id, {
      ...edition,
      path: editionPath(edition),
      publishedAt: new Date(row.published_at).toISOString(),
    });
  }
  return out;
}

/**
 * The SQL condition "this deck has a public edition", for list queries that
 * filter or flag published decks in the database.
 *
 * @param {import('kysely').RawBuilder<unknown>|string} presentationIdRef - A
 *   column reference such as `p.id`
 * @returns {import('kysely').RawBuilder<boolean>}
 */
export function deckHasPublicEditionSql(presentationIdRef) {
  return sql`EXISTS (
    SELECT 1 FROM publications pub_s
    JOIN publication_editions pub_e ON pub_e.publication_id = pub_s.id
    LEFT JOIN publication_edition_revocations pub_r ON pub_r.edition_id = pub_e.id
    WHERE pub_s.presentation_id = ${sql.ref(String(presentationIdRef))}
      AND pub_r.edition_id IS NULL
  )`;
}

/**
 * Take a deck's publication down: revoke every edition of its series that is
 * still public, in the scope's organization. Already revoked editions keep
 * their first revocation. A deck without a series revokes nothing.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {string} presentationId
 * @param {{actorUserId?: string|null}} [options]
 * @returns {Promise<{revoked: Array<{publicationId: string, version: number, editionId: string}>}>}
 */
export async function revokeDeckEditions(
  scope,
  presentationId,
  { actorUserId = null } = {},
) {
  const orgId = getOrgId(resolveScope(scope, 'revokeDeckEditions'));
  if (!UUID_RE.test(String(presentationId || ''))) return { revoked: [] };
  const { rows } = await sql`
    INSERT INTO publication_edition_revocations
      (edition_id, organization_id, actor_user_id)
    SELECT e.id, e.organization_id, ${actorUserId}
    FROM publications p
    JOIN publication_editions e ON e.publication_id = p.id
    WHERE p.presentation_id = ${presentationId} AND p.organization_id = ${orgId}
    ON CONFLICT (edition_id) DO NOTHING
    RETURNING edition_id
  `.execute(getDb());
  if (!rows.length) return { revoked: [] };
  const editions = await getDb()
    .selectFrom('publication_editions')
    .select(['id', 'publication_id', 'version'])
    .where(
      'id',
      'in',
      rows.map((r) => r.edition_id),
    )
    .orderBy('version')
    .execute();
  return {
    revoked: editions.map((e) => ({
      editionId: e.id,
      publicationId: e.publication_id,
      version: Number(e.version),
    })),
  };
}

/** The shape of an old eight-hex publish id (`published_presentations.id`). */
const LEGACY_ID_RE = /^[a-f0-9]{8}$/;

/**
 * The edition an old `/p/{publishId}-{slug}` link stands for (migration 105),
 * in whatever organization it lives: the old id is the authorization, as it
 * was before the conversion. Only the edition's address is returned; whether
 * it is revoked is for the edition route to answer, so a revoked first edition
 * is a tombstone at its own address rather than a 404 here.
 *
 * @param {import('./scope.js').StorageScope} scope - Normally cross-organization
 * @param {string} legacyId
 * @returns {Promise<{publicationId: string, version: number}|null>}
 */
export async function resolveLegacyPublication(scope, legacyId) {
  const ctx = resolveScope(scope, 'resolveLegacyPublication', {
    allowCrossOrganization: true,
  });
  if (!LEGACY_ID_RE.test(String(legacyId || ''))) return null;
  let query = getDb()
    .selectFrom('publication_legacy_links as l')
    .innerJoin('publication_editions as e', 'e.id', 'l.edition_id')
    .select(['e.publication_id', 'e.version'])
    .where('l.legacy_id', '=', legacyId);
  if (ctx.organizationId) {
    query = query.where('l.organization_id', '=', ctx.organizationId);
  }
  const row = await query.executeTakeFirst();
  return row
    ? { publicationId: row.publication_id, version: Number(row.version) }
    : null;
}

/**
 * Point an old publish id at an edition of the scope's organization, once.
 * A second call for the same id keeps the first link and reports it, so the
 * conversion can run again without moving a link that was already set.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {{legacyId: string, editionId: string}} link
 * @returns {Promise<{linked: boolean, editionId: string}>} `linked` is false
 *   when the id already had a link (`editionId` is then that link's edition)
 * @throws {NotFoundError} The edition is not in the scope's organization.
 */
export async function linkLegacyPublication(scope, { legacyId, editionId }) {
  const orgId = getOrgId(resolveScope(scope, 'linkLegacyPublication'));
  if (!LEGACY_ID_RE.test(String(legacyId || ''))) {
    throw new AppError('Not an old publish id', 400, null, 'invalid');
  }
  const { rows } = await sql`
    INSERT INTO publication_legacy_links (legacy_id, organization_id, edition_id)
    SELECT ${legacyId}, organization_id, id FROM publication_editions
    WHERE id = ${editionId} AND organization_id = ${orgId}
    ON CONFLICT (legacy_id) DO NOTHING
    RETURNING edition_id
  `.execute(getDb());
  if (rows[0]) return { linked: true, editionId: rows[0].edition_id };
  const existing = await getDb()
    .selectFrom('publication_legacy_links')
    .select('edition_id')
    .where('legacy_id', '=', legacyId)
    .where('organization_id', '=', orgId)
    .executeTakeFirst();
  if (!existing) throw new NotFoundError('Edition not found');
  return { linked: false, editionId: existing.edition_id };
}

/**
 * The newest public edition of each series in the scope's organization,
 * newest first: what a feed lists. An edition outlives its deck (D361), so a
 * series whose deck is gone is listed as long as it is not revoked; a deck
 * that opts out of the feed (`settings.excludeFromFeed`) keeps its series out.
 *
 * @param {import('./scope.js').StorageScope} scope
 * @param {{limit?: number}} [options]
 * @returns {Promise<Array<{id: string, publicationId: string, version: number, publishedAt: string, presentationId: string|null}>>}
 */
export async function listLatestPublicEditions(scope, { limit = 50 } = {}) {
  const orgId = getOrgId(resolveScope(scope, 'listLatestPublicEditions'));
  const n = Math.max(1, Math.min(100, Number(limit) || 50));
  const { rows } = await sql`
    SELECT * FROM (
      SELECT DISTINCT ON (e.publication_id)
        e.id, e.publication_id, e.version, e.published_at, p.presentation_id
      FROM publication_editions e
      JOIN publications p ON p.id = e.publication_id
      LEFT JOIN presentations d ON d.id = p.presentation_id
      LEFT JOIN publication_edition_revocations r ON r.edition_id = e.id
      WHERE e.organization_id = ${orgId} AND r.edition_id IS NULL
        AND (d.settings->>'excludeFromFeed') IS DISTINCT FROM 'true'
      ORDER BY e.publication_id, e.version DESC
    ) latest
    ORDER BY published_at DESC
    LIMIT ${n}
  `.execute(getDb());
  return rows.map((row) => ({
    id: row.id,
    publicationId: row.publication_id,
    version: Number(row.version),
    publishedAt: new Date(row.published_at).toISOString(),
    presentationId: row.presentation_id ?? null,
  }));
}

/**
 * @typedef {Object} LegacyPublication
 * @property {string} legacyId - The old publish id
 * @property {string|null} indexOrganizationId - The organization the old
 *   index row names
 * @property {string|null} presentationId - The deck, when it still exists
 * @property {string|null} deckOrganizationId - The deck's organization now
 * @property {boolean} trashed - The deck is in the trash
 * @property {{publicationId: string, version: number}|null} linkedEdition -
 *   The edition the old id already points at
 */

/**
 * Every row of the old publication index (`published_presentations`), with
 * its deck's state and the edition it is already linked to: what the one-off
 * conversion works through. Read across organizations, oldest first; the
 * index is closed, so the list only shrinks into links.
 *
 * @param {import('./scope.js').StorageScope} scope - Cross-organization
 * @returns {Promise<LegacyPublication[]>}
 */
export async function listLegacyPublications(scope) {
  resolveScope(scope, 'listLegacyPublications', {
    allowCrossOrganization: true,
  });
  const { rows } = await sql`
    SELECT pp.id AS legacy_id, pp.organization_id AS index_org,
      d.id AS deck_id, d.organization_id AS deck_org, d.trashed_at,
      e.publication_id AS linked_publication, e.version AS linked_version
    FROM published_presentations pp
    LEFT JOIN presentations d ON d.id = pp.presentation_id
    LEFT JOIN publication_legacy_links l ON l.legacy_id = pp.id
    LEFT JOIN publication_editions e ON e.id = l.edition_id
    ORDER BY pp.created_at, pp.id
  `.execute(getDb());
  return rows.map((row) => ({
    legacyId: row.legacy_id,
    indexOrganizationId: row.index_org ?? null,
    presentationId: row.deck_id ?? null,
    deckOrganizationId: row.deck_org ?? null,
    trashed: !!row.trashed_at,
    linkedEdition: row.linked_publication
      ? {
          publicationId: row.linked_publication,
          version: Number(row.linked_version),
        }
      : null,
  }));
}
