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
 * It is the only way an edition is made. The internal and v1 publish routes
 * call {@link publishEdition}; the one-off conversion of old publications
 * (`server/services/publication-migration.js`) calls {@link createEdition}, the
 * same steps without an acting user. Taking a publication down revokes its
 * editions ({@link unpublishPresentation}); nothing writes the deck.
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
  editionPath,
  findEditionByIdempotencyKey,
  idempotencyKeyReused,
  latestPublicEditionsForDecks,
  revokeDeckEditions,
  stageEditionInput,
} from '../storage/editions.js';
import { repoRootOf } from '../storage/scope.js';
import { loadThemeAssets } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { AppError, ForbiddenError, revisionConflict } from '../utils/errors.js';
import { sandboxEnabled } from '../config/sandbox.js';
import { getAppBaseUrl } from '../config/utils.js';
import { maybeFireWebhook } from '../utils/webhooks.js';
import { assertImagesNamed } from './publish-alt-check.js';
import { assertSlidesComplete } from './publish-complete-check.js';
import { loadPresentationForActor } from './presentations.js';
import { forgetEdition } from './public-edition.js';

/**
 * The publishing policy gate, shared by every publish entry point: no public
 * editions in sandbox mode. A guest owns their own private deck and could
 * otherwise publish arbitrary content onto the public domain, including by
 * minting an API key and calling the v1 route. Mirrors assertSharingEnabled()
 * refusing to open a deck to the organization in sandbox.
 *
 * Called at the top of each route (before the deck is even loaded) and again
 * inside {@link createEdition}, so no publish path can skip it. Throwing lets
 * each surface render the 403 in its own envelope.
 *
 * @throws {ForbiddenError} When publishing is disabled (sandbox mode).
 */
export function assertPublishingEnabled() {
  if (sandboxEnabled()) {
    throw new ForbiddenError('Publishing is disabled in sandbox mode');
  }
}

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
 * @typedef {import('../storage/editions.js').EditionRecord & {path: string}} PublishedEdition
 */

/** The edition with the canvas path every caller links to. */
function withPath(edition) {
  return { ...edition, path: editionPath(edition) };
}

/**
 * Everything an edition needs before it is stored: the publish gates, the
 * installation's render bundle and one sealed snapshot of the deck. Writes
 * nothing, so the conversion's dry run asks exactly the questions a publish
 * asks.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {object} pres - The stored deck, as loaded in `scope`
 * @param {{rendererStore?: string}} [options]
 * @returns {Promise<{rendererHash: string, inputBytes: Buffer, manifestBytes: Buffer}>}
 * @throws {import('../utils/errors.js').UnprocessableError} The publish gates
 *   (`incomplete_slides`, `missing_alt`).
 * @throws {import('../render/renderer-bundle/errors.js').RendererBundleError}
 *   No render bundle, or dependencies an edition cannot freeze.
 */
export async function prepareEdition(scope, pres, { rendererStore } = {}) {
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
  return { rendererHash, inputBytes, manifestBytes };
}

/**
 * Seal a loaded deck as the next edition of its series. The steps every
 * edition goes through, whoever asks: the sandbox gate, the idempotency key,
 * the revision check, the publish gates, the render bundle, one sealed
 * snapshot and the commit. Who may publish is the caller's question; this
 * function trusts that `pres` was loaded for someone who may.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {object} pres - The stored deck, as loaded in `scope`
 * @param {object} request
 * @param {number} request.expectedRevision - The revision the author saw
 * @param {string} request.idempotencyKey - As stored: already scoped to the
 *   one who asks
 * @param {string|null} [request.actorUserId] - Recorded in the internal audit
 * @param {object} [options]
 * @param {string} [options.rendererStore] - Where the installation's render
 *   bundle lives; the image's own store by default
 * @returns {Promise<{replayed: boolean, edition: PublishedEdition}>}
 * @throws Everything {@link publishEdition} lists, except the authorization.
 */
export async function createEdition(
  scope,
  pres,
  { expectedRevision, idempotencyKey, actorUserId = null },
  { rendererStore } = {},
) {
  assertPublishingEnabled();
  const requestHash = editionRequestHash({
    presentationId: pres.id,
    expectedRevision,
  });

  // A retry after success answers with the first edition, even when the
  // deck has moved on since: it asks for what it asked for then.
  const prior = await findEditionByIdempotencyKey(scope, idempotencyKey);
  if (prior) {
    if (prior.requestHash !== requestHash) throw idempotencyKeyReused();
    return { replayed: true, edition: withPath(prior.edition) };
  }

  if (Number(pres.revision) !== expectedRevision) {
    throw revisionConflict(
      'The deck changed after this publish was prepared',
      pres,
    );
  }

  const { rendererHash, inputBytes, manifestBytes } = await prepareEdition(
    scope,
    pres,
    { rendererStore },
  );

  const { stagingId } = await stageEditionInput(scope, {
    presentationId: pres.id,
    inputBytes,
    manifestBytes,
  });
  const committed = await commitEdition(scope, {
    presentationId: pres.id,
    stagingId,
    sourceRevision: expectedRevision,
    rendererHash,
    idempotencyKey,
    requestHash,
    actorUserId,
  });
  return { replayed: committed.replayed, edition: withPath(committed.edition) };
}

/**
 * Publish `presentationId` as a new edition of its series, for an acting user.
 *
 * The idempotency key is the caller's, scoped to the actor: two users who both
 * send key `1` make two editions, not a conflict. A new edition (not a replay)
 * announces itself once on the `presentation.published` webhook, naming the
 * edition; a retry that replays it sends nothing.
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
 * @param {string|null} [options.origin] - The request's origin, for the
 *   webhook's absolute links when no public URL is configured
 * @returns {Promise<{replayed: boolean, edition: PublishedEdition}>}
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
  { rendererStore, origin = null } = {},
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
  const actor = identity?.actor || null;
  const result = await createEdition(
    scope,
    pres,
    {
      expectedRevision,
      idempotencyKey: `${actorKeyScope(actor)}:${idempotencyKey}`,
      actorUserId: actor?.id ?? null,
    },
    { rendererStore },
  );

  if (!result.replayed) {
    await maybeFireWebhook(repoRootOf(scope), getAppBaseUrl() || origin, {
      event: 'presentation.published',
      pres: {
        ...pres,
        published: {
          publicationId: result.edition.publicationId,
          version: result.edition.version,
          path: result.edition.path,
          publishedAt: result.edition.publishedAt,
        },
      },
      authedUser: actor,
      edition: result.edition,
    });
  }
  return result;
}

/**
 * Who a caller's idempotency key belongs to: the user id, or for an actor
 * without one (a test double) the address. A key of one actor never meets a
 * key of another, nor the conversion's `migration:` keys.
 */
function actorKeyScope(actor) {
  const id = actor?.id || actor?.email;
  if (!id) throw new ForbiddenError('Publishing needs a signed-in user');
  return `actor:${id}`;
}

/**
 * The deck's newest public edition, or null when it has none: the only answer
 * to "is this deck published".
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The scope the
 *   deck was loaded in
 * @param {object} pres - A stored deck
 * @returns {Promise<import('../storage/editions.js').DeckPublication|null>}
 */
export async function getDeckPublication(scope, pres) {
  if (!pres?.id) return null;
  const published = await latestPublicEditionsForDecks(scope, [pres.id]);
  return published.get(pres.id) || null;
}

/**
 * Take a deck's publication down, on every contract: the internal
 * `DELETE /api/presentations/:id/publish` and v1's `DELETE …/publish`.
 *
 * Whoever may write the deck may unpublish it. Every edition of its series
 * that is still public is revoked: canvas, reader, manifest, package and
 * preview of each answer 410 from then on, and the old link that pointed at
 * the first edition with them. The deck itself is not written. A deck that was
 * not published answers the same: the link is down either way.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {{ actor: import('./actor.js').Actor }} identity
 * @param {string} presentationId
 * @returns {Promise<{revoked: Array<{publicationId: string, version: number}>}>}
 * @throws {import('../utils/errors.js').NotFoundError} No deck with this id in
 *   this scope.
 * @throws {ForbiddenError} The actor may not write the deck.
 */
export async function unpublishPresentation(scope, identity, presentationId) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const { revoked } = await revokeDeckEditions(scope, pres.id, {
    actorUserId: identity?.actor?.id ?? null,
  });
  for (const edition of revoked) forgetEdition(edition.editionId);
  return {
    revoked: revoked.map(({ publicationId, version }) => ({
      publicationId,
      version,
    })),
  };
}
