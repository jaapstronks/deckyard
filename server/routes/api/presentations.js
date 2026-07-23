import { badRequest } from '../../utils/http.js';
import { handlePresentationsList } from './presentations/list.js';
import { handlePopularPresentations } from './presentations/popular.js';
import { handlePresentationsSearch } from './presentations/search.js';
import { handlePresentationsCreate } from './presentations/create.js';
import { handlePresentationsImportJson } from './presentations/import-json.js';
import { handlePresentationsImportDeck } from './presentations/import-deck.js';
import { handlePresentationsImportMarkdown } from './presentations/import-markdown.js';
import { handlePresentationScope } from './presentations/scope.js';
import { handlePresentationItem, handlePresentationRevision } from './presentations/presentation.js';
import { handlePresentationDuplicate } from './presentations/duplicate.js';
import { handlePresentationDescriptionGenerate } from './presentations/description.js';
import { handlePresentationTranslateFields } from './presentations/translate-fields.js';
import { handlePresentationTranslateMissing } from './presentations/translate-missing.js';
import { handlePresentationTranslate } from './presentations/translate.js';
import { handlePresentationVersions, handlePresentationVersionItem, handlePresentationVersionExport, handlePresentationVersionCompareAi, handlePresentationSessionEnd } from './presentations/versions.js';
import { handlePresentationRestoreVersion } from './presentations/restore.js';
import {
  handlePresentationsTrashList,
  handlePresentationRestore,
  handlePresentationPermanentDelete,
} from './presentations/trash.js';
import {
  handlePresentationLockAcquire,
  handlePresentationLockRefresh,
  handlePresentationLockRelease,
  handlePresentationLockStatus,
  handlePresentationLockForceRelease,
  handlePresentationLockRequest,
  handlePresentationLockRequestsList,
  handlePresentationLockRequestAccept,
  handlePresentationLockRequestReject,
  handlePresentationLockMyRequest,
} from './presentations/locks.js';
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
} from './presentations/comments.js';
import { handlePresentationImportSlidesAsImages } from './presentations/import-slides-as-images.js';
import { handlePresentationSubscription } from './presentations/subscription.js';
import { handlePresentationAnalyze } from './presentations/analyze.js';
import { handlePresentationTags } from './tags.js';
import { handleOwnershipTransfer } from './presentations/ownership.js';
import { handleRenderSlide } from './presentations/render-slide.js';
import {
  handleSlideLocksList,
  handleSlideLockStatus,
  handleSlideLockAcquire,
  handleSlideLockRefresh,
  handleSlideLockRelease,
  handleSlideLocksReleaseAll,
} from './presentations/slide-locks.js';
import {
  handleAnalyzeThemeChange,
  handleChangeTheme,
} from './presentations/change-theme.js';

/**
 * A dispatch context, forwarded verbatim to every route handler.
 *
 * @typedef {object} PresentationsContext
 * @property {string} repoRoot
 * @property {import('http').IncomingMessage} req
 * @property {import('http').ServerResponse} res
 * @property {URL} url
 * @property {object|null} authedUser
 */

/**
 * A single declarative route.
 *
 * @typedef {object} PresentationRoute
 * @property {string} [method] - HTTP method to require; omit to match any method.
 * @property {string|RegExp} pattern - Exact pathname (string) or a pattern whose
 *   capture groups become positional handler args.
 * @property {(ctx: PresentationsContext, ...params: string[]) => unknown} handler
 */

// ── Adapters for the few handlers whose call shape differs from
//    `handler(ctx, ...captureGroups)` ────────────────────────────────────────

/**
 * Bare `/api/presentations/:id`. Skips ids that belong to sibling modules so
 * this generic route never swallows their (possibly method-mismatched) requests.
 * @param {PresentationsContext} ctx
 * @param {string} id
 */
function handlePresentationItemRoute(ctx, id) {
  // Skip special routes handled by other modules
  const specialRoutes = ['shared-with-me', 'search', 'trash', 'import', 'popular'];
  if (specialRoutes.includes(id)) {
    return false;
  }
  return handlePresentationItem(ctx, id);
}

/**
 * Tags handler takes a bespoke context shape (`presentationId`, no `repoRoot`).
 * @param {PresentationsContext} ctx
 * @param {string} id
 */
function handlePresentationTagsRoute({ req, res, url }, id) {
  return handlePresentationTags({ req, res, url, presentationId: id });
}

/**
 * Render-slide is deliberately called without `url` in its context.
 * @param {PresentationsContext} ctx
 * @param {string} id
 */
function handleRenderSlideRoute({ repoRoot, req, res, authedUser }, id) {
  return handleRenderSlide({ repoRoot, req, res, authedUser }, id);
}

/**
 * Legacy `/api/presentations/import` placeholder kept for early "bad import"
 * debugging — points callers at the real endpoint.
 * @param {PresentationsContext} ctx
 */
function handleLegacyImportBadRequest({ res }) {
  return badRequest(res, 'Use /api/presentations/import/json');
}

/**
 * Declarative route table for `/api/presentations/*`.
 *
 * IMPORTANT — this is a first-match dispatcher. The order below is significant
 * and mirrors the original `if`-chain exactly: specific paths (`/search`,
 * `/popular`, `/trash`, `/import/*`, the `/versions/…`, `/lock/…`,
 * `/slides/…/lock`, and `/comments/…` sub-routes) MUST stay ahead of the
 * generic `/api/presentations/:id`. Do not alphabetize or regroup.
 *
 * Paths that carry a `method` behave like the original nested method branches:
 * a request whose method doesn't match falls through to the next route rather
 * than being rejected here.
 *
 * @type {PresentationRoute[]}
 */
const ROUTES = [
  { method: 'GET', pattern: '/api/presentations', handler: handlePresentationsList },

  // Search endpoint (before :id routes to avoid conflicts)
  { method: 'GET', pattern: '/api/presentations/search', handler: handlePresentationsSearch },

  // Popular presentations endpoint (before :id routes to avoid conflicts)
  { method: 'GET', pattern: '/api/presentations/popular', handler: handlePopularPresentations },

  // Trash routes (before :id routes to avoid conflicts)
  { pattern: '/api/presentations/trash', handler: handlePresentationsTrashList },
  { pattern: /^\/api\/presentations\/([^/]+)\/restore$/, handler: handlePresentationRestore },
  { pattern: /^\/api\/presentations\/([^/]+)\/permanent$/, handler: handlePresentationPermanentDelete },

  // Translate a set of arbitrary fields (key -> string). Used for slide-level preview/apply in editor.
  { pattern: /^\/api\/presentations\/([^/]+)\/translate\/fields$/, handler: handlePresentationTranslateFields },
  // Translate only missing (empty) fields into the other language (safe for manual edits).
  { pattern: /^\/api\/presentations\/([^/]+)\/translate\/missing$/, handler: handlePresentationTranslateMissing },
  // Translate a presentation into the other supported language and store as an i18n version.
  { pattern: /^\/api\/presentations\/([^/]+)\/translate$/, handler: handlePresentationTranslate },

  { pattern: /^\/api\/presentations\/([^/]+)\/description\/generate$/, handler: handlePresentationDescriptionGenerate },

  { method: 'POST', pattern: '/api/presentations', handler: handlePresentationsCreate },

  // Import (portable JSON deck format)
  { method: 'POST', pattern: '/api/presentations/import/json', handler: handlePresentationsImportJson },
  // Import (self-contained .deck bundle — re-hydrates embedded assets)
  { method: 'POST', pattern: '/api/presentations/import/deck', handler: handlePresentationsImportDeck },
  // Import (markdown deck format — deterministic, no AI)
  { method: 'POST', pattern: '/api/presentations/import/markdown', handler: handlePresentationsImportMarkdown },

  { pattern: /^\/api\/presentations\/([^/]+)\/scope$/, handler: handlePresentationScope },
  { pattern: /^\/api\/presentations\/([^/]+)\/duplicate$/, handler: handlePresentationDuplicate },

  // Lightweight revision probe (staleness check for waking editor tabs)
  { pattern: /^\/api\/presentations\/([^/]+)\/revision$/, handler: handlePresentationRevision },

  { pattern: /^\/api\/presentations\/([^/]+)$/, handler: handlePresentationItemRoute },

  // Version history (snapshots)
  { pattern: /^\/api\/presentations\/([^/]+)\/versions$/, handler: handlePresentationVersions },
  // Session-end snapshot (called when editing session ends)
  { pattern: /^\/api\/presentations\/([^/]+)\/session-end$/, handler: handlePresentationSessionEnd },
  { pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/restore$/, handler: handlePresentationRestoreVersion },
  // Version export as JSON
  { pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/export\/json$/, handler: handlePresentationVersionExport },
  // AI-powered version comparison
  { pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/compare-ai$/, handler: handlePresentationVersionCompareAi },
  // Single version retrieval (for preview/comparison)
  { pattern: /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)$/, handler: handlePresentationVersionItem },

  // Presence / soft locks (advisory)
  { pattern: /^\/api\/presentations\/([^/]+)\/lock$/, handler: handlePresentationLockStatus },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/acquire$/, handler: handlePresentationLockAcquire },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/refresh$/, handler: handlePresentationLockRefresh },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/release$/, handler: handlePresentationLockRelease },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/force-release$/, handler: handlePresentationLockForceRelease },

  // Lock request endpoints
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/request$/, handler: handlePresentationLockRequest },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/requests$/, handler: handlePresentationLockRequestsList },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/requests\/([^/]+)\/accept$/, handler: handlePresentationLockRequestAccept },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/requests\/([^/]+)\/reject$/, handler: handlePresentationLockRequestReject },
  { pattern: /^\/api\/presentations\/([^/]+)\/lock\/my-request$/, handler: handlePresentationLockMyRequest },

  // ============================================================
  // SLIDE-LEVEL LOCKS (concurrent editing)
  // ============================================================

  // List all slide locks for a presentation
  { pattern: /^\/api\/presentations\/([^/]+)\/slide-locks$/, handler: handleSlideLocksList },
  // Release all slide locks for current user
  { pattern: /^\/api\/presentations\/([^/]+)\/slide-locks\/release-all$/, handler: handleSlideLocksReleaseAll },
  // Refresh a specific slide lock
  { pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock\/refresh$/, handler: handleSlideLockRefresh },
  // Acquire, release, or read a specific slide lock (method-dispatched)
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/, handler: handleSlideLockStatus },
  { method: 'POST', pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/, handler: handleSlideLockAcquire },
  { method: 'DELETE', pattern: /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/, handler: handleSlideLockRelease },

  // ============================================================
  // IMPORT SLIDES AS IMAGES (PDF → image-slide)
  // ============================================================
  { pattern: /^\/api\/presentations\/([^/]+)\/import-slides-as-images$/, handler: handlePresentationImportSlidesAsImages },

  // ============================================================
  // AI ANALYSIS
  // ============================================================
  { pattern: /^\/api\/presentations\/([^/]+)\/analyze$/, handler: handlePresentationAnalyze },

  // ============================================================
  // THEME CHANGE
  // ============================================================
  { pattern: /^\/api\/presentations\/([^/]+)\/analyze-theme-change$/, handler: handleAnalyzeThemeChange },
  { pattern: /^\/api\/presentations\/([^/]+)\/change-theme$/, handler: handleChangeTheme },

  // ============================================================
  // TAGS
  // ============================================================
  { pattern: /^\/api\/presentations\/([^/]+)\/tags$/, handler: handlePresentationTagsRoute },

  // ============================================================
  // OWNERSHIP TRANSFER
  // ============================================================
  { pattern: /^\/api\/presentations\/([^/]+)\/transfer-ownership$/, handler: handleOwnershipTransfer },

  // ============================================================
  // RENDER SLIDE (server-side rendering for custom slide types)
  // ============================================================
  { pattern: /^\/api\/presentations\/([^/]+)\/render-slide$/, handler: handleRenderSlideRoute },

  // ============================================================
  // COMMENTS
  // ============================================================

  // Comment counts per slide (before more specific routes)
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/counts$/, handler: handlePresentationCommentCounts },
  // Per-deck notification subscription (personal, GET current / PUT set)
  { pattern: /^\/api\/presentations\/([^/]+)\/subscription$/, handler: handlePresentationSubscription },
  // Mark comment threads as read for the current user (batch)
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/mark-read$/, handler: handlePresentationCommentsMarkRead },
  // SSE endpoint for real-time comment updates
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/events$/, handler: handlePresentationCommentEvents },
  // Resolve comment
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/resolve$/, handler: handlePresentationCommentResolve },
  // Reopen comment
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/reopen$/, handler: handlePresentationCommentReopen },
  // Dismiss AI suggestion
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/dismiss$/, handler: handlePresentationCommentDismiss },
  // Apply AI suggestion (create proposed slide)
  { pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/apply$/, handler: handlePresentationCommentApply },
  // Single comment operations (GET/PUT/DELETE, method-dispatched)
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/, handler: handlePresentationCommentGet },
  { method: 'PUT', pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/, handler: handlePresentationCommentUpdate },
  { method: 'DELETE', pattern: /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/, handler: handlePresentationCommentDelete },
  // List/Create comments (method-dispatched)
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/comments$/, handler: handlePresentationCommentsList },
  { method: 'POST', pattern: /^\/api\/presentations\/([^/]+)\/comments$/, handler: handlePresentationCommentsCreate },

  // This module purposely does NOT handle export/publish routes.
  // Those live in `export.js` and `publish.js`.

  // Note: keep a tiny placeholder route for early "bad import" debugging.
  { method: 'POST', pattern: '/api/presentations/import', handler: handleLegacyImportBadRequest },
];

/**
 * Dispatch a `/api/presentations/*` request through the first matching route.
 *
 * Signature and return contract are unchanged from the original hand-written
 * `if`-chain: returns the matched handler's result (truthy = handled), or
 * `false` when no route matches (letting the caller fall through).
 *
 * @param {PresentationsContext} ctx
 * @returns {Promise<unknown>|unknown}
 */
export async function handlePresentations({
  repoRoot,
  req,
  res,
  url,
  authedUser,
}) {
  const ctx = { repoRoot, req, res, url, authedUser };

  for (const route of ROUTES) {
    if (route.method && req.method !== route.method) continue;

    if (typeof route.pattern === 'string') {
      if (url.pathname !== route.pattern) continue;
      return route.handler(ctx);
    }

    const match = route.pattern.exec(url.pathname);
    if (!match) continue;
    return route.handler(ctx, ...match.slice(1));
  }

  return false;
}
