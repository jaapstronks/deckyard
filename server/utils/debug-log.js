function truthyEnv(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function isDebugLogEnabled() {
  return truthyEnv(process.env.DEBUG_LOG);
}

export function isClientDebugLogEnabled() {
  // Keep this separate so you can enable server debug logs without spamming the browser console.
  return truthyEnv(process.env.DEBUG_LOG_CLIENT) || isDebugLogEnabled();
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

export function debugError(...args) {
  if (!isDebugLogEnabled()) return;
  try {
    // eslint-disable-next-line no-console
    console.error(...args);
  } catch {
    // ignore
  }
}
