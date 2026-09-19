import { badRequest, withErrorHandler } from '../../../utils/http.js';
import { dispatchRoutes, requireUuidId } from '../../../utils/router.js';
import { isUuid } from '../../../utils/uuid.js';
import { handlePresentationsList } from './list.js';
import { handlePopularPresentations } from './popular.js';
import { handlePresentationsSearch } from './search.js';
import { handlePresentationsCreate } from './create.js';
import { handlePresentationsImportJson } from './import-json.js';
import { handlePresentationsImportDeck } from './import-deck.js';
import { handlePresentationsImportMarkdown } from './import-markdown.js';
import { handlePresentationVisibility } from './visibility.js';
import {
  handlePresentationItem,
  handlePresentationRevision,
} from './presentation.js';
import { handlePresentationDuplicate } from './duplicate.js';
import { handlePresentationDescriptionGenerate } from './description.js';
import { handlePresentationTranslateFields } from './translate-fields.js';
import { handlePresentationTranslateMissing } from './translate-missing.js';
import { handlePresentationTranslate } from './translate.js';
import {
  handlePresentationVersions,
  handlePresentationVersionItem,
  handlePresentationVersionExport,
  handlePresentationVersionCompareAi,
  handlePresentationSessionEnd,
} from './versions.js';
import { handlePresentationRestoreVersion } from './restore.js';
import {
  handlePresentationsTrashList,
  handlePresentationRestore,
  handlePresentationPermanentDelete,
} from './trash.js';
import {
  handlePresentationCommentsList,
  handlePresentationCommentsCreate,
  handlePresentationCommentGet,
  handlePresentationCommentUpdate,
  handlePresentationCommentDelete,
  handlePresentationCommentResolve,
  handlePresentationCommentReopen,
  handlePresentationCommentDismiss,
  handlePresentationCommentApply,
  handlePresentationCommentsMarkRead,
  handlePresentationCommentCounts,
  handlePresentationCommentEvents,
} from './comments.js';
import { handlePresentationImportSlidesAsImages } from './import-slides-as-images.js';
import { handlePresentationSubscription } from './subscription.js';
import { handlePresentationAnalyze } from './analyze.js';
import { handlePresentationTags } from '../tags.js';
import { handleOwnershipTransfer } from './ownership.js';
import { handleRenderSlide } from './render-slide.js';
import { handlePresentationThumbnail } from './thumbnail.js';
import {
  handleSlideLocksList,
  handleSlideLockStatus,
  handleSlideLockAcquire,
  handleSlideLockRefresh,
  handleSlideLockRelease,
  handleSlideLocksReleaseAll,
} from './slide-locks.js';
import { handleAnalyzeThemeChange, handleChangeTheme } from './change-theme.js';

/**
 * This module is mounted after the auth gate, so every handler here receives an
 * {@link AuthedContext} and the routes are declared in the shared {@link Route}
 * form dispatched by {@link dispatchRoutes}.
 *
 * @typedef {import('../../../utils/context.js').AuthedContext} AuthedContext
 * @typedef {import('../../../utils/router.js').Route} Route
 */

// ── Adapters for the few handlers whose call shape differs from
//    `handler(ctx, ...captureGroups)` ────────────────────────────────────────

/**
 * Bare `/api/presentations/:id` — the one id row that answers `false` instead
 * of 404 for a non-uuid.
 *
 * Its pattern is the same shape as the collection routes of sibling modules
 * (`/api/presentations/shared-with-me` in `collaborators.js`) and of its own
 * method-dispatched neighbours (`/search`, `/trash`, `/popular`, `/import`),
 * which this module is mounted ahead of. A segment that cannot be a uuid is
 * therefore not this route's id but someone else's collection name: fall
 * through and let the chain decide, which ends at the same `not_found` when
 * nobody claims it. The other 42 id rows own their path outright, so they take
 * {@link requireUuidId} and answer 404 here.
 *
 * @param {AuthedContext} ctx
 * @param {string} id
 */
function handlePresentationItemRoute(ctx, id) {
  if (!isUuid(id)) return false;
  return handlePresentationItem(ctx, id);
}

/**
 * Tags handler takes a bespoke context shape (`presentationId`, no `repoRoot`).
 * @param {AuthedContext} ctx
 * @param {string} id
 */
function handlePresentationTagsRoute({ storageScope, req, res, url }, id) {
  return handlePresentationTags({
    storageScope,
    req,
    res,
    url,
    presentationId: id,
  });
}

/**
 * Render-slide is deliberately called without `url` in its context.
 * @param {AuthedContext} ctx
 * @param {string} id
 */
function handleRenderSlideRoute(
  { repoRoot, storageScope, req, res, authedUser },
  id,
) {
  return handleRenderSlide(
    { repoRoot, storageScope, req, res, authedUser },
    id,
  );
}

/**
 * Legacy `/api/presentations/import` placeholder kept for early "bad import"
 * debugging — points callers at the real endpoint.
 * @param {AuthedContext} ctx
 */
function handleLegacyImportBadRequest({ res }) {
  return badRequest(res, 'Use /api/presentations/import/json');
}

/**
 * Declarative route table for `/api/presentations/*`.
 *
 * IMPORTANT — this is a first-match dispatcher. The order below is significant
 * and mirrors the original `if`-chain exactly: specific paths (`/search`,
 * `/popular`, `/trash`, `/import/*`, the `/versions/…`,
 * `/slides/…/lock`, and `/comments/…` sub-routes) MUST stay ahead of the
 * generic `/api/presentations/:id`. Do not alphabetize or regroup.
 *
 * Paths that carry a `method` behave like the original nested method branches:
 * a request whose method doesn't match falls through to the next route rather
 * than being rejected here.
 *
 * @type {Route[]}
 */
const ROUTES = [
  {
    method: 'GET',
    pattern: '/api/presentations',
    handler: handlePresentationsList,
  },

  // Search endpoint (before :id routes to avoid conflicts)
  {
    method: 'GET',
    pattern: '/api/presentations/search',
    handler: handlePresentationsSearch,
  },

  // Popular presentations endpoint (before :id routes to avoid conflicts)
  {
    method: 'GET',
    pattern: '/api/presentations/popular',
    handler: handlePopularPresentations,
  },

  // Trash routes (before :id routes to avoid conflicts)
  {
    pattern: '/api/presentations/trash',
    handler: handlePresentationsTrashList,
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/restore$/,
    handler: requireUuidId(handlePresentationRestore),
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/permanent$/,
    handler: requireUuidId(handlePresentationPermanentDelete),
  },

  // Translate a set of arbitrary fields (key -> string). Used for slide-level preview/apply in editor.
  {
    pattern: /^\/api\/presentations\/([^/]+)\/translate\/fields$/,
    handler: requireUuidId(handlePresentationTranslateFields),
    ai: true,
  },
  // Translate only missing (empty) fields into the other language (safe for manual edits).
  {
    pattern: /^\/api\/presentations\/([^/]+)\/translate\/missing$/,
    handler: requireUuidId(handlePresentationTranslateMissing),
    ai: true,
  },
  // Translate a presentation into the other supported language and store as an i18n version.
  {
    pattern: /^\/api\/presentations\/([^/]+)\/translate$/,
    handler: requireUuidId(handlePresentationTranslate),
    ai: true,
  },

  {
    pattern: /^\/api\/presentations\/([^/]+)\/description\/generate$/,
    handler: requireUuidId(handlePresentationDescriptionGenerate),
    ai: true,
  },

  {
    method: 'POST',
    pattern: '/api/presentations',
    handler: handlePresentationsCreate,
  },

  // Import (portable JSON deck format)
  {
    method: 'POST',
    pattern: '/api/presentations/import/json',
    handler: handlePresentationsImportJson,
  },
  // Import (self-contained .deck bundle — re-hydrates embedded assets)
  {
    method: 'POST',
    pattern: '/api/presentations/import/deck',
    handler: handlePresentationsImportDeck,
  },
  // Import (markdown deck format — deterministic, no AI)
  {
    method: 'POST',
    pattern: '/api/presentations/import/markdown',
    handler: handlePresentationsImportMarkdown,
  },

  {
    pattern: /^\/api\/presentations\/([^/]+)\/visibility$/,
    handler: requireUuidId(handlePresentationVisibility),
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/duplicate$/,
    handler: requireUuidId(handlePresentationDuplicate),
  },

  // Lightweight revision probe (staleness check for waking editor tabs)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/revision$/,
    handler: requireUuidId(handlePresentationRevision),
  },

  {
    pattern: /^\/api\/presentations\/([^/]+)$/,
    handler: handlePresentationItemRoute,
  },

  // Version history (snapshots)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions$/,
    handler: requireUuidId(handlePresentationVersions),
  },
  // Session-end snapshot (called when editing session ends)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/session-end$/,
    handler: requireUuidId(handlePresentationSessionEnd),
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/restore$/,
    handler: requireUuidId(handlePresentationRestoreVersion),
  },
  // Version export as JSON
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/export\/json$/,
    handler: requireUuidId(handlePresentationVersionExport),
  },
  // AI-powered version comparison
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/compare-ai$/,
    handler: requireUuidId(handlePresentationVersionCompareAi),
    ai: true,
  },
  // Single version retrieval (for preview/comparison)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)$/,
    handler: requireUuidId(handlePresentationVersionItem),
  },

  // ============================================================
  // SLIDE-LEVEL LOCKS (concurrent editing)
  // ============================================================

  // List all slide locks for a presentation
  {
    pattern: /^\/api\/presentations\/([^/]+)\/slide-locks$/,
    handler: requireUuidId(handleSlideLocksList),
  },
  // Release all slide locks for current user
  {
    pattern: /^\/api\/presentations\/([^/]+)\/slide-locks\/release-all$/,
    handler: requireUuidId(handleSlideLocksReleaseAll),
  },
  // Refresh a specific slide lock
  {
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock\/refresh$/,
    handler: requireUuidId(handleSlideLockRefresh),
  },
  // Acquire, release, or read a specific slide lock (method-dispatched)
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/,
    handler: requireUuidId(handleSlideLockStatus),
  },
  {
    method: 'POST',
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/,
    handler: requireUuidId(handleSlideLockAcquire),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/,
    handler: requireUuidId(handleSlideLockRelease),
  },

  // ============================================================
  // IMPORT SLIDES AS IMAGES (PDF → image-slide)
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/import-slides-as-images$/,
    handler: requireUuidId(handlePresentationImportSlidesAsImages),
  },

  // ============================================================
  // AI ANALYSIS
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/analyze$/,
    handler: requireUuidId(handlePresentationAnalyze),
    ai: true,
  },

  // ============================================================
  // THEME CHANGE
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/analyze-theme-change$/,
    handler: requireUuidId(handleAnalyzeThemeChange),
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/change-theme$/,
    handler: requireUuidId(handleChangeTheme),
  },

  // ============================================================
  // TAGS
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/tags$/,
    handler: requireUuidId(handlePresentationTagsRoute),
  },

  // ============================================================
  // OWNERSHIP TRANSFER
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/transfer-ownership$/,
    handler: requireUuidId(handleOwnershipTransfer),
  },

  // ============================================================
  // RENDER SLIDE (server-side rendering for custom slide types)
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/render-slide$/,
    handler: requireUuidId(handleRenderSlideRoute),
  },

  // ============================================================
  // DECK OVERVIEW THUMBNAIL (server-rasterized PNG→WebP of slide 1)
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/thumbnail$/,
    handler: requireUuidId(handlePresentationThumbnail),
  },

  // ============================================================
  // COMMENTS
  // ============================================================

  // Comment counts per slide (before more specific routes)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/counts$/,
    handler: requireUuidId(handlePresentationCommentCounts),
  },
  // Per-deck notification subscription (personal, GET current / PUT set)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/subscription$/,
    handler: requireUuidId(handlePresentationSubscription),
  },
  // Mark comment threads as read for the current user (batch)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/mark-read$/,
    handler: requireUuidId(handlePresentationCommentsMarkRead),
  },
  // SSE endpoint for real-time comment updates
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/events$/,
    handler: requireUuidId(handlePresentationCommentEvents),
  },
  // Resolve comment
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/resolve$/,
    handler: requireUuidId(handlePresentationCommentResolve),
  },
  // Reopen comment
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/reopen$/,
    handler: requireUuidId(handlePresentationCommentReopen),
  },
  // Dismiss AI suggestion
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/dismiss$/,
    handler: requireUuidId(handlePresentationCommentDismiss),
  },
  // Apply AI suggestion (create proposed slide)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/apply$/,
    handler: requireUuidId(handlePresentationCommentApply),
  },
  // Single comment operations (GET/PUT/DELETE, method-dispatched)
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/,
    handler: requireUuidId(handlePresentationCommentGet),
  },
  {
    method: 'PUT',
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/,
    handler: requireUuidId(handlePresentationCommentUpdate),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/,
    handler: requireUuidId(handlePresentationCommentDelete),
  },
  // List/Create comments (method-dispatched)
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/comments$/,
    handler: requireUuidId(handlePresentationCommentsList),
  },
  {
    method: 'POST',
    pattern: /^\/api\/presentations\/([^/]+)\/comments$/,
    handler: requireUuidId(handlePresentationCommentsCreate),
  },

  // This module purposely does NOT handle export/publish routes.
  // Those live in `export.js` and `publish.js`.

  // Note: keep a tiny placeholder route for early "bad import" debugging.
  {
    method: 'POST',
    pattern: '/api/presentations/import',
    handler: handleLegacyImportBadRequest,
  },
];

/**
 * Dispatch a `/api/presentations/*` request through the first matching route.
 *
 * Return contract is unchanged from the original hand-written `if`-chain:
 * returns the matched handler's result (truthy = handled), or `false` when no
 * route matches (letting the caller fall through).
 *
 * @param {AuthedContext} ctx
 * @returns {Promise<unknown>|unknown}
 */
export const handlePresentations = withErrorHandler('presentations', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
