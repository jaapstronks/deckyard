/**
 * Lazy CDN loader for hls.js.
 * Follows the same promise-cached pattern as ensureBunnyPlayerJs() in slide-render.js.
 */

let hlsPromise = null;

export function ensureHlsJs() {
  if (globalThis.Hls) return Promise.resolve();
  if (hlsPromise) return hlsPromise;
  hlsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-hls-loader="1"]');
    if (existing) {
      // Script tag exists but may have already finished loading before we attached listeners.
      if (globalThis.Hls) { resolve(); return; }
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load hls.js')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.async = true;
    s.dataset.hlsLoader = '1';
    s.addEventListener('load', () => resolve(), { once: true });
    s.addEventListener('error', () => reject(new Error('Failed to load hls.js')), { once: true });
    document.head.append(s);
  });
  return hlsPromise;
}
