import { storage } from './storage.js';

const STORAGE_KEY = 'ps-ui-mode'; // 'system' | 'light' | 'dark'

let currentPref = 'system';
let currentResolved = 'dark';
let media = null;
let onChange = new Set();

function normalizePref(raw) {
  const v = String(raw || '').trim().toLowerCase();
  if (v === 'light' || v === 'dark' || v === 'system') return v;
  return 'system';
}

function readPrefFromStorage() {
  return normalizePref(storage.get(STORAGE_KEY, null));
}

function writePrefToStorage(pref) {
  storage.set(STORAGE_KEY, pref);
}

function systemPrefersDark() {
  try {
    return !!window.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  } catch {
    return false;
  }
}

function resolve(pref) {
  const p = normalizePref(pref);
  if (p === 'light') return 'light';
  if (p === 'dark') return 'dark';
  return systemPrefersDark() ? 'dark' : 'light';
}

function setThemeColorMeta(resolved) {
  // Pick stable colors matching our token palettes (don’t depend on computed styles).
  const next = resolved === 'dark' ? '#0b1220' : '#f6f7fb';
  try {
    const meta =
      document.querySelector('meta[name="theme-color"]') ||
      (() => {
        const m = document.createElement('meta');
        m.setAttribute('name', 'theme-color');
        document.head.append(m);
        return m;
      })();
    meta.setAttribute('content', next);
  } catch {
    // ignore
  }
}

function applyResolved(resolved) {
  const r = resolved === 'light' ? 'light' : 'dark';
  currentResolved = r;
  try {
    document.documentElement.dataset.uiMode = r;
  } catch {
    // ignore
  }
  setThemeColorMeta(r);
}

function notify() {
  for (const cb of Array.from(onChange)) {
    try {
      cb({
        preference: currentPref,
        resolved: currentResolved,
      });
    } catch {
      // ignore
    }
  }
}

function onSystemChange() {
  if (currentPref !== 'system') return;
  applyResolved(resolve(currentPref));
  notify();
}

function ensureMediaListener() {
  if (media) return;
  try {
    media = window.matchMedia?.('(prefers-color-scheme: dark)') || null;
  } catch {
    media = null;
  }
  if (!media) return;
  try {
    // Safari: addListener fallback.
    if (typeof media.addEventListener === 'function')
      media.addEventListener('change', onSystemChange);
    else if (typeof media.addListener === 'function')
      media.addListener(onSystemChange);
  } catch {
    // ignore
  }
}

export function getUiModePreference() {
  return currentPref;
}

export function getResolvedUiMode() {
  return currentResolved;
}

export function setUiModePreference(nextPref) {
  const next = normalizePref(nextPref);
  currentPref = next;
  writePrefToStorage(next);
  ensureMediaListener();
  applyResolved(resolve(next));
  notify();
}

export function subscribeUiMode(cb) {
  if (typeof cb !== 'function') return () => {};
  onChange.add(cb);
  // Immediate sync.
  try {
    cb({ preference: currentPref, resolved: currentResolved });
  } catch {
    // ignore
  }
  return () => {
    onChange.delete(cb);
  };
}

export function initUiMode() {
  currentPref = readPrefFromStorage();
  ensureMediaListener();
  applyResolved(resolve(currentPref));
  notify();
}
