/**
 * The script chain: one assembler for the JavaScript a rendered deck carries.
 *
 * The CSS chain (server/utils/css-chain.js) and the head chain
 * (server/utils/head-chain.js) took the stylesheet and the document opening.
 * This is the third: the `<script>` block. Before it there were six independent
 * assemblers and roughly eight hundred lines of inline JS, with five functions
 * duplicated between `server/export/html.js` and
 * `server/utils/embed-html/template.js` — `ensureBunnyPlayerJs`,
 * `pauseVideoEmbeds`, `activateVideoEmbeds` and `updateStageScale` byte for
 * byte, `initVideoEmbeds` off by a single `catch (e) {}` / `catch {}`.
 *
 * And one spelling problem on top of the duplication: the Prism/KaTeX
 * initialiser was emitted three different ways — as a ready-made tag, as the
 * same tag hand-rewritten character for character around the bare body, and as
 * a bare body spliced into somebody else's IIFE. Two accepting shapes for one
 * meaning, which is exactly what `buildCssChain` removed from the CSS side.
 *
 * What that drift cost, in the one place it was visible: a code block or a
 * formula rendered **unhighlighted** in an embed and in both MCP previews,
 * because those paths emitted no Prism/KaTeX at all — while the same deck
 * highlighted fine in the editor, in `/p/`, in the download, in print and in
 * the PDF. Running every path through one assembler closes that by
 * construction.
 *
 * **Shape.** `buildScriptChain()` takes what a path differs in — which shared
 * runtime it needs, its own body, whether it is a module — and emits the
 * `<script>` element. The shared runtimes live here as template strings, the
 * same way the per-path document CSS lives in the modules that use it: this is
 * the css-chain model, which reads core stylesheets from the modules that own
 * them and goes to disk only for the fork seam.
 *
 * **No script seam.** `custom/scripts/*.js` as a fourth fork lever is an open
 * question (A7.32 brief, step 3), not something this module quietly answers.
 * If it is ever taken, this is where it lands, and the seam goes last.
 */

import { buildPrismKatexInitScript } from './prism-katex.js';

/** Marks an assembled runtime block. Also the handle the registry test uses. */
export const SLIDE_RUNTIME_BANNER =
  '// slide runtime — assembled by server/utils/script-chain.js';

/**
 * Shared runtimes, by name. A closed set: a path picks one, and a path whose
 * needs are not in the set gets a new named entry rather than a private copy.
 *
 * - `stage` — a document that shows one live slide at a time on the fixed
 *   1600x900 stage: Bunny video embeds plus stage scaling. The standalone
 *   export and the embed are the two, and they were the two that had a copy
 *   each.
 * - `none` — a document that lays its slides out itself (print, PDF, the PNG
 *   sheet, the MCP previews). It still gets the Prism/KaTeX initialiser.
 */
export const SCRIPT_RUNTIMES = Object.freeze(['stage', 'none']);

/**
 * Bunny Stream Player.js support for video slides, plus the 1600x900 stage
 * scaler. Declarations only — nothing here runs until the path calls
 * `attachStageScale()`, so a path keeps control of *when* the first measurement
 * happens (the embed hides its control bar first, which changes the height it
 * would measure).
 */
const STAGE_RUNTIME = `${SLIDE_RUNTIME_BANNER}
const BASE_W = 1600;
const BASE_H = 900;
const stageWrapEl = document.getElementById('stageWrap');
const stageEl = document.getElementById('stage');

// Bunny Stream Player.js support (for video-slide embeds). This lazy loader is
// the only thing that fetches player.js: a deck without a Bunny video never
// touches assets.mediadelivery.net.
let bunnyPlayerJsPromise = null;
function ensureBunnyPlayerJs() {
  if (window.playerjs && window.playerjs.Player) return Promise.resolve();
  if (bunnyPlayerJsPromise) return bunnyPlayerJsPromise;
  bunnyPlayerJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-bunny-playerjs="1"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Failed to load Player.js')), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js';
    s.async = true;
    s.dataset.bunnyPlayerjs = '1';
    s.addEventListener('load', () => resolve(), { once: true });
    s.addEventListener('error', () => reject(new Error('Failed to load Player.js')), { once: true });
    document.head.appendChild(s);
  });
  return bunnyPlayerJsPromise;
}

function initVideoEmbeds(rootEl) {
  if (!rootEl) return;
  const iframes = rootEl.querySelectorAll('.slide-video iframe[data-bunny-playerjs="1"]');
  if (!iframes.length) return;
  ensureBunnyPlayerJs().then(() => {
    for (const iframe of iframes) {
      if (iframe.dataset.playerjsReady === '1') continue;
      iframe.dataset.playerjsReady = '1';
      try { new window.playerjs.Player(iframe); } catch {}
    }
  }).catch(() => {});
}

function pauseVideoEmbeds(rootEl) {
  if (!rootEl) return;
  const iframes = rootEl.querySelectorAll('.slide-video iframe');
  for (const iframe of iframes) {
    const noAuto = iframe && iframe.dataset ? iframe.dataset.videoSrcNoautoplay : '';
    if (noAuto && iframe.getAttribute('src') !== noAuto) {
      iframe.setAttribute('src', noAuto);
    }
  }
}

function activateVideoEmbeds(rootEl) {
  if (!rootEl) return;
  initVideoEmbeds(rootEl);
  const iframes = rootEl.querySelectorAll('.slide-video iframe');
  for (const iframe of iframes) {
    const wantsAuto = iframe && iframe.dataset ? iframe.dataset.videoAutoplay === '1' : false;
    const src = (wantsAuto && iframe.dataset.videoSrcAutoplay) || iframe.dataset.videoSrcNoautoplay || iframe.getAttribute('src') || '';
    if (src && iframe.getAttribute('src') !== src) iframe.setAttribute('src', src);
  }
}

// Scale the fixed 1600x900 stage to fit the space its wrapper occupies.
function updateStageScale() {
  if (!stageWrapEl || !stageEl) return;
  const w = stageWrapEl.clientWidth || 1;
  const h = stageWrapEl.clientHeight || 1;
  const scale = Math.max(0.05, Math.min(w / BASE_W, h / BASE_H));
  const sw = BASE_W * scale;
  const sh = BASE_H * scale;
  const left = Math.max(0, (w - sw) / 2);
  const top = Math.max(0, (h - sh) / 2);
  stageEl.style.left = left + 'px';
  stageEl.style.top = top + 'px';
  stageEl.style.transform = 'scale(' + scale + ')';
}

// Measure once, then keep measuring. ResizeObserver is the accurate signal —
// the wrapper resizes without the window doing so — with a window listener as
// the fallback for browsers that lack it.
function attachStageScale() {
  updateStageScale();
  try {
    const ro = new ResizeObserver(() => updateStageScale());
    if (stageWrapEl) ro.observe(stageWrapEl);
  } catch {
    window.addEventListener('resize', updateStageScale, { passive: true });
  }
}`;

/**
 * Assemble the `<script>` a render path carries.
 *
 * Order is fixed and is the whole contract: shared runtime first (so the body
 * can call into it), then the path's own body, then the Prism/KaTeX
 * initialiser last — it sweeps the finished DOM, so it must not run before a
 * body that rewrites one.
 *
 * @param {Object} [options]
 * @param {'stage'|'none'} [options.runtime='none'] - Which shared runtime to
 *   include. See {@link SCRIPT_RUNTIMES}.
 * @param {{prism: boolean, katex: boolean}|null} [options.needs] - What the
 *   rendered slides actually contain, from `detectPrismKatexNeeds()`. Omitted
 *   means "assume both". `{prism: false, katex: false}` emits no initialiser,
 *   which is the point of detecting: a deck with neither runs nothing.
 * @param {string} [options.body=''] - The path's own runtime.
 * @param {boolean} [options.module=false] - Emit `<script type="module">`
 *   instead of wrapping the block in an IIFE. Both give the block a scope of
 *   its own; a module also gets one for its top-level `await`.
 * @returns {string} A complete `<script>` element, or `''` when there is
 *   nothing to run.
 */
export function buildScriptChain({
  runtime = 'none',
  needs = undefined,
  body = '',
  module = false,
} = {}) {
  if (!SCRIPT_RUNTIMES.includes(runtime)) {
    throw new Error(
      `unknown script runtime "${runtime}" — one of ${SCRIPT_RUNTIMES.join('/')}`,
    );
  }

  const parts = [];
  if (runtime === 'stage') parts.push(STAGE_RUNTIME);
  if (String(body || '').trim()) parts.push(dedent(String(body)));

  const init = buildPrismKatexInitScript(needs ?? {});
  if (init) parts.push(`${SLIDE_RUNTIME_BANNER}\n${dedent(init)}`);

  if (!parts.length) return '';

  const source = parts.join('\n\n');
  if (module) {
    return `<script type="module">\n${indent(source, 6)}\n    </script>`;
  }
  return `<script>\n      (function () {\n${indent(source, 8)}\n      })();\n    </script>`;
}

/**
 * Strip a block's common leading indentation.
 *
 * @param {string} text
 * @returns {string}
 */
function dedent(text) {
  const lines = text.split('\n');
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  const widths = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)[0].length);
  const strip = widths.length ? Math.min(...widths) : 0;
  return lines.map((line) => line.slice(strip)).join('\n');
}

/**
 * Indent every non-blank line by `width` spaces.
 *
 * @param {string} text
 * @param {number} width
 * @returns {string}
 */
function indent(text, width) {
  const pad = ' '.repeat(width);
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${pad}${line}` : ''))
    .join('\n');
}
