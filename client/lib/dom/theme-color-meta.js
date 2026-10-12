import { h } from './index.js';
import { debugLog } from '../state/debug.js';

/** Keep the browser chrome in sync with the resolved UI mode. */
export function setThemeColorMeta(resolved) {
  const next = resolved === 'dark' ? '#0b1220' : '#f6f7fb';
  try {
    const meta =
      document.querySelector('meta[name="theme-color"]') ||
      document.head.appendChild(h('meta', { name: 'theme-color' }));
    meta.setAttribute('content', next);
  } catch (error) {
    debugLog('Unable to set theme-color meta', error);
  }
}
