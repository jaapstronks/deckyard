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
  upsertPublishedEntry,
} from '../storage/published/index.js';
import { updatePresentation } from '../storage/presentations/index.js';
import { getUserSettings } from '../storage/settings.js';
import { pickOgImageUrlFromPresentation } from '../render/og-image.js';
import { loadThemeAssets } from '../utils/themes.js';
import { generateAndSaveOgPreview } from '../render/preview-image.js';
import { isMediaProviderInitialized } from '../media/index.js';
import { sandboxEnabled } from '../config/sandbox.js';
import { maybeFireWebhook } from '../utils/webhooks.js';
import { warmDeckThumbnail } from '../routes/api/presentations/thumbnail.js';
import { ForbiddenError } from '../utils/errors.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('publish');

const DEFAULT_OG_IMAGE = '/assets/images/slides-previewimage.png';

/**
 * The publishing policy gate, shared by every publish entry point: no public
 * published URLs in sandbox mode. A guest owns their own private deck and could
 * otherwise publish arbitrary content onto the public domain — including by
 * minting an API key and calling the v1 route. Mirrors
 * canChangePresentationVisibility() returning false in sandbox.
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
  let ogImageUrl = DEFAULT_OG_IMAGE;
  try {
    // First slide that isn't a follow-invite-slide (those are internal).
    const firstSlide = Array.isArray(pres?.slides)
      ? pres.slides.find((s) => s?.type !== 'follow-invite-slide')
      : null;

    if (firstSlide && isMediaProviderInitialized()) {
      const theme = await loadThemeAssets(repoRoot, pres.theme);

      const showAuthor = pres?.settings?.ogPreview?.showAuthor === true;
      let authorInfo = null;
      if (showAuthor) {
        const ownerEmail = pres?.ownerEmail || pres?.createdBy || actorEmail;
        if (ownerEmail) {
          try {
            const userSettings = await getUserSettings(
              storageScope,
              ownerEmail,
            );
            authorInfo = {
              name: userSettings?.profile?.name || ownerEmail.split('@')[0],
              imageUrl: userSettings?.profile?.imageUrl || '',
            };
          } catch {
            // Fall back to an email-derived name.
            authorInfo = { name: ownerEmail.split('@')[0], imageUrl: '' };
          }
        }
      }

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
  // exports/UI).
  const nextPres = {
    ...pres,
    published: {
      id: entry.publishId,
      slug: entry.slug,
      ogImageUrl: entry.ogImageUrl || '',
      created: entry.created,
      modified: entry.modified,
    },
  };
  const updated = await updatePresentation(storageScope, pres.id, nextPres, {
    actorEmail,
  });

  // Warm the deck-grid thumbnail for the post-publish revision so the next list
  // view shows the raster immediately (fire-and-forget, non-blocking).
  warmDeckThumbnail(storageScope, updated || nextPres);

  const path = `/p/${entry.publishId}-${entry.slug}`;

  await maybeFireWebhook(repoRoot, req, {
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
