/**
 * Publish a deck as an immutable edition: one handling, no half-visible
 * version (T1.3, `docs/plans/briefs/publication-records.md` § 4).
 *
 * The service loads the deck itself, for an actor that may write it, and
 * refuses before it prepares anything when the deck is not at the revision
 * the author saw (`expectedRevision`) or a publish gate says no. It then
 * seals one snapshot (`prepareEditionInput`, T1.2), stages those bytes and
 * commits them as the next edition of the deck's series in one transaction
 * (`server/storage/editions.js`). A retry with the same idempotency key and
 * the same request gets the edition the first attempt made; the same key
 * with a different request is refused.
 *
 * No production caller yet: the publish routes keep their current path until
 * T1.5 converts them, and nothing reads an edition publicly until T1.4.
 */

import {
  canonicalJsonBytes,
  openCurrentRendererBundle,
  sha256Hex,
} from '../render/renderer-bundle/index.js';
import { prepareEditionInput } from '../export/edition-input.js';
import {
  EDITION_DESTINATION_LOCAL,
  commitEdition,
  findEditionByIdempotencyKey,
  idempotencyKeyReused,
  stageEditionInput,
} from '../storage/editions.js';
import { repoRootOf } from '../storage/scope.js';
import { loadThemeAssets } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { AppError, revisionConflict } from '../utils/errors.js';
import { assertPublishingEnabled } from './publish-presentation.js';
import { assertImagesNamed } from './publish-alt-check.js';
import { assertSlidesComplete } from './publish-complete-check.js';
import { loadPresentationForActor } from './presentations.js';

/** Long enough for a UUID or a client's own scheme, short enough to index. */
const MAX_IDEMPOTENCY_KEY = 200;

function invalid(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

/**
 * The hash a retry is compared on: what the caller asked for, not what the
 * preparation produced. Two requests are the same request when they name the
 * same deck, revision and destination.
 *
 * @param {{presentationId: string, expectedRevision: number}} request
 * @returns {string}
 */
export function editionRequestHash({ presentationId, expectedRevision }) {
  return sha256Hex(
    canonicalJsonBytes({
      destination: EDITION_DESTINATION_LOCAL,
      expectedRevision,
      presentationId,
    }),
  );
}

/**
 * Publish `presentationId` as a new edition of its series.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {{ actor: import('./actor.js').Actor }} identity
 * @param {object} request
 * @param {string} request.presentationId
 * @param {number} request.expectedRevision - The revision the author saw
 * @param {string} request.idempotencyKey - One per publish intent; a retry
 *   sends the same one
 * @param {object} [options]
 * @param {string} [options.rendererStore] - Where the installation's render
 *   bundle lives; the image's own store by default
 * @returns {Promise<{replayed: boolean, edition: import('../storage/editions.js').EditionRecord}>}
 * @throws {import('../utils/errors.js').ForbiddenError} Sandbox, or the actor
 *   may not write the deck.
 * @throws {import('../utils/errors.js').NotFoundError} No such deck in scope.
 * @throws {import('../utils/errors.js').ConflictError} `conflict` for a stale
 *   revision; `idempotency_key_reused` for a key that named another request.
 * @throws {import('../utils/errors.js').UnprocessableError} The publish gates
 *   (`incomplete_slides`, `missing_alt`).
 * @throws {import('../render/renderer-bundle/errors.js').RendererBundleError}
 *   No render bundle, or dependencies an edition cannot freeze.
 */
export async function publishEdition(
  scope,
  identity,
  { presentationId, expectedRevision, idempotencyKey },
  { rendererStore } = {},
) {
  assertPublishingEnabled();
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw invalid('expectedRevision', 'expectedRevision must be a revision');
  }
  if (
    typeof idempotencyKey !== 'string' ||
    !idempotencyKey ||
    idempotencyKey.length > MAX_IDEMPOTENCY_KEY
  ) {
    throw invalid(
      'idempotencyKey',
      `idempotencyKey must be 1-${MAX_IDEMPOTENCY_KEY} characters`,
    );
  }

  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const requestHash = editionRequestHash({
    presentationId: pres.id,
    expectedRevision,
  });

  // A retry after success answers with the first edition, even when the
  // deck has moved on since: it asks for what it asked for then.
  const prior = await findEditionByIdempotencyKey(scope, idempotencyKey);
  if (prior) {
    if (prior.requestHash !== requestHash) throw idempotencyKeyReused();
    return { replayed: true, edition: prior.edition };
  }

  if (Number(pres.revision) !== expectedRevision) {
    throw revisionConflict(
      'The deck changed after this publish was prepared',
      pres,
    );
  }

  const slideTypes = await buildMergedSlideTypes(scope);
  assertSlidesComplete(pres, slideTypes);
  assertImagesNamed(pres, slideTypes);

  // Before the expensive part: without a bundle there is nothing to publish
  // with, and an edition never names a renderer it was not checked against.
  const { rendererHash } = await openCurrentRendererBundle(rendererStore);

  const repoRoot = repoRootOf(scope);
  const theme = await loadThemeAssets(repoRoot, pres.theme, scope);
  const { inputBytes, manifestBytes } = await prepareEditionInput(
    repoRoot,
    pres,
    {
      scope,
      theme,
      slideTypes,
      metaDescription:
        typeof pres.description === 'string' ? pres.description.trim() : '',
    },
  );

  const { stagingId } = await stageEditionInput(scope, {
    presentationId: pres.id,
    inputBytes,
    manifestBytes,
  });
  return commitEdition(scope, {
    presentationId: pres.id,
    stagingId,
    sourceRevision: expectedRevision,
    rendererHash,
    idempotencyKey,
    requestHash,
    actorUserId: identity?.actor?.id ?? null,
  });
}
