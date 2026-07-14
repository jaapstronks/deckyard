/**
 * Analytics module - re-exports all analytics utilities.
 */

export { analyticsHeadHtml } from './head.js';
export { generateTrackingScriptHtml } from './tracking-script.js';
export {
  ANALYTICS_CONFIG,
  TRACKING_RATE_LIMITS,
  AUTH_RATE_LIMITS,
  DEVICE_ID_REGEX,
  SESSION_TOKEN_REGEX,
  isValidDeviceId,
  isValidSessionToken,
  isValidSlideIndex,
  sanitizeUserAgent,
  sendRateLimitResponse,
  sendErrorResponse,
  sendSuccessResponse,
  SECURITY_EVENTS,
  logSecurityEvent,
  SOURCE_TYPES,
  isValidSourceType,
  applyDateFilters,
} from './helpers.js';