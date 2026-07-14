import { getPresentation } from '../../../storage/presentations.js';
import { getCollaboratorPermission } from '../../../storage/collaborators.js';
import { createRouteContext } from '../../../utils/context.js';
import {
  createPresentationVersion,
  getPresentationVersion,
  listPresentationVersions,
  prunePresentationVersions,
} from '../../../storage/presentations/versions.js';
import { isAiCompareAvailable, compareVersionsWithAi } from '../../../utils/ai/compare-versions.js';
import {
  json,
  methodNotAllowed,
  noContent,
  notFound,
  serveJson,
  unauthorized,
} from '../../../utils/http.js';
import {
  canReadPresentation,
  canWritePresentation,
} from '../../../utils/presentation-authz.js';
import { logError, logDebug } from '../../../utils/logger.js';

// Throttle session-end snapshots to prevent duplicates from rapid beacon delivery
// (e.g., both beforeunload and visibilitychange firing on tab close)
const SESSION_END_THROTTLE_MS = 60 * 1000;

export async function handlePresentationVersions(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);

  if (req.method === 'GET') {
    const versions = await listPresentationVersions(repoRoot, id);
    serveJson(res, 200, versions);
    return true;
  }

  if (req.method === 'POST') {
    if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) return unauthorized(res);
    const body = await json(req);
    const label = typeof body?.label === 'string' ? body.label.trim() : '';
    const snap = await createPresentationVersion(repoRoot, id, pres, {
      actorEmail: authedUser?.email || null,
      reason: 'manual',
      label,
    });
    serveJson(res, 201, {
      ok: true,
      version: snap
        ? {
            id: snap.id,
            created: snap.created,
            createdBy: snap.createdBy || null,
            reason: snap.reason || 'manual',
            revision: snap.revision || null,
            title: snap.title || '',
          }
        : null,
    });
    return true;
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}

/**
 * Handle single version retrieval.
 * GET /api/presentations/:id/versions/:versionId
 * Returns full version data including presentation for preview/comparison.
 */
export async function handlePresentationVersionItem(
  { repoRoot, req, res, authedUser } = {},
  id,
  versionId
) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const version = await getPresentationVersion(repoRoot, id, versionId);
  if (!version) return notFound(res);

  serveJson(res, 200, {
    id: version.id,
    created: version.created,
    createdBy: version.createdBy || null,
    reason: version.reason || 'snapshot',
    label: version.label || '',
    revision: version.revision || null,
    title: version.title || '',
    presentation: version.presentation || null,
  });
  return true;
}

/**
 * Handle version export as JSON.
 * GET /api/presentations/:id/versions/:versionId/export/json
 * Returns the full version as a downloadable JSON file.
 */
export async function handlePresentationVersionExport(
  { repoRoot, req, res, authedUser } = {},
  id,
  versionId
) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET']);
  }

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const version = await getPresentationVersion(repoRoot, id, versionId);
  if (!version) return notFound(res);

  // Build export data
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: {
      id: version.id,
      created: version.created,
      createdBy: version.createdBy || null,
      reason: version.reason || 'snapshot',
      label: version.label || '',
    },
    presentation: version.presentation || null,
  };

  // Generate filename
  const title = String(version.title || pres.title || 'presentation')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 50);
  const dateStr = version.created
    ? new Date(version.created).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const filename = `${title}-${dateStr}-${versionId.slice(0, 8)}.json`;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.statusCode = 200;
  res.end(JSON.stringify(exportData, null, 2));
  return true;
}

/**
 * Handle AI-powered version comparison.
 * POST /api/presentations/:id/versions/:versionId/compare-ai
 * Returns an AI-generated summary of differences between current and snapshot.
 */
export async function handlePresentationVersionCompareAi(
  { repoRoot, req, res, authedUser } = {},
  id,
  versionId
) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  // Check if AI is available
  if (!isAiCompareAvailable()) {
    return serveJson(res, 503, {
      error: 'AI comparison not available',
      reason: 'No LLM vendor configured',
    });
  }

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  const version = await getPresentationVersion(repoRoot, id, versionId);
  if (!version) return notFound(res);

  const currentSlides = pres.slides || [];
  const snapshotSlides = version.presentation?.slides || [];
  const snapshotDate = version.created
    ? new Date(version.created).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'unknown date';

  try {
    const result = await compareVersionsWithAi({
      currentSlides,
      snapshotSlides,
      snapshotDate,
    });

    serveJson(res, 200, {
      ok: true,
      insights: result.insights,
      metadata: result.metadata,
    });
  } catch (e) {
    serveJson(res, 500, {
      error: 'AI comparison failed',
      message: e?.message || String(e),
    });
  }

  return true;
}

/**
 * Handle session-end snapshot request.
 * Creates a snapshot with reason='session_end' when an editing session ends.
 * Called from client on idle timeout, tab close, or visibility change.
 * Throttled to prevent duplicate snapshots from rapid beacon delivery.
 */
export async function handlePresentationSessionEnd(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST']);
  }

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Fetch collaborator permission for ACL check
  const ctx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, ctx);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res);
  }

  try {
    // Throttle check: skip if a session-end snapshot was created recently
    // This prevents duplicates from rapid beacon delivery (beforeunload + visibilitychange)
    const existing = await listPresentationVersions(repoRoot, id);
    const lastSessionEnd = existing?.find((v) => v.reason === 'session_end');
    if (lastSessionEnd?.created) {
      const lastCreatedMs = new Date(lastSessionEnd.created).getTime();
      if (Date.now() - lastCreatedMs < SESSION_END_THROTTLE_MS) {
        logDebug('versions', `Skipping session-end snapshot for ${id}: throttled (last: ${lastSessionEnd.created})`);
        return noContent(res);
      }
    }

    // Create session-end snapshot
    await createPresentationVersion(repoRoot, id, pres, {
      actorEmail: authedUser?.email || null,
      reason: 'session_end',
    });
    // Apply tiered pruning after creating snapshot
    await prunePresentationVersions(repoRoot, id);
  } catch (err) {
    // Session-end snapshots are best-effort; don't fail the request
    // But log the error for debugging/monitoring
    logError('versions', 'Failed to create session-end snapshot:', err);
  }

  return noContent(res);
}
