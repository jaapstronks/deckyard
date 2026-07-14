function truthyEnv(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

export function isDebugLogEnabled() {
  try {
    // Injected by server when DEBUG_LOG_CLIENT is enabled.
    if (globalThis.__DEBUG_LOG__ === true) return true;
    if (truthyEnv(globalThis.__DEBUG_LOG__)) return true;
  } catch {
    // ignore
  }

  // Dev convenience toggles (no server changes required):
  // - ?debugLog=1
  // - localStorage.DEBUG_LOG=1
  try {
    const qs = new URLSearchParams(globalThis.location?.search || '');
    if (truthyEnv(qs.get('debugLog'))) return true;
  } catch {
    // ignore
  }
  try {
    if (truthyEnv(globalThis.localStorage?.getItem?.('DEBUG_LOG'))) return true;
    if (truthyEnv(globalThis.localStorage?.getItem?.('debugLog'))) return true;
  } catch {
    // ignore
  }

  return false;
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
