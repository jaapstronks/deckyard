import {
  notFound,
  unauthorized,
  forbidden,
  jsonError,
  serveJson,
  methodNotAllowed,
} from '../../utils/http.js';
import { isCsrfSafe } from '../../utils/csrf.js';
import {
  MaintenanceWriteError,
  assertWritable,
  getMaintenanceState,
} from '../../config/maintenance.js';
import { authEnabled, getUserFromRequestAsync } from '../../auth/auth.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { ensureSandboxUserAsync } from '../../auth/sandbox.js';
import { resolveDesignerCapability } from '../../utils/designer.js';
import { canEditCustomHtml } from '../../utils/route-middleware.js';
import { createStorageScope } from '../../utils/context.js';

// Public API v1 (API key authentication)
import { handlePublicApiV1 } from '../public-api/v1/index.js';

import { handleAuth } from './auth.js';
import { handlePasswordReset } from './password-reset.js';
import { handleMagicLink } from './magic-link.js';
import { handleSso } from './sso.js';
import { handleAdminUsers } from './admin-users.js';
import { handleAdminAiLogs } from './admin-ai-logs.js';
import { handleAdminSso } from './admin-sso.js';
import { handleInstanceHealthRoutes } from './instance-health.js';
import { handleEmailTemplates } from './email-templates.js';
import { handleFollowPublic } from './follow/index.js';
import { handleFollowCodes, handleFollowCodesPublic } from './follow-codes.js';
import { dispatchMounts, dispatchRoutes } from '../../utils/router.js';
import { handleLiveSessions } from './live-sessions.js';
import { handleLiveSessionsPublic } from './live-session-audience.js';
import { handleAssets } from './assets.js';
import { handleSlideTypes } from './slide-types.js';
import { handleRenderSlide } from './render-slide.js';
import { handleThemes } from './themes.js';
import { handleCustomSlideTypes } from './custom-slide-types.js';
import { handleFontFamilies } from './font-families.js';
import { handleImageLibrary } from './image-library.js';
import { handlePresentations } from './presentations/index.js';
import { handleHome } from './home.js';
import { handleSandbox } from './sandbox.js';
import { handleAi } from './ai/index.js';
import { handleNotion } from './notion/index.js';
import { handleUploads } from './uploads.js';
import { handleExports } from './export.js';
import { handleBulkExport } from './bulk-export.js';
import { handlePublish } from './publish.js';
import { handleShareLinks, handleSharePublic } from './share-links/index.js';
import { handleQuestions } from './questions.js';
import { handleSettings } from './settings.js';
import { handleSlideLibrary } from './slide-library.js';
import { handleSlideCollections } from './slide-collections.js';
import { handleMedia } from './media.js';
import { handleConvert } from './convert.js';
import { handleActivity } from './activity.js';
import { handleCollaborators } from './collaborators.js';
import { handleUsers } from './users.js';
import { handleProfile } from './profile.js';
import { handleNotifications } from './notifications.js';
import { handleAnalyticsTrack } from './analytics-track.js';
import {
  handleAnalytics,
  handleAnalyticsReportPublic,
} from './analytics/index.js';
import { handleTags } from './tags.js';
import { handleStockMedia } from './stock-media.js';
import { handleApiKeys } from './api-keys.js';
import { handleJobs } from './jobs.js';
import { handleOrganizations } from './organizations.js';
import { handleOrganizationMembers } from './organization-members.js';
import { handleDataSources } from './data-sources.js';

/** GET /api/maintenance — see the mount below for why it is public. */
function handleMaintenanceState({ res }) {
  serveJson(res, 200, getMaintenanceState());
  return true;
}

/**
 * The one endpoint the root dispatcher answers itself. Form B
 * (route-dispatch.md): the old branch sent a 405 for any other method on
 * the path.
 * @type {import('../../utils/router.js').Route[]}
 */
export const MAINTENANCE_ROUTES = [
  {
    method: 'GET',
    pattern: '/api/maintenance',
    handler: handleMaintenanceState,
  },
  {
    pattern: '/api/maintenance',
    handler: ({ res }) => methodNotAllowed(res, ['GET']),
  },
];

/**
 * The mounts in front of the login gate (D257): auth flows, and the audience
 * and viewer endpoints a device without a session reaches. Called with
 * `authedUser: null` — `follow-codes` reads it to tell the public resolve from
 * the authed mint (its `PUBLIC_ROUTES` table). Order mirrors the original
 * chain.
 *
 * @type {import('../../utils/router.js').Mount[]}
 */
export const PUBLIC_MOUNTS = [
  // Auth routes are special: some of them are allowed without a prior session.
  { handle: handleAuth },
  { handle: handlePasswordReset },
  { handle: handleMagicLink },
  // OIDC single sign-on routes (login redirect + IdP callback)
  { handle: handleSso },
  // Audience devices.
  { handle: handleFollowPublic },
  // Follow code resolution (GET) is public; creation (POST) is in MOUNTS.
  { handle: handleFollowCodesPublic },
  // Present-session companion: the session id in the join link is the
  // authorization (see live-session-audience.js). Presenter actions on the
  // same session stay behind deck-write, in MOUNTS.
  { handle: handleLiveSessionsPublic },
  { handle: handleSharePublic },
  { handle: handleAnalyticsTrack },
  { handle: handleAnalyticsReportPublic },
];

/**
 * The mounts behind the login gate, in order. A mount with a `feature` is
 * skipped while that installation cluster is off, so its paths answer the 404
 * at the end of {@link handleApi}: the module does not exist here. That is
 * the only way a module is switched off — never a flag branch in this chain.
 *
 * @type {import('../../utils/router.js').Mount[]}
 */
export const MOUNTS = [
  { handle: handleLiveSessions },
  { handle: handleAssets },
  { handle: handleSlideTypes },
  { handle: handleRenderSlide },
  { handle: handleThemes },
  { handle: handleCustomSlideTypes },
  { handle: handleFontFamilies },
  { handle: handleImageLibrary, feature: 'imageLibrary' },
  { handle: handleMedia },
  { handle: handleHome },
  { handle: handleSandbox },
  { handle: handlePresentations },
  { handle: handleNotion, feature: 'notion' },
  { handle: handleAi, feature: 'ai' },
  { handle: handleConvert, feature: 'ai' },
  { handle: handleUploads, feature: 'uploads' },
  { handle: handleExports },
  { handle: handleBulkExport },
  { handle: handlePublish },
  { handle: handleShareLinks },
  { handle: handleCollaborators },
  { handle: handleUsers },
  { handle: handleProfile },
  { handle: handleNotifications },
  { handle: handleQuestions },
  { handle: handleSettings },
  { handle: handleApiKeys },
  { handle: handleSlideLibrary },
  { handle: handleSlideCollections },
  { handle: handleDataSources, feature: 'liveData' },
  { handle: handleActivity },
  { handle: handleAnalytics },
  { handle: handleTags },
  { handle: handleStockMedia },
  { handle: handleJobs },
  // Organization management (multi-organization mode)
  { handle: handleOrganizations },
  { handle: handleOrganizationMembers },
  // Follow code creation (POST) requires auth
  { handle: handleFollowCodes },
  { handle: handleAdminUsers },
  { handle: handleAdminAiLogs },
  { handle: handleAdminSso },
  { handle: handleInstanceHealthRoutes },
  { handle: handleEmailTemplates },
];

export async function handleApi({ repoRoot, req, res, url }) {
  // CSRF defense: reject cookie-authenticated, cross-origin state-changing
  // requests. No-ops for safe methods, non-cookie auth (API key / MCP), and
  // same-origin requests. See docs/reference/security-posture.md
  // § CSRF: origin/referer check on cookie-authenticated writes.
  if (!isCsrfSafe(req)) {
    return forbidden(res, 'Cross-site request blocked (CSRF)');
  }

  // Maintenance state. Public and unauthenticated on purpose: a client that
  // reconnects after a restart has to be able to ask "are you back?" before it
  // knows whether its session survived, and the answer leaks nothing.
  if (await dispatchRoutes(MAINTENANCE_ROUTES, { repoRoot, req, res, url }))
    return;

  // Maintenance mode refuses writes with a 503 that says when to come back,
  // instead of letting them hit a database that is mid-migration or a process
  // that is mid-shutdown. Reads stay open: a read-only Deckyard still serves
  // viewers and presenters, and blocking GETs would turn a restart into an
  // outage for people who are not writing anything. The decision itself lives
  // in assertWritable — the shared choke-point every write surface (this
  // dispatcher, the MCP tool dispatch, the v1 dispatcher above) goes through.
  // Public API v1 routes (API key authentication, separate from session-based
  // auth). The module carries its own /api/v1 prefix guard and declines
  // everything else. Mounted above the maintenance write gate on purpose: the
  // v1 surface is its own write surface with its own error envelope (B61), so
  // it runs assertWritable itself and answers the refusal in that envelope.
  if (await handlePublicApiV1({ repoRoot, req, res, url })) return;

  try {
    assertWritable(req.method);
  } catch (err) {
    if (!(err instanceof MaintenanceWriteError)) throw err;
    return jsonError(
      res,
      503,
      'maintenance',
      'Deckyard is briefly unavailable for maintenance. Your work is kept in the browser and will save when it is back.',
      {
        details: err.state,
        headers: { 'Retry-After': String(err.retryAfter) },
      },
    );
  }

  if (
    await dispatchMounts(PUBLIC_MOUNTS, {
      repoRoot,
      req,
      res,
      url,
      authedUser: null,
    })
  )
    return;

  // Sandbox mode: auto-provision a per-visitor guest session (cookie) and treat as authenticated.
  // This keeps per-visitor presentation isolation without a login screen.
  // Use async version to properly validate database users who migrated from ENV auth.
  const authCtx = { repoRoot, req };
  let authedUser = sandboxEnabled()
    ? await ensureSandboxUserAsync(req, res)
    : await getUserFromRequestAsync(req, authCtx);
  if (!sandboxEnabled() && authEnabled() && !authedUser)
    return unauthorized(res);

  // Resolve designer capability and attach to user object
  if (authedUser?.email) {
    try {
      const isDesigner = await resolveDesignerCapability(authedUser);
      authedUser = { ...authedUser, isDesigner };
      authedUser = {
        ...authedUser,
        canEditCustomHtml: canEditCustomHtml(authedUser),
      };
    } catch {
      // Fail open - don't block requests if designer resolution fails
    }
  }

  // The storage scope every route acts under: which organization this request
  // works in (membership-verified upstream, see utils/context.js) and on whose
  // behalf. Built once here so a handler passes the scope it was given rather
  // than letting the storage layer invent one — see server/storage/scope.js.
  const storageScope = createStorageScope(authedUser, { repoRoot });

  const ctx = { repoRoot, storageScope, req, res, url, authedUser };

  if (await dispatchMounts(MOUNTS, ctx)) return;

  return notFound(res);
}
