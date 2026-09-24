import { badRequest, withErrorHandler } from '../../../utils/http.js';
import { dispatchRoutes } from '../../../utils/router.js';
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
 * nobody claims it. The other 42 id rows own their path outright, so they
 * declare `captures` and answer 404 here.
 *
 * This is the one row in the table that deliberately carries no `captures`
 * declaration, because the declaration answers 404 and this row must answer
 * `false`. The shape check lives in the handler instead — that difference is
 * the whole point of the row, and `tests/presentations-uuid-gate.test.js`
 * pins both halves.
 *
 * @param {AuthedContext} ctx
 * @param {string} id
 */
function handlePresentationItemRoute(ctx, id) {
  if (!isUuid(id)) return false;
  return handlePresentationItem(ctx, id);
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
 * Every row with capture groups declares `captures` — what each segment holds,
 * in handler order (B222/B360). A `'uuid'` entry is shape-checked by the
 * dispatcher and answers 404 when the segment cannot name a row; a `'text'`
 * entry says out loud that nothing checks it. The one exception is the bare
 * `:id` row, whose whole purpose is to answer `false` instead of 404; see
 * {@link handlePresentationItemRoute}.
 *
 * @type {Route[]}
 */
export const ROUTES = [
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
    captures: ['uuid'],
    handler: handlePresentationRestore,
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/permanent$/,
    captures: ['uuid'],
    handler: handlePresentationPermanentDelete,
  },

  // Translate a set of arbitrary fields (key -> string). Used for slide-level preview/apply in editor.
  {
    pattern: /^\/api\/presentations\/([^/]+)\/translate\/fields$/,
    captures: ['uuid'],
    handler: handlePresentationTranslateFields,
    ai: true,
  },
  // Translate only missing (empty) fields into the other language (safe for manual edits).
  {
    pattern: /^\/api\/presentations\/([^/]+)\/translate\/missing$/,
    captures: ['uuid'],
    handler: handlePresentationTranslateMissing,
    ai: true,
  },
  // Translate a presentation into the other supported language and store as an i18n version.
  {
    pattern: /^\/api\/presentations\/([^/]+)\/translate$/,
    captures: ['uuid'],
    handler: handlePresentationTranslate,
    ai: true,
  },

  {
    pattern: /^\/api\/presentations\/([^/]+)\/description\/generate$/,
    captures: ['uuid'],
    handler: handlePresentationDescriptionGenerate,
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
    captures: ['uuid'],
    handler: handlePresentationVisibility,
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/duplicate$/,
    captures: ['uuid'],
    handler: handlePresentationDuplicate,
  },

  // Lightweight revision probe (staleness check for waking editor tabs)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/revision$/,
    captures: ['uuid'],
    handler: handlePresentationRevision,
  },

  {
    pattern: /^\/api\/presentations\/([^/]+)$/,
    handler: handlePresentationItemRoute,
  },

  // Version history (snapshots)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions$/,
    captures: ['uuid'],
    handler: handlePresentationVersions,
  },
  // Session-end snapshot (called when editing session ends)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/session-end$/,
    captures: ['uuid'],
    handler: handlePresentationSessionEnd,
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/restore$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationRestoreVersion,
  },
  // Version export as JSON
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/export\/json$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationVersionExport,
  },
  // AI-powered version comparison
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/compare-ai$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationVersionCompareAi,
    ai: true,
  },
  // Single version retrieval (for preview/comparison)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationVersionItem,
  },

  // ============================================================
  // SLIDE-LEVEL LOCKS (concurrent editing)
  // ============================================================
  // The slide id captured below is `text`, not `uuid`: slide ids live in the
  // `presentations.slides` JSON and are whatever the author or API client put
  // there (`s1`, `intro`, `cd-dark`). Migration 051 widened every
  // slide-reference column to TEXT for exactly that reason, so a uuid gate
  // here would 404 the normal case.

  // List all slide locks for a presentation
  {
    pattern: /^\/api\/presentations\/([^/]+)\/slide-locks$/,
    captures: ['uuid'],
    handler: handleSlideLocksList,
  },
  // Release all slide locks for current user
  {
    pattern: /^\/api\/presentations\/([^/]+)\/slide-locks\/release-all$/,
    captures: ['uuid'],
    handler: handleSlideLocksReleaseAll,
  },
  // Refresh a specific slide lock
  {
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock\/refresh$/,
    captures: ['uuid', 'text'],
    handler: handleSlideLockRefresh,
  },
  // Acquire, release, or read a specific slide lock (method-dispatched)
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/,
    captures: ['uuid', 'text'],
    handler: handleSlideLockStatus,
  },
  {
    method: 'POST',
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/,
    captures: ['uuid', 'text'],
    handler: handleSlideLockAcquire,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/,
    captures: ['uuid', 'text'],
    handler: handleSlideLockRelease,
  },

  // ============================================================
  // IMPORT SLIDES AS IMAGES (PDF → image-slide)
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/import-slides-as-images$/,
    captures: ['uuid'],
    handler: handlePresentationImportSlidesAsImages,
  },

  // ============================================================
  // AI ANALYSIS
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/analyze$/,
    captures: ['uuid'],
    handler: handlePresentationAnalyze,
    ai: true,
  },

  // ============================================================
  // THEME CHANGE
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/analyze-theme-change$/,
    captures: ['uuid'],
    handler: handleAnalyzeThemeChange,
  },
  {
    pattern: /^\/api\/presentations\/([^/]+)\/change-theme$/,
    captures: ['uuid'],
    handler: handleChangeTheme,
  },

  // ============================================================
  // TAGS
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/tags$/,
    captures: ['uuid'],
    handler: handlePresentationTags,
  },

  // ============================================================
  // OWNERSHIP TRANSFER
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/transfer-ownership$/,
    captures: ['uuid'],
    handler: handleOwnershipTransfer,
  },

  // ============================================================
  // RENDER SLIDE (server-side rendering for custom slide types)
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/render-slide$/,
    captures: ['uuid'],
    handler: handleRenderSlideRoute,
  },

  // ============================================================
  // DECK OVERVIEW THUMBNAIL (server-rasterized PNG→WebP of slide 1)
  // ============================================================
  {
    pattern: /^\/api\/presentations\/([^/]+)\/thumbnail$/,
    captures: ['uuid'],
    handler: handlePresentationThumbnail,
  },

  // ============================================================
  // COMMENTS
  // ============================================================

  // Comment counts per slide (before more specific routes)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/counts$/,
    captures: ['uuid'],
    handler: handlePresentationCommentCounts,
  },
  // Per-deck notification subscription (personal, GET current / PUT set)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/subscription$/,
    captures: ['uuid'],
    handler: handlePresentationSubscription,
  },
  // Mark comment threads as read for the current user (batch)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/mark-read$/,
    captures: ['uuid'],
    handler: handlePresentationCommentsMarkRead,
  },
  // SSE endpoint for real-time comment updates
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/events$/,
    captures: ['uuid'],
    handler: handlePresentationCommentEvents,
  },
  // Resolve comment
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/resolve$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentResolve,
  },
  // Reopen comment
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/reopen$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentReopen,
  },
  // Dismiss AI suggestion
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/dismiss$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentDismiss,
  },
  // Apply AI suggestion (create proposed slide)
  {
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/apply$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentApply,
  },
  // Single comment operations (GET/PUT/DELETE, method-dispatched)
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentGet,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/,
    captures: ['uuid', 'uuid'],
    handler: handlePresentationCommentDelete,
  },
  // List/Create comments (method-dispatched)
  {
    method: 'GET',
    pattern: /^\/api\/presentations\/([^/]+)\/comments$/,
    captures: ['uuid'],
    handler: handlePresentationCommentsList,
  },
  {
    method: 'POST',
    pattern: /^\/api\/presentations\/([^/]+)\/comments$/,
    captures: ['uuid'],
    handler: handlePresentationCommentsCreate,
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
