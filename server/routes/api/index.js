import { notFound, unauthorized, forbidden } from '../../utils/http.js';
import { isCsrfSafe } from '../../utils/csrf.js';
import { authEnabled, getUserFromRequestAsync } from '../../auth/auth.js';
import { getFeatureFlags } from '../../config/feature-flags.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { ensureSandboxUser } from '../../auth/sandbox.js';
import { resolveDesignerCapability } from '../../utils/designer.js';
import { canEditCustomHtml } from '../../utils/route-middleware.js';

// Public API v1 (API key authentication)
import { handlePublicApiV1 } from '../public-api/v1/index.js';

import { handleAuth } from './auth.js';
import { handlePasswordReset } from './password-reset.js';
import { handleMagicLink } from './magic-link.js';
import { handleSso } from './sso.js';
import { handleAdminUsers } from './admin-users.js';
import { handleAdminAiLogs } from './admin-ai-logs.js';
import { handleEmailTemplates } from './email-templates.js';
import { handleFollowPublic } from './follow.js';
import { handleFollowCodes } from './follow-codes.js';
import { handlePresentSessions } from './present-sessions.js';
import { handleAssets } from './assets.js';
import { handleSlideTypes } from './slide-types.js';
import { handleThemes } from './themes.js';
import { handleCustomSlideTypes } from './custom-slide-types.js';
import { handleFontFamilies } from './font-families.js';
import { handleImageLibrary } from './image-library.js';
import { handlePresentations } from './presentations.js';
import { handleHome } from './home.js';
import { handleAi } from './ai.js';
import { handleNotion } from './notion.js';
import { handleUploads } from './uploads.js';
import { handleExports } from './export.js';
import { handleBulkExport } from './bulk-export.js';
import { handlePublish } from './publish.js';
import { handleShareLinks, handleSharePublic } from './share-links.js';
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
import { handleAnalytics, handleAnalyticsReportPublic } from './analytics.js';
import { handleLeadsPublic, handleLeads } from './leads.js';
import { handleTags } from './tags.js';
import { handleStockMedia } from './stock-media.js';
import { handleApiKeys } from './api-keys.js';
import { handleJobs } from './jobs.js';
import { handleOrganizations } from './organizations.js';
import { handleOrganizationMembers } from './organization-members.js';
import { handleDataSources } from './data-sources.js';

export async function handleApi({ repoRoot, req, res, url }) {
  // CSRF defense: reject cookie-authenticated, cross-origin state-changing
  // requests. No-ops for safe methods, non-cookie auth (API key / MCP), and
  // same-origin requests. See docs/plans/security-hardening.md item 5c.
  if (!isCsrfSafe(req)) {
    return forbidden(res, 'Cross-site request blocked (CSRF)');
  }

  // Public API v1 routes (API key authentication, separate from session-based auth)
  if (url.pathname.startsWith('/api/v1')) {
    if (await handlePublicApiV1({ repoRoot, req, res, url })) return;
  }

  // Auth routes are special: some of them are allowed without a prior session.
  if (await handleAuth({ repoRoot, req, res, url })) return;

  // Password reset routes (public, no auth required)
  if (await handlePasswordReset({ repoRoot, req, res, url })) return;

  // Magic link routes (public, no auth required)
  if (await handleMagicLink({ repoRoot, req, res, url })) return;

  // OIDC single sign-on routes (public: login redirect + IdP callback)
  if (await handleSso({ repoRoot, req, res, url })) return;

  // Public endpoints (must be accessible without auth; used by audience devices).
  if (await handleFollowPublic({ repoRoot, req, res, url })) return;
  // Note: Follow code resolution (GET) is handled here as public
  // Follow code creation (POST) requires auth and is handled below
  if (url.pathname.match(/^\/api\/follow-codes\/[A-Z]{4,6}$/i) && req.method === 'GET') {
    if (await handleFollowCodes({ repoRoot, req, res, url, authedUser: null })) return;
  }
  if (await handleSharePublic({ repoRoot, req, res, url })) return;
  if (await handleAnalyticsTrack({ repoRoot, req, res, url })) return;
  if (await handleAnalyticsReportPublic({ repoRoot, req, res, url })) return;
  if (await handleLeadsPublic({ repoRoot, req, res, url })) return;

  // Sandbox mode: auto-provision a per-visitor guest session (cookie) and treat as authenticated.
  // This keeps per-visitor presentation isolation without a login screen.
  // Use async version to properly validate database users who migrated from ENV auth.
  const authCtx = { repoRoot, req };
  let authedUser = sandboxEnabled()
    ? ensureSandboxUser(req, res)
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

  const ctx = { repoRoot, req, res, url, authedUser };
  const flags = getFeatureFlags();

  if (await handlePresentSessions(ctx)) return;
  if (await handleAssets(ctx)) return;
  if (await handleSlideTypes(ctx)) return;
  if (await handleThemes(ctx)) return;
  if (await handleCustomSlideTypes(ctx)) return;
  if (await handleFontFamilies(ctx)) return;
  if (await handleImageLibrary(ctx)) return;
  if (await handleMedia(ctx)) return;
  if (await handleHome(ctx)) return;
  if (await handlePresentations(ctx)) return;
  if (await handleNotion(ctx)) return;
  if (!flags.disableAi && (await handleAi(ctx))) return;
  if (!flags.disableAi && (await handleConvert(ctx))) return;
  if (!flags.disableUploads && (await handleUploads(ctx))) return;
  if (await handleExports(ctx)) return;
  if (await handleBulkExport(ctx)) return;
  if (await handlePublish(ctx)) return;
  if (await handleShareLinks(ctx)) return;
  if (await handleCollaborators(ctx)) return;
  if (await handleUsers(ctx)) return;
  if (await handleProfile(ctx)) return;
  if (await handleNotifications(ctx)) return;
  if (await handleQuestions(ctx)) return;
  if (await handleSettings(ctx)) return;
  if (await handleApiKeys(ctx)) return;
  if (await handleSlideLibrary(ctx)) return;
  if (await handleSlideCollections(ctx)) return;
  if (flags.enableLiveData && (await handleDataSources(ctx))) return;
  if (await handleActivity(ctx)) return;
  if (await handleAnalytics(ctx)) return;
  if (await handleLeads(ctx)) return;
  if (await handleTags(ctx)) return;
  if (await handleStockMedia(ctx)) return;
  if (await handleJobs(ctx)) return;
  // Organization management (multi-workspace mode)
  if (await handleOrganizations(ctx)) return;
  if (await handleOrganizationMembers(ctx)) return;
  // Follow code creation (POST) requires auth
  if (await handleFollowCodes(ctx)) return;
  if (await handleAdminUsers({ repoRoot, req, res, url })) return;
  if (await handleAdminAiLogs({ repoRoot, req, res, url })) return;
  if (await handleEmailTemplates({ repoRoot, req, res, url })) return;

  return notFound(res);
}
