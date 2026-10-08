/**
 * Analytics storage facade — the sole public seam over this folder.
 *
 * `server/storage/analytics/` is a decomposed store: eight concern modules
 * (view sessions, their GDPR paths and the sandbox seed, slide views, dashboard queries, ad-hoc
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
  countAnalyticsRows,
} from './view-sessions.js';

// The seeded view history of a sandbox guest's example copy (B353).
export { insertSeededViewSessions } from './seeded-sessions.js';

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
  ANALYTICS_LIST_SORTS,
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
  formatDuration,
} from './weekly-summary.js';
