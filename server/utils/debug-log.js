import { envBool } from '../config/utils.js';

export function isDebugLogEnabled() {
  return envBool('DEBUG_LOG');
}

export function isClientDebugLogEnabled() {
  // Keep this separate so you can enable server debug logs without spamming the browser console.
  return envBool('DEBUG_LOG_CLIENT') || isDebugLogEnabled();
}

export function debugLog(...args) {
  if (!isDebugLogEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.log(...args);
  } catch {
    // ignore
  }
}
