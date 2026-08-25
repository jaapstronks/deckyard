/**
 * Analytics storage facade — the sole public seam over this folder.
 *
 * `server/storage/analytics/` is a decomposed store: seven concern modules
 * (view sessions and their GDPR paths, slide views, dashboard queries, ad-hoc
 * aggregations, saved reports, the weekly digest) behind one barrel. Consumers
 * import `server/storage/analytics/index.js`; the concern files are internal
 * (`AGENTS.md` § _Module layout: one folder = one seam_).
 *
 * Everything here takes the analytics scope its own module documents — the
 * folder predates the scope-first convention on some paths (view sessions key
 * on a session token, the digest on a user/organization id), so read the
 * concern module for the exact contract.
 */

// View sessions — lifecycle of one viewer's visit.
export {
  VIEWER_TYPES,
  createViewSession,
  updateViewSession,
  endViewSession,
  getViewSessionByToken,
  getViewSessionsForPresentation,
  getActiveViewerCount,
  deleteOldViewSessions,
} from './view-sessions.js';

// GDPR paths over those sessions (right to access, right to erasure, IP retention).
export {
  exportUserAnalyticsData,
  deleteUserAnalyticsData,
  eraseAnalyticsDataForDevice,
  eraseAnalyticsDataForSession,
  anonymizeOldIpAddresses,
} from './view-sessions-gdpr.js';

// Per-slide view rows inside a session.
export {
  endAllSlideViewsForSession,
  transitionToSlide,
  deleteOldSlideViews,
} from './slide-views.js';

// Dashboard queries (one user's or one organization's overview).
export {
  getDashboardSummary,
  getDashboardTimeline,
  getTopPresentations,
  getSourceBreakdown,
  getPresentationsWithAnalytics,
} from './dashboard.js';

// Per-presentation aggregations.
export {
  getPresentationAnalyticsOverview,
  getDetailedSlideEngagement,
  getInteractionHeatmapData,
  getViewerJourneyData,
} from './aggregations.js';

// Saved, optionally share-tokened analytics reports.
export {
  createAnalyticsReport,
  getAnalyticsReport,
  getAnalyticsReportByToken,
  listAnalyticsReports,
  updateAnalyticsReport,
  deleteAnalyticsReport,
  regenerateShareToken,
} from './reports.js';

// Weekly digest data + its duration formatter.
export {
  getWeeklyAnalyticsForUser,
  getTeamWeeklyAnalytics,
  getUsersWithDigestDay,
  formatDuration,
} from './weekly-summary.js';
