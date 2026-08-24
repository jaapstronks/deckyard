/**
 * Lazy loader for the self-hosted Prism.js and KaTeX vendor files.
 *
 * The app shell loads neither library up front: a page without code or math
 * makes zero requests for them (mirroring the standalone export, which emits
 * the tags conditionally via server/utils/prism-katex.js). The first slide
 * that needs one pulls it from /client/vendor/, plus — for Prism — exactly
 * the language components the slide uses, resolved through the same shared
 * map the export uses.
 */

import {
  PRISM_BASE_COMPONENTS,
  resolvePrismComponents,
} from '../../../shared/prism-languages.js';
import { ensureScript, ensureStylesheet } from '../dom/head-assets.js';

const PRISM_BASE = '/client/vendor/prism';
const KATEX_BASE = '/client/vendor/katex';

/** One head-asset id per vendor URL, so the dedupe key is the URL. */
const assetId = (url) => `pk-${url.replace(/[^a-z0-9]+/gi, '-')}`;

function loadScript(url) {
  // Deliberately not marked async: callers await each script before injecting
  // the next, because Prism components are plain scripts that need their
  // dependencies (and the core) evaluated first.
  return ensureScript({ id: assetId(url), src: url });
}

function loadStylesheet(url) {
  return ensureStylesheet({ id: assetId(url), href: url });
}

let prismCorePromise = null;

function ensurePrismCore() {
  if (!prismCorePromise) {
    // Without this flag the dynamically injected core would run highlightAll()
    // over the whole document on load; highlighting stays driven by
    // slide-render.js per slide element.
    globalThis.Prism = globalThis.Prism || {};
    globalThis.Prism.manual = true;
    prismCorePromise = (async () => {
      await loadStylesheet(`${PRISM_BASE}/themes/prism-tomorrow.min.css`);
      await loadScript(`${PRISM_BASE}/components/prism-core.min.js`);
      for (const name of PRISM_BASE_COMPONENTS) {
        await loadScript(`${PRISM_BASE}/components/prism-${name}.min.js`);
      }
    })();
  }
  return prismCorePromise;
}

/**
 * Load Prism plus the components for the given deck languages. Resolves when
 * `globalThis.Prism` can highlight them; component files it cannot resolve —
 * or that fail to load — degrade to unhighlighted code, never to a rejection.
 *
 * @param {string[]} languages Language names as written in the deck markup.
 */
export async function ensurePrism(languages) {
  await ensurePrismCore();
  for (const name of resolvePrismComponents(languages)) {
    if (PRISM_BASE_COMPONENTS.includes(name)) continue;
    try {
      await loadScript(`${PRISM_BASE}/components/prism-${name}.min.js`);
    } catch {
      // A missing pack means that language renders unhighlighted, same as an
      // unknown language; don't let it block the others.
    }
  }
}

let katexPromise = null;

/**
 * Load KaTeX (js + css). Resolves when `globalThis.katex` is available.
 */
export function ensureKatex() {
  if (!katexPromise) {
    katexPromise = Promise.all([
      loadStylesheet(`${KATEX_BASE}/katex.min.css`),
      loadScript(`${KATEX_BASE}/katex.min.js`),
    ]).then(() => {});
  }
  return katexPromise;
}
