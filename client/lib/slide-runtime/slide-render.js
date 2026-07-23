import { renderSlideHtml } from '../../../shared/slide-types.js';
import { SLIDE_TYPES as BUNDLED_SLIDE_TYPES } from '../../../shared/slide-types.js';
import { initFollowInviteSlides } from './follow-invite-runtime.js';
import { initKpiMetricsSlides } from './kpi-metrics-runtime.js';
import { initLeadCaptureSlides } from './lead-capture-runtime.js';
import { initCountdownSlides } from './countdown-runtime.js';
import { initTimelineSlides } from './timeline-runtime.js';
import { initContentSlideAutoFit } from './content-slide-autofit.js';
import { initTeamCardsAutoFit } from './team-cards-autofit.js';
import { applyThemeVarsToElement } from '../theme/theme.js';
import { api as defaultApi } from '../api.js';

/**
 * Trigger Prism.js syntax highlighting on code blocks within an element.
 */
function highlightCodeBlocks(rootEl) {
  if (!rootEl || typeof globalThis.Prism === 'undefined') return;
  const codeBlocks = rootEl.querySelectorAll('.md-code-block code');
  for (const block of codeBlocks) {
    try {
      globalThis.Prism.highlightElement(block);
    } catch {
      // Prism may fail on certain edge cases; ignore
    }
  }
}

/**
 * Render math formulas using KaTeX within an element.
 */
function renderMathFormulas(rootEl) {
  if (!rootEl || typeof globalThis.katex === 'undefined') return;

  // Render block math
  const mathBlocks = rootEl.querySelectorAll('.md-math-block[data-math]');
  for (const block of mathBlocks) {
    const latex = block.dataset.math;
    if (!latex) continue;
    try {
      globalThis.katex.render(latex, block, {
        displayMode: true,
        throwOnError: false,
        errorColor: '#c41a16',
      });
    } catch {
      // On error, KaTeX will display the raw LaTeX with error styling
    }
  }

  // Render inline math
  const mathInlines = rootEl.querySelectorAll('.md-math-inline[data-math]');
  for (const span of mathInlines) {
    const latex = span.dataset.math;
    if (!latex) continue;
    try {
      globalThis.katex.render(latex, span, {
        displayMode: false,
        throwOnError: false,
        errorColor: '#c41a16',
      });
    } catch {
      // On error, KaTeX will display the raw LaTeX with error styling
    }
  }
}

/**
 * Initialize code highlighting and math rendering on a slide element.
 */
function initCodeAndMath(rootEl) {
  if (!rootEl) return;
  highlightCodeBlocks(rootEl);
  renderMathFormulas(rootEl);
}

// Cache for server-rendered slide HTML
const serverRenderCache = new Map();

/**
 * Check if a slide type is bundled in the client (has a renderHtml function).
 */
function isBundledSlideType(type) {
  const def = BUNDLED_SLIDE_TYPES[type];
  return def && typeof def.renderHtml === 'function';
}

/**
 * Render a slide using server-side rendering (for custom slide types).
 * Returns a promise that resolves to the HTML string.
 */
async function serverRenderSlide({ slide, presentationId, mode, api }) {
  const cacheKey = `${presentationId}:${slide?.id}:${slide?.type}:${mode}:${JSON.stringify(slide?.content || {})}`;
  if (serverRenderCache.has(cacheKey)) {
    return serverRenderCache.get(cacheKey);
  }

  const apiFn = api || defaultApi;
  const resp = await apiFn(`/api/presentations/${presentationId}/render-slide`, {
    method: 'POST',
    body: JSON.stringify({ slide, mode }),
  });

  const html = resp?.html || '<div class="slide"><div class="slide-inner"><div class="heading">Render error</div></div></div>';

  // Cache for a short time (slides may be edited frequently)
  serverRenderCache.set(cacheKey, html);
  setTimeout(() => serverRenderCache.delete(cacheKey), 5000);

  return html;
}

let bunnyPlayerJsPromise = null;
const playerMap = new WeakMap();
function ensureBunnyPlayerJs() {
  if (globalThis.playerjs?.Player) return Promise.resolve();
  if (bunnyPlayerJsPromise) return bunnyPlayerJsPromise;
  bunnyPlayerJsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-bunny-playerjs="1"]'
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), {
        once: true,
      });
      existing.addEventListener(
        'error',
        () => reject(new Error('Failed to load Player.js')),
        { once: true }
      );
      return;
    }
    const s = document.createElement('script');
    s.src =
      'https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js';
    s.async = true;
    s.dataset.bunnyPlayerjs = '1';
    s.addEventListener('load', () => resolve(), {
      once: true,
    });
    s.addEventListener(
      'error',
      () => reject(new Error('Failed to load Player.js')),
      { once: true }
    );
    document.head.append(s);
  });
  return bunnyPlayerJsPromise;
}

function initVideoEmbeds(rootEl) {
  if (!rootEl) return;
  const iframes = rootEl.querySelectorAll(
    '.slide-video iframe[data-bunny-playerjs="1"]'
  );
  if (!iframes.length) return;
  ensureBunnyPlayerJs()
    .then(() => {
      for (const iframe of iframes) {
        if (iframe.dataset.playerjsReady === '1') continue;
        iframe.dataset.playerjsReady = '1';
        try {
          // eslint-disable-next-line no-new
          const p = new globalThis.playerjs.Player(iframe);
          playerMap.set(iframe, p);
        } catch {
          // ignore
        }
      }
    })
    .catch(() => {
      // ignore
    });
}

export function pauseVideoEmbeds(rootEl) {
  if (!rootEl) return;
  const iframes = rootEl.querySelectorAll('.slide-video iframe');
  for (const iframe of iframes) {
    // Best-effort: pause via Player.js when available (Bunny)
    const p = playerMap.get(iframe);
    try {
      p?.pause?.();
    } catch {
      // ignore
    }
    // Hard stop: reset to non-autoplay src so hidden slides can't keep playing
    const noAuto = iframe?.dataset?.videoSrcNoautoplay;
    if (noAuto && iframe.getAttribute('src') !== noAuto) {
      iframe.setAttribute('src', noAuto);
    }
  }
}

export function activateVideoEmbeds(rootEl) {
  if (!rootEl) return;
  // Ensure Bunny Player.js is available for the active slide if needed.
  initVideoEmbeds(rootEl);

  const iframes = rootEl.querySelectorAll('.slide-video iframe');
  for (const iframe of iframes) {
    const wantsAuto = iframe?.dataset?.videoAutoplay === '1';
    const src =
      (wantsAuto && iframe?.dataset?.videoSrcAutoplay) ||
      iframe?.dataset?.videoSrcNoautoplay ||
      iframe.getAttribute('src') ||
      '';
    if (src && iframe.getAttribute('src') !== src) {
      iframe.setAttribute('src', src);
    }
  }
}

/**
 * Call `__sbCleanup()` on any slide elements in (or under) `rootEl`.
 * This is critical before removing/replacing slide DOM, because slide runtimes can
 * attach side-effects (EventSource connections, window listeners, timers, observers, etc).
 */
export function cleanupSlideRuntimes(rootEl) {
  if (!rootEl) return;
  try {
    rootEl.__sbCleanup?.();
  } catch {
    // ignore
  }
  if (!rootEl.querySelectorAll) return;
  const all = rootEl.querySelectorAll('*');
  for (const el of all) {
    try {
      el.__sbCleanup?.();
    } catch {
      // ignore
    }
  }
}

/**
 * Replace the contents of `container` with a newly rendered slide element.
 * Always cleans up any previous slide runtimes first.
 */
export function mountSlideInto(container, slide, { mode, theme, presentationId } = {}) {
  if (!container) return null;
  cleanupSlideRuntimes(container);
  try {
    container.innerHTML = '';
  } catch {
    // ignore
  }
  if (!slide) return null;
  const el = renderSlideElement(slide, { mode, theme, presentationId });
  container.append(el);
  return el;
}

/**
 * Render a slide element synchronously.
 * Falls back to "Unknown slide type" for custom types not bundled in client.
 * Use renderSlideElementAsync for custom slide type support.
 */
export function renderSlideElement(
  slide,
  { mode, theme, followCodes, presentationId, api } = {}
) {
  let html;

  // Check if this is a custom slide type that needs server-side rendering
  if (slide?.type && !isBundledSlideType(slide.type)) {
    // For sync rendering, show a loading placeholder that will be replaced async
    html = `
      <div class="slide slide-loading" data-slide-type="${slide.type}" data-needs-server-render="1">
        <div class="slide-inner">
          <div class="heading">${slide.type}</div>
        </div>
      </div>
    `;
  } else {
    html = renderSlideHtml(slide, {
      mode,
      theme,
      followCodes,
      presentationId,
    }).trim();
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const el = wrap.firstElementChild;
  if (!el)
    throw new Error(
      'renderSlideHtml returned empty markup'
    );

  // Allow callers that frequently replace slide DOM (editor/notes preview)
  // to clean up any runtime side-effects (EventSource, window listeners, etc).
  const cleanups = [];
  el.__sbCleanup = () => {
    for (const fn of cleanups) {
      try {
        fn?.();
      } catch {
        // ignore
      }
    }
    cleanups.length = 0;
  };

  // Apply theme vars per slide so the application UI stays theme-independent.
  // (Vars are scoped to the slide element so multiple presentations can coexist.)
  if (theme) applyThemeVarsToElement(el, theme);
  // Thumbnails should never spin up video SDKs (and should never autoplay).
  if (mode !== 'thumb') initVideoEmbeds(el);
  // Initialize code highlighting and math rendering
  initCodeAndMath(el);
  if (mode === 'present' || mode === 'follow')
    cleanups.push(initKpiMetricsSlides(el));
  cleanups.push(initTimelineSlides(el));
  // Density='auto' content slides shrink to compact when their body overflows.
  // Skip in pure thumbnail mode: tiny render sizes make measurement noisy
  // and dynamic adjustment isn't visually useful at thumb scale.
  if (mode !== 'thumb') cleanups.push(initContentSlideAutoFit(el));
  if (mode !== 'thumb') cleanups.push(initTeamCardsAutoFit(el));
  if (slide?.type === 'follow-invite-slide') {
    // Follow-invite slides look blank without QR rendering. For thumbnails we render once
    // without resize/copy handlers to avoid leaking listeners across many thumbnails.
    if (mode === 'thumb')
      cleanups.push(
        initFollowInviteSlides(el, {
          enableResize: false,
          interactive: false,
        })
      );
    else cleanups.push(initFollowInviteSlides(el));
  } else if (mode !== 'thumb') {
    cleanups.push(initFollowInviteSlides(el));
  }
  // Initialize lead capture slides - interactive in all modes except pure thumbnails in editor
  // Share viewer uses 'thumb' mode for styling but needs interactivity
  if (slide?.type === 'lead-capture-slide') {
    cleanups.push(initLeadCaptureSlides(el, { interactive: true }));
  }

  // Countdown timer: presenter-driven in present/follow, static in thumbnails.
  if (slide?.type === 'countdown-slide') {
    cleanups.push(
      initCountdownSlides(el, {
        interactive: mode === 'present' || mode === 'follow',
      })
    );
  }

  // For custom slide types, trigger async server-side rendering
  if (el.dataset.needsServerRender === '1' && presentationId) {
    triggerServerRender(el, slide, { mode, theme, presentationId, api });
  }

  return el;
}

/**
 * Trigger server-side rendering for a custom slide type.
 * Replaces the placeholder element's content with server-rendered HTML.
 */
async function triggerServerRender(el, slide, { mode, theme, presentationId, api }) {
  try {
    const html = await serverRenderSlide({ slide, presentationId, mode, api });
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    const newContent = wrap.firstElementChild;

    if (newContent && el.parentNode) {
      // Preserve the wrapper but replace content
      el.innerHTML = newContent.innerHTML;
      // Copy classes from rendered slide
      el.className = newContent.className;
      // Remove the loading marker
      delete el.dataset.needsServerRender;

      // Apply theme vars
      if (theme) applyThemeVarsToElement(el, theme);
      // Initialize code highlighting and math rendering
      initCodeAndMath(el);
      // The sync mount already ran its decorators against the placeholder;
      // let listeners (the editor's inline-edit overlay) re-apply against the
      // real slide DOM now that it exists.
      el.dispatchEvent(new CustomEvent('slide-server-rendered', { bubbles: true }));
    }
  } catch (err) {
    console.error('[slide-render] Server render failed:', err);
    // Leave the placeholder in place
  }
}

/**
 * Async version of renderSlideElement that supports custom slide types.
 * Use this when you can await the result.
 */
export async function renderSlideElementAsync(
  slide,
  { mode, theme, followCodes, presentationId, api } = {}
) {
  let html;

  // Check if this is a custom slide type that needs server-side rendering
  if (slide?.type && !isBundledSlideType(slide.type) && presentationId) {
    html = await serverRenderSlide({ slide, presentationId, mode, api });
  } else {
    html = renderSlideHtml(slide, {
      mode,
      theme,
      followCodes,
      presentationId,
    }).trim();
  }

  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const el = wrap.firstElementChild;
  if (!el)
    throw new Error(
      'renderSlideHtml returned empty markup'
    );

  // Set up cleanups
  const cleanups = [];
  el.__sbCleanup = () => {
    for (const fn of cleanups) {
      try {
        fn?.();
      } catch {
        // ignore
      }
    }
    cleanups.length = 0;
  };

  if (theme) applyThemeVarsToElement(el, theme);
  if (mode !== 'thumb') initVideoEmbeds(el);
  // Initialize code highlighting and math rendering
  initCodeAndMath(el);
  if (mode === 'present' || mode === 'follow')
    cleanups.push(initKpiMetricsSlides(el));
  cleanups.push(initTimelineSlides(el));
  if (mode !== 'thumb') cleanups.push(initContentSlideAutoFit(el));
  if (mode !== 'thumb') cleanups.push(initTeamCardsAutoFit(el));
  if (slide?.type === 'follow-invite-slide') {
    if (mode === 'thumb')
      cleanups.push(
        initFollowInviteSlides(el, {
          enableResize: false,
          interactive: false,
        })
      );
    else cleanups.push(initFollowInviteSlides(el));
  } else if (mode !== 'thumb') {
    cleanups.push(initFollowInviteSlides(el));
  }
  // Initialize lead capture slides - interactive in all modes
  if (slide?.type === 'lead-capture-slide') {
    cleanups.push(initLeadCaptureSlides(el, { interactive: true }));
  }

  // Countdown timer: presenter-driven in present/follow, static in thumbnails.
  if (slide?.type === 'countdown-slide') {
    cleanups.push(
      initCountdownSlides(el, {
        interactive: mode === 'present' || mode === 'follow',
      })
    );
  }

  return el;
}

// Export for use in export functionality and other areas
export { initCodeAndMath, highlightCodeBlocks, renderMathFormulas };