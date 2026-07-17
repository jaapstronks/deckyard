import { badRequest } from '../../utils/http.js';
import { handlePresentationsList } from './presentations/list.js';
import { handlePopularPresentations } from './presentations/popular.js';
import { handlePresentationsSearch } from './presentations/search.js';
import { handlePresentationsCreate } from './presentations/create.js';
import { handlePresentationsImportJson } from './presentations/import-json.js';
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
  handlePresentationCommentCounts,
  handlePresentationCommentEvents,
} from './presentations/comments.js';
import { handlePresentationImportSlidesAsImages } from './presentations/import-slides-as-images.js';
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

export async function handlePresentations({
  repoRoot,
  req,
  res,
  url,
  authedUser,
}) {
  if (url.pathname === '/api/presentations' && req.method === 'GET') {
    return handlePresentationsList({ repoRoot, req, res, url, authedUser });
  }

  // Search endpoint (before :id routes to avoid conflicts)
  if (url.pathname === '/api/presentations/search' && req.method === 'GET') {
    return handlePresentationsSearch({ repoRoot, req, res, url, authedUser });
  }

  // Popular presentations endpoint (before :id routes to avoid conflicts)
  if (url.pathname === '/api/presentations/popular' && req.method === 'GET') {
    return handlePopularPresentations({ repoRoot, req, res, url, authedUser });
  }

  // Trash routes (before :id routes to avoid conflicts)
  if (url.pathname === '/api/presentations/trash') {
    return handlePresentationsTrashList({ repoRoot, req, res, url, authedUser });
  }

  const trashRestoreMatch = url.pathname.match(/^\/api\/presentations\/([^/]+)\/restore$/);
  if (trashRestoreMatch) {
    return handlePresentationRestore(
      { repoRoot, req, res, url, authedUser },
      trashRestoreMatch[1]
    );
  }

  const permanentDeleteMatch = url.pathname.match(/^\/api\/presentations\/([^/]+)\/permanent$/);
  if (permanentDeleteMatch) {
    return handlePresentationPermanentDelete(
      { repoRoot, req, res, url, authedUser },
      permanentDeleteMatch[1]
    );
  }

  // Translate a set of arbitrary fields (key -> string). Used for slide-level preview/apply in editor.
  const translateFieldsMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/translate\/fields$/
  );
  if (translateFieldsMatch) {
    return handlePresentationTranslateFields(
      { repoRoot, req, res, url, authedUser },
      translateFieldsMatch[1]
    );
  }

  // Translate only missing (empty) fields into the other language (safe for manual edits).
  const translateMissingMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/translate\/missing$/
  );
  if (translateMissingMatch) {
    return handlePresentationTranslateMissing(
      { repoRoot, req, res, url, authedUser },
      translateMissingMatch[1]
    );
  }

  // Translate a presentation into the other supported language and store as an i18n version.
  const translateMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/translate$/
  );
  if (translateMatch) {
    return handlePresentationTranslate(
      { repoRoot, req, res, url, authedUser },
      translateMatch[1]
    );
  }

  const describeMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/description\/generate$/
  );
  if (describeMatch) {
    return handlePresentationDescriptionGenerate(
      { repoRoot, req, res, url, authedUser },
      describeMatch[1]
    );
  }

  if (url.pathname === '/api/presentations' && req.method === 'POST') {
    return handlePresentationsCreate({ repoRoot, req, res, url, authedUser });
  }

  // Import (portable JSON deck format)
  if (url.pathname === '/api/presentations/import/json' && req.method === 'POST') {
    return handlePresentationsImportJson({ repoRoot, req, res, url, authedUser });
  }

  // Import (markdown deck format — deterministic, no AI)
  if (url.pathname === '/api/presentations/import/markdown' && req.method === 'POST') {
    return handlePresentationsImportMarkdown({ repoRoot, req, res, url, authedUser });
  }

  const scopeMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/scope$/
  );
  if (scopeMatch) {
    return handlePresentationScope(
      { repoRoot, req, res, url, authedUser },
      scopeMatch[1]
    );
  }

  const dupMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/duplicate$/
  );
  if (dupMatch) {
    return handlePresentationDuplicate(
      { repoRoot, req, res, url, authedUser },
      dupMatch[1]
    );
  }

  // Lightweight revision probe (staleness check for waking editor tabs)
  const revisionMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/revision$/
  );
  if (revisionMatch) {
    return handlePresentationRevision(
      { repoRoot, req, res, url, authedUser },
      revisionMatch[1]
    );
  }

  const presMatch = url.pathname.match(/^\/api\/presentations\/([^/]+)$/);
  if (presMatch) {
    // Skip special routes handled by other modules
    const specialRoutes = ['shared-with-me', 'search', 'trash', 'import', 'popular'];
    if (specialRoutes.includes(presMatch[1])) {
      return false;
    }
    return handlePresentationItem(
      { repoRoot, req, res, url, authedUser },
      presMatch[1]
    );
  }

  // Version history (snapshots)
  const versionsMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/versions$/
  );
  if (versionsMatch) {
    return handlePresentationVersions(
      { repoRoot, req, res, url, authedUser },
      versionsMatch[1]
    );
  }

  // Session-end snapshot (called when editing session ends)
  const sessionEndMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/session-end$/
  );
  if (sessionEndMatch) {
    return handlePresentationSessionEnd(
      { repoRoot, req, res, url, authedUser },
      sessionEndMatch[1]
    );
  }

  const restoreMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/restore$/
  );
  if (restoreMatch) {
    return handlePresentationRestoreVersion(
      { repoRoot, req, res, url, authedUser },
      restoreMatch[1],
      restoreMatch[2]
    );
  }

  // Version export as JSON
  const versionExportMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/export\/json$/
  );
  if (versionExportMatch) {
    return handlePresentationVersionExport(
      { repoRoot, req, res, url, authedUser },
      versionExportMatch[1],
      versionExportMatch[2]
    );
  }

  // AI-powered version comparison
  const versionCompareAiMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)\/compare-ai$/
  );
  if (versionCompareAiMatch) {
    return handlePresentationVersionCompareAi(
      { repoRoot, req, res, url, authedUser },
      versionCompareAiMatch[1],
      versionCompareAiMatch[2]
    );
  }

  // Single version retrieval (for preview/comparison)
  const versionItemMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/versions\/([^/]+)$/
  );
  if (versionItemMatch) {
    return handlePresentationVersionItem(
      { repoRoot, req, res, url, authedUser },
      versionItemMatch[1],
      versionItemMatch[2]
    );
  }

  // Presence / soft locks (advisory)
  const lockStatusMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock$/
  );
  if (lockStatusMatch) {
    return handlePresentationLockStatus(
      { repoRoot, req, res, url, authedUser },
      lockStatusMatch[1]
    );
  }

  const lockAcquireMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/acquire$/
  );
  if (lockAcquireMatch) {
    return handlePresentationLockAcquire(
      { repoRoot, req, res, url, authedUser },
      lockAcquireMatch[1]
    );
  }

  const lockRefreshMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/refresh$/
  );
  if (lockRefreshMatch) {
    return handlePresentationLockRefresh(
      { repoRoot, req, res, url, authedUser },
      lockRefreshMatch[1]
    );
  }

  const lockReleaseMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/release$/
  );
  if (lockReleaseMatch) {
    return handlePresentationLockRelease(
      { repoRoot, req, res, url, authedUser },
      lockReleaseMatch[1]
    );
  }

  const lockForceReleaseMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/force-release$/
  );
  if (lockForceReleaseMatch) {
    return handlePresentationLockForceRelease(
      { repoRoot, req, res, url, authedUser },
      lockForceReleaseMatch[1]
    );
  }

  // Lock request endpoints
  const lockRequestMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/request$/
  );
  if (lockRequestMatch) {
    return handlePresentationLockRequest(
      { repoRoot, req, res, url, authedUser },
      lockRequestMatch[1]
    );
  }

  const lockRequestsListMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/requests$/
  );
  if (lockRequestsListMatch) {
    return handlePresentationLockRequestsList(
      { repoRoot, req, res, url, authedUser },
      lockRequestsListMatch[1]
    );
  }

  const lockRequestAcceptMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/requests\/([^/]+)\/accept$/
  );
  if (lockRequestAcceptMatch) {
    return handlePresentationLockRequestAccept(
      { repoRoot, req, res, url, authedUser },
      lockRequestAcceptMatch[1],
      lockRequestAcceptMatch[2]
    );
  }

  const lockRequestRejectMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/requests\/([^/]+)\/reject$/
  );
  if (lockRequestRejectMatch) {
    return handlePresentationLockRequestReject(
      { repoRoot, req, res, url, authedUser },
      lockRequestRejectMatch[1],
      lockRequestRejectMatch[2]
    );
  }

  const lockMyRequestMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/lock\/my-request$/
  );
  if (lockMyRequestMatch) {
    return handlePresentationLockMyRequest(
      { repoRoot, req, res, url, authedUser },
      lockMyRequestMatch[1]
    );
  }

  // ============================================================
  // SLIDE-LEVEL LOCKS (concurrent editing)
  // ============================================================

  // List all slide locks for a presentation
  const slideLocksListMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/slide-locks$/
  );
  if (slideLocksListMatch) {
    return handleSlideLocksList(
      { repoRoot, req, res, url, authedUser },
      slideLocksListMatch[1]
    );
  }

  // Release all slide locks for current user
  const slideLocksReleaseAllMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/slide-locks\/release-all$/
  );
  if (slideLocksReleaseAllMatch) {
    return handleSlideLocksReleaseAll(
      { repoRoot, req, res, url, authedUser },
      slideLocksReleaseAllMatch[1]
    );
  }

  // Refresh a specific slide lock
  const slideLockRefreshMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock\/refresh$/
  );
  if (slideLockRefreshMatch) {
    return handleSlideLockRefresh(
      { repoRoot, req, res, url, authedUser },
      slideLockRefreshMatch[1],
      slideLockRefreshMatch[2]
    );
  }

  // Acquire or release a specific slide lock
  const slideLockMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/slides\/([^/]+)\/lock$/
  );
  if (slideLockMatch) {
    if (req.method === 'GET') {
      return handleSlideLockStatus(
        { repoRoot, req, res, url, authedUser },
        slideLockMatch[1],
        slideLockMatch[2]
      );
    }
    if (req.method === 'POST') {
      return handleSlideLockAcquire(
        { repoRoot, req, res, url, authedUser },
        slideLockMatch[1],
        slideLockMatch[2]
      );
    }
    if (req.method === 'DELETE') {
      return handleSlideLockRelease(
        { repoRoot, req, res, url, authedUser },
        slideLockMatch[1],
        slideLockMatch[2]
      );
    }
  }

  // ============================================================
  // IMPORT SLIDES AS IMAGES (PDF → image-slide)
  // ============================================================

  const importSlidesMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/import-slides-as-images$/
  );
  if (importSlidesMatch) {
    return handlePresentationImportSlidesAsImages(
      { repoRoot, req, res, url, authedUser },
      importSlidesMatch[1]
    );
  }

  // ============================================================
  // AI ANALYSIS
  // ============================================================

  const analyzeMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/analyze$/
  );
  if (analyzeMatch) {
    return handlePresentationAnalyze(
      { repoRoot, req, res, url, authedUser },
      analyzeMatch[1]
    );
  }

  // ============================================================
  // THEME CHANGE
  // ============================================================

  const analyzeThemeChangeMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/analyze-theme-change$/
  );
  if (analyzeThemeChangeMatch) {
    return handleAnalyzeThemeChange(
      { repoRoot, req, res, url, authedUser },
      analyzeThemeChangeMatch[1]
    );
  }

  const changeThemeMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/change-theme$/
  );
  if (changeThemeMatch) {
    return handleChangeTheme(
      { repoRoot, req, res, url, authedUser },
      changeThemeMatch[1]
    );
  }

  // ============================================================
  // TAGS
  // ============================================================

  const tagsMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/tags$/
  );
  if (tagsMatch) {
    return handlePresentationTags(
      { req, res, url, presentationId: tagsMatch[1] }
    );
  }

  // ============================================================
  // OWNERSHIP TRANSFER
  // ============================================================

  const ownershipMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/transfer-ownership$/
  );
  if (ownershipMatch) {
    return handleOwnershipTransfer(
      { repoRoot, req, res, url, authedUser },
      ownershipMatch[1]
    );
  }

  // ============================================================
  // RENDER SLIDE (server-side rendering for custom slide types)
  // ============================================================

  const renderSlideMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/render-slide$/
  );
  if (renderSlideMatch) {
    return handleRenderSlide(
      { repoRoot, req, res, authedUser },
      renderSlideMatch[1]
    );
  }

  // ============================================================
  // COMMENTS
  // ============================================================

  // Comment counts per slide (before more specific routes)
  const commentCountsMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/counts$/
  );
  if (commentCountsMatch) {
    return handlePresentationCommentCounts(
      { repoRoot, req, res, url, authedUser },
      commentCountsMatch[1]
    );
  }

  // SSE endpoint for real-time comment updates
  const commentEventsMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/events$/
  );
  if (commentEventsMatch) {
    return handlePresentationCommentEvents(
      { repoRoot, req, res, url, authedUser },
      commentEventsMatch[1]
    );
  }

  // Resolve comment
  const commentResolveMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/resolve$/
  );
  if (commentResolveMatch) {
    return handlePresentationCommentResolve(
      { repoRoot, req, res, url, authedUser },
      commentResolveMatch[1],
      commentResolveMatch[2]
    );
  }

  // Reopen comment
  const commentReopenMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/reopen$/
  );
  if (commentReopenMatch) {
    return handlePresentationCommentReopen(
      { repoRoot, req, res, url, authedUser },
      commentReopenMatch[1],
      commentReopenMatch[2]
    );
  }

  // Dismiss AI suggestion
  const commentDismissMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/dismiss$/
  );
  if (commentDismissMatch) {
    return handlePresentationCommentDismiss(
      { repoRoot, req, res, url, authedUser },
      commentDismissMatch[1],
      commentDismissMatch[2]
    );
  }

  // Apply AI suggestion (create proposed slide)
  const commentApplyMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)\/apply$/
  );
  if (commentApplyMatch) {
    return handlePresentationCommentApply(
      { repoRoot, req, res, url, authedUser },
      commentApplyMatch[1],
      commentApplyMatch[2]
    );
  }

  // Single comment operations (GET/PUT/DELETE)
  const commentItemMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments\/([^/]+)$/
  );
  if (commentItemMatch) {
    const presId = commentItemMatch[1];
    const commentId = commentItemMatch[2];
    if (req.method === 'GET') {
      return handlePresentationCommentGet(
        { repoRoot, req, res, url, authedUser },
        presId,
        commentId
      );
    }
    if (req.method === 'PUT') {
      return handlePresentationCommentUpdate(
        { repoRoot, req, res, url, authedUser },
        presId,
        commentId
      );
    }
    if (req.method === 'DELETE') {
      return handlePresentationCommentDelete(
        { repoRoot, req, res, url, authedUser },
        presId,
        commentId
      );
    }
  }

  // List/Create comments
  const commentsListMatch = url.pathname.match(
    /^\/api\/presentations\/([^/]+)\/comments$/
  );
  if (commentsListMatch) {
    if (req.method === 'GET') {
      return handlePresentationCommentsList(
        { repoRoot, req, res, url, authedUser },
        commentsListMatch[1]
      );
    }
    if (req.method === 'POST') {
      return handlePresentationCommentsCreate(
        { repoRoot, req, res, url, authedUser },
        commentsListMatch[1]
      );
    }
  }

  // This module purposely does NOT handle export/publish routes.
  // Those live in `export.js` and `publish.js`.

  // Note: keep a tiny placeholder route for early "bad import" debugging.
  if (url.pathname === '/api/presentations/import' && req.method === 'POST') {
    return badRequest(res, 'Use /api/presentations/import/json');
  }

  return false;
}
