/**
 * Publish a presentation — the one flow behind both the internal
 * `POST /api/presentations/:id/publish` (`server/routes/api/publish.js`) and the
 * public `POST /api/v1/presentations/:id/publish`
 * (`server/routes/public-api/v1/publishing.js`).
 *
 * The two surfaces authenticate and load `pres` differently (session cookie vs
 * API key) and answer in different envelopes, so each keeps that half. Once a
 * deck is cleared to publish, everything that must be identical lives here:
 *
 *   - the **sandbox refusal** — a guest could otherwise mint an API key and
 *     publish through v1, so the internal route's 403 has to hold on every
 *     surface, not just the one that happened to spell it out;
 *   - the **alt-text refusal** — a meaningful picture without a name
 *     (`publish-alt-check.js`, D137);
 *   - the **OG preview image** (author overlay + the fallback ladder);
 *   - the **published-entry upsert** and its write-back onto the deck document;
 *   - the **deck-grid thumbnail warm**; and
 *   - the **`presentation.published` webhook**.
 *
 * Before this converged, the v1 route reimplemented a subset and had silently
 * dropped the sandbox guard and the webhook — one concept, two behaviours
 * decided by which client asked (reference-doc-gaps.md § Vondsten, vondst 8).
 * A single core is the beta-stance fix: no second publish path that "also works".
 */

import {
  newPublishId,
  removePublishedEntry,
  upsertPublishedEntry,
} from '../storage/published.js';
import { updatePresentation } from '../storage/presentations/index.js';
import { getUserSettings } from '../storage/settings.js';
import { pickOgImageUrlFromPresentation } from '../render/og-image.js';
import { firstPublicSlide } from '../utils/public-output.js';
import { loadThemeAssets } from '../utils/themes.js';
import { generateAndSaveOgPreview } from '../render/preview-image.js';
import { isMediaProviderInitialized } from '../media/index.js';
import { sandboxEnabled } from '../config/sandbox.js';
import { maybeFireWebhook } from '../utils/webhooks.js';
import { getRequestOrigin } from '../utils/request-url.js';
import { warmDeckThumbnail } from '../render/deck-thumbnail-warm.js';
import {
  ForbiddenError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import { loadPresentationForActor } from './presentations.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { assertImagesNamed } from './publish-alt-check.js';
import { createLogger } from '../utils/logger.js';
import { getOgImageUrl } from '../config/branding.js';

const log = createLogger('publish');

/**
 * The publishing policy gate, shared by every publish entry point: no public
 * published URLs in sandbox mode. A guest owns their own private deck and could
 * otherwise publish arbitrary content onto the public domain — including by
 * minting an API key and calling the v1 route. Mirrors
 * assertSharingEnabled() refusing to open a deck to the organization in sandbox.
 *
 * Called at the top of each route (before the deck is even loaded) and again as
 * a backstop inside {@link publishPresentation}, so no publish path — present or
 * future — can skip it. Throwing lets each surface render the 403 in its own
 * envelope (`withErrorHandler` internally, `withV1ErrorHandler` on v1).
 *
 * @throws {ForbiddenError} When publishing is disabled (sandbox mode).
 */
export function assertPublishingEnabled() {
  if (sandboxEnabled()) {
    throw new ForbiddenError('Publishing is disabled in sandbox mode');
  }
}

/**
 * The author overlay for the OG card: the owner's profile name and picture,
 * or nothing. The card is public, so no name is derived from the email
 * address (B462); without a profile name there is no author block. The
 * creator is a display pair (D22) and carries no address, so callers pass the
 * acting user's email when the deck has no owner email.
 *
 * @param {object} storageScope
 * @param {string|null|undefined} email - whose profile to read
 * @returns {Promise<{ name: string, imageUrl: string } | null>}
 */
export async function resolveOgAuthor(storageScope, email) {
  if (!email) return null;
  let profile;
  try {
    profile = (await getUserSettings(storageScope, email))?.profile;
  } catch {
    return null;
  }
  const name = typeof profile?.name === 'string' ? profile.name.trim() : '';
  if (!name) return null;
  return { name, imageUrl: profile?.imageUrl || '' };
}

/**
 * Build the OG preview image for a publish. Renders a fresh preview from the
 * first meaningful slide when a media provider is configured, and otherwise
 * (and on any render failure) falls back down the ladder to a picked content
 * image, then the bundled default. Never throws — a preview is best-effort.
 *
 * Exported because the internal preview-regenerate route
 * (`server/routes/api/publish.js`) renders the same image and must share this
 * one renderer, author overlay and fallback ladder rather than keep its own copy
 * (B73). That route keeps its own guards and its own entry write — it reuses the
 * image build, not the whole {@link publishPresentation} flow.
 *
 * @param {object} params
 * @param {string} params.repoRoot
 * @param {object} params.storageScope
 * @param {object} params.pres - The presentation being published.
 * @param {string|null} params.actorEmail - Acting user's email, for the author overlay fallback.
 * @param {string} params.publishId - The publish id (names the rendered file).
 * @returns {Promise<string>} The OG image URL.
 */
export async function buildPublishOgImage({
  repoRoot,
  storageScope,
  pres,
  actorEmail,
  publishId,
}) {
  let ogImageUrl = getOgImageUrl();
  try {
    // The first slide that outlives the session: a live-only slide (the
    // follow-along invite) has nothing to show a preview of.
    const firstSlide = firstPublicSlide(pres);

    if (firstSlide && isMediaProviderInitialized()) {
      const theme = await loadThemeAssets(repoRoot, pres.theme, storageScope);

      const showAuthor = pres?.settings?.ogPreview?.showAuthor === true;
      const authorInfo = showAuthor
        ? await resolveOgAuthor(storageScope, pres?.ownerEmail || actorEmail)
        : null;

      ogImageUrl = await generateAndSaveOgPreview(
        repoRoot,
        firstSlide,
        theme,
        `og-${publishId}`,
        { showAuthor, authorInfo },
      );
    } else {
      // No media provider: pick an image out of the deck content.
      ogImageUrl = pickOgImageUrlFromPresentation(pres) || ogImageUrl;
    }
  } catch (err) {
    log.warn('[publish] Preview generation failed:', err?.message || err);
    ogImageUrl = pickOgImageUrlFromPresentation(pres) || ogImageUrl;
  }
  return ogImageUrl;
}

/**
 * Publish a presentation and return the public-link descriptor. The caller has
 * already resolved auth and loaded `pres`; this runs the flow both API surfaces
 * must share.
 *
 * @param {object} params
 * @param {string} params.repoRoot - Disk root (uploads/thumbnails/themes).
 * @param {import('../storage/scope.js').StorageScope} params.storageScope - The request's storage scope.
 * @param {import('http').IncomingMessage} params.req - The request (webhook origin).
 * @param {object} params.pres - The loaded presentation to publish (write-authorized upstream).
 * @param {object|null} params.actor - The acting user (`{ email, … }`); its email
 *   is the actor on the write and the webhook.
 * @returns {Promise<{publishId: string, slug: string, path: string, ogImageUrl: string}>}
 * @throws {ForbiddenError} When publishing is disabled (sandbox mode).
 * @throws {import('../utils/errors.js').UnprocessableError} `missing_alt`, when
 *   a picture that is not decorative has no alt text.
 */
export async function publishPresentation({
  repoRoot,
  storageScope,
  req,
  pres,
  actor,
}) {
  // Backstop: the routes gate this early (before loading the deck), but re-check
  // here so no core caller can skip the policy.
  assertPublishingEnabled();

  // Before anything is written: a refused publish leaves no entry, no preview
  // and no webhook behind. The deck's own organisation types are checked by
  // their own declarations.
  assertImagesNamed(
    pres,
    await buildMergedSlideTypes({ organizationId: pres?.organizationId }),
  );

  const actorEmail = actor?.email || null;

  const publishId =
    typeof pres?.published?.id === 'string' && pres.published.id
      ? pres.published.id
      : newPublishId();

  const ogImageUrl = await buildPublishOgImage({
    repoRoot,
    storageScope,
    pres,
    actorEmail,
    publishId,
  });

  const entry = await upsertPublishedEntry(storageScope, {
    publishId,
    presentationId: pres.id,
    title: pres.title,
    ogImageUrl,
  });

  // Persist the publish state back onto the presentation document (handy for
  // exports/UI). Only the publication column moves, as on unpublish: writing
  // the loaded deck back whole would overwrite the active language version
  // with the dominant text and a concurrent slide edit with the load (B620).
  const published = {
    id: entry.publishId,
    slug: entry.slug,
    ogImageUrl: entry.ogImageUrl || '',
    created: entry.created,
    modified: entry.modified,
  };
  const nextPres = { ...pres, published };
  const updated = await updatePresentation(
    storageScope,
    pres.id,
    { published },
    { actorEmail },
  );

  // Warm the deck-grid thumbnail for the post-publish revision so the next list
  // view shows the raster immediately (fire-and-forget, non-blocking).
  warmDeckThumbnail(storageScope, updated || nextPres);

  const path = `/p/${entry.publishId}-${entry.slug}`;

  await maybeFireWebhook(repoRoot, getRequestOrigin(req), {
    event: 'presentation.published',
    pres: nextPres,
    authedUser: actor,
    extra: {
      publishId: entry.publishId,
      slug: entry.slug,
      path,
      ogImageUrl: entry.ogImageUrl || '',
    },
  });

  return {
    publishId: entry.publishId,
    slug: entry.slug,
    path,
    ogImageUrl: entry.ogImageUrl || '',
  };
}

/**
 * Take a deck's public link down, on every contract (B575): the internal
 * `DELETE /api/presentations/:id/publish` and v1's `DELETE …/publish` each
 * carried a copy of these three steps.
 *
 * Whoever may write the deck may unpublish it. The published entry goes, and
 * the deck's `published` column is cleared with an explicit `null`: the
 * storage layer reads an absent key as "leave this column alone", so a write
 * without it would keep the deck published in the database. Only that column
 * is written, so a concurrent edit to the slides is not overwritten. A deck
 * that was not published answers the same: the link is down either way.
 *
 * @param {import('../storage/scope.js').StorageScope} scope - The caller's storage scope.
 * @param {{ actor: import('./actor.js').Actor }} identity - The acting user (D253).
 * @param {string} presentationId
 * @returns {Promise<Object>} The deck as stored after the change.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {ForbiddenError} The actor may not write the deck.
 */
export async function unpublishPresentation(scope, identity, presentationId) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });

  const publishId = String(pres.published?.id || '').trim();
  if (publishId) await removePublishedEntry(scope, publishId);

  const updated = await updatePresentation(
    scope,
    pres.id,
    { published: null },
    { actorEmail: identity.actor?.email || null },
  );
  if (!updated) throw new NotFoundError('Presentation not found');
  if (updated.ok === false) throwStorageFailure(updated);
  return updated;
}
