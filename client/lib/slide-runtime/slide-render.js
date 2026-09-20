import { renderSlideHtml } from '../../../shared/slide-types.js';
import { SLIDE_TYPES as BUNDLED_SLIDE_TYPES } from '../../../shared/slide-types.js';
import { getRemovedSlideType } from '../../../shared/slide-types/removed.js';
import { initFollowInviteSlides } from './follow-invite-runtime.js';
import { initKpiMetricsSlides } from './kpi-metrics-runtime.js';
import { initCountdownSlides } from './countdown-runtime.js';
import { initTeamCardsJustify } from './team-cards-justify.js';
import { applyThemeVarsToElement } from '../theme/theme.js';
import { api as defaultApi } from '../api.js';
import { h } from '../dom.js';
import { ensurePrism, ensureKatex } from './prism-katex-loader.js';
import { ensureScript } from '../dom/head-assets.js';

/**
 * "This surface has no deck, so there is no language to pass."
 *
 * The value is `null` — the same thing `resolveDeckLang()` answers for a deck
 * that says nothing — but the name is the point. Leaving `lang` out of a mount
 * call is not neutral: the slide silently falls back to
 * `DEFAULT_SLIDE_COPY_LANG` (`docs/reference/slide-copy-language.md`), which is
 * right for a sample slide and wrong for a deck, and the two are
 * indistinguishable at the call site. Sample and preview surfaces — the theme
 * picker, the theme-editor preview, sandbox examples, curation thumbnails, the
 * slide-type picker's own specimens — say so with this constant, and
 * `tests/slide-copy-language.test.js` fails any call site that says nothing at
 * all.
 *
 * @type {null}
 */
export const NO_DECK_LANG = null;

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
 *
 * Prism and KaTeX are self-hosted and lazy: nothing loads until a slide
 * actually contains code or math (the export head makes the same call
 * server-side via detectPrismKatexNeeds). Highlighting therefore lands a tick
 * after first paint on the first such slide; once loaded it is synchronous.
 */
function initCodeAndMath(rootEl) {
  if (!rootEl || !rootEl.querySelectorAll) return;

  const codeBlocks = rootEl.querySelectorAll('.md-code-block code');
  if (codeBlocks.length) {
    const languages = [];
    for (const block of codeBlocks) {
      for (const cls of block.classList) {
        if (!cls.startsWith('language-')) continue;
        const lang = cls.slice('language-'.length).toLowerCase();
        if (!languages.includes(lang)) languages.push(lang);
      }
    }
    ensurePrism(languages)
      .then(() => highlightCodeBlocks(rootEl))
      .catch(() => {
        // Prism failed to load; code blocks stay unhighlighted.
      });
  }

  if (
    rootEl.querySelector(
      '.md-math-block[data-math], .md-math-inline[data-math]',
    )
  ) {
    ensureKatex()
      .then(() => renderMathFormulas(rootEl))
      .catch(() => {
        // KaTeX failed to load; math stays as raw LaTeX.
      });
  }
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
 * Whether a fork has overridden this core name server-side (`override: true`).
 *
 * The client bundles core's renderer under such a name (`custom/slide-types/` is
 * server-only and off the static allowlist), so `isBundledSlideType()` would say
 * "bundled" and the client would draw core's markup for a slide the server
 * renders as the fork's. The server names these overrides in a synchronous head
 * global (`window.__DECK_SERVER_RENDERED_TYPES__`, injected by
 * server/routes/static/app-shell.js) that is present before any slide renders —
 * no fetch, no per-view wiring. Absent in the OSS build, so this is a no-op
 * there. See docs/reference/slide-type-directory.md ("The inline descriptor").
 */
function isServerOverriddenType(type) {
  if (typeof window === 'undefined') return false;
  const names = window.__DECK_SERVER_RENDERED_TYPES__;
  return Array.isArray(names) && names.includes(type);
}

/**
 * Whether a type should be fetched from the server instead of rendered here.
 *
 * A type that is not bundled is normally a fork's custom type under a NEW name,
 * which only the server can render. A fork override of a CORE name is bundled
 * under that name yet renders the fork's markup only server-side, so it needs
 * the same treatment even though it is "bundled" — hence the override check. A
 * type on the tombstone record is different: it is gone everywhere, so the
 * round-trip can only come back with the same archived-slide placeholder the
 * client can render itself. Asking anyway would only fetch that placeholder
 * back, or leave the bare "loading" box when the request fails.
 */
function needsServerRender(type) {
  if (!type || getRemovedSlideType(type)) return false;
  return isServerOverriddenType(type) || !isBundledSlideType(type);
}

/**
 * The id the server resolves a loaded theme by. A database theme reports its
 * slug as `id` and carries the UUID in `_customThemeId` (see `isThemeForId` in
 * `client/lib/theme/theme.js`); the server loads it by the UUID.
 *
 * @param {object|null|undefined} theme
 * @returns {string|null}
 */
function serverThemeId(theme) {
  return theme?._customThemeId || theme?.id || null;
}

/**
 * "This surface renders against its theme and language, not a deck."
 *
 * The `renderVia` of the settings curation, the slide-type picker, the slide
 * library and the other sample surfaces: a server-rendered type goes to
 * `POST /api/render-slide` with the `theme` and `lang` the mount was given
 * (B278). Those two stay mount options rather than being repeated here, so a
 * surface cannot render against one theme and ask the server for another.
 */
export const RENDER_VIA_THEME = Object.freeze({ kind: 'theme' });

/**
 * Where a server-rendered type is rendered, as the surface declares it (D114).
 *
 * A surface names the capability it holds, and each kind has exactly one route:
 *
 * - `{ kind: 'deck', id }`: a signed-in session with the deck; the deck route
 *   authorizes the render and names theme and language.
 * - {@link RENDER_VIA_THEME}: no deck; the deckless route, against the mount's
 *   theme and language.
 * - `{ kind: 'share', token, grant }`: an anonymous share-link viewer; the
 *   grant comes from `verify`.
 * - `{ kind: 'follow', id }`: the follow-along audience of a live deck; the
 *   mount's `lang` names the version it was served.
 * - `{ kind: 'session', id }`: the speaker-notes companion of a live session.
 *
 * The anonymous kinds send the slide's id, not the slide: their capability
 * covers the slides of one deck, and the server renders its own copy.
 *
 * There is no inference from what else the mount was given — a `presentationId`
 * says which deck a client renderer links to, not what the viewer is allowed to
 * call — and no fallback: a missing or unknown kind throws, and the render
 * stays a placeholder with that error in the console.
 *
 * @param {{ slide: object, renderVia: object, mode?: string, theme?: object, lang?: string|null }} p
 * @returns {{ path: string, body: object, key: string }}
 */
function serverRenderRequest({ slide, renderVia, mode, theme, lang }) {
  const via = renderVia || {};
  const segment = (value, name) => {
    if (typeof value !== 'string' || !value) {
      throw new TypeError(`renderVia ${via.kind}: ${name} is required`);
    }
    return encodeURIComponent(value);
  };
  switch (via.kind) {
    case 'deck':
      return {
        path: `/api/presentations/${segment(via.id, 'id')}/render-slide`,
        body: { slide, mode },
        key: `deck:${via.id}`,
      };
    case 'theme': {
      const themeId = serverThemeId(theme);
      return {
        path: '/api/render-slide',
        body: { slide, mode, theme: themeId, lang: lang ?? null },
        key: `theme:${themeId}:${lang ?? ''}`,
      };
    }
    case 'share':
      return {
        path: `/api/share/${segment(via.token, 'token')}/render-slide`,
        body: { slideId: slide?.id, mode, grant: via.grant },
        key: `share:${via.token}`,
      };
    case 'follow':
      return {
        path: `/api/follow/${segment(via.id, 'id')}/render-slide`,
        body: { slideId: slide?.id, mode, lang: lang ?? null },
        key: `follow:${via.id}:${lang ?? ''}`,
      };
    case 'session':
      return {
        path: `/api/live-sessions/${segment(via.id, 'id')}/render-slide`,
        body: { slideId: slide?.id, mode },
        key: `session:${via.id}`,
      };
    default:
      throw new TypeError(
        `renderVia: unknown kind ${JSON.stringify(via.kind)} — declare deck, theme, share, follow or session`,
      );
  }
}

/**
 * Render a slide using server-side rendering (for custom slide types).
 * Returns a promise that resolves to the HTML string.
 */
async function serverRenderSlide({ slide, renderVia, mode, theme, lang, api }) {
  const request = serverRenderRequest({ slide, renderVia, mode, theme, lang });
  const cacheKey = `${request.key}:${slide?.id}:${slide?.type}:${mode}:${JSON.stringify(slide?.content || {})}`;
  if (serverRenderCache.has(cacheKey)) {
    return serverRenderCache.get(cacheKey);
  }

  const apiFn = api || defaultApi;
  const resp = await apiFn(request.path, {
    method: 'POST',
    body: JSON.stringify(request.body),
  });

  const html =
    resp?.html ||
    '<div class="slide"><div class="slide-inner"><div class="heading">Render error</div></div></div>';

  // Cache for a short time (slides may be edited frequently)
  serverRenderCache.set(cacheKey, html);
  setTimeout(() => serverRenderCache.delete(cacheKey), 5000);

  return html;
}

const playerMap = new WeakMap();
function ensureBunnyPlayerJs() {
  // A tag from an earlier page state may already have finished loading, in
  // which case there is no load event left to wait for — the global is the
  // only reliable "already there" signal.
  if (globalThis.playerjs?.Player) return Promise.resolve();
  return ensureScript({
    id: 'bunny-playerjs',
    src: 'https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js',
    async: true,
  });
}

function initVideoEmbeds(rootEl) {
  if (!rootEl) return;
  const iframes = rootEl.querySelectorAll(
    '.slide-video iframe[data-bunny-playerjs="1"]',
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
export function mountSlideInto(
  container,
  slide,
  { mode, theme, presentationId, renderVia, lang } = {},
) {
  if (!container) return null;
  cleanupSlideRuntimes(container);
  try {
    container.innerHTML = '';
  } catch {
    // ignore
  }
  if (!slide) return null;
  const el = renderSlideElement(slide, {
    mode,
    theme,
    presentationId,
    renderVia,
    lang,
  });
  container.append(el);
  return el;
}

/**
 * Render a slide element synchronously.
 * Falls back to "Unknown slide type" for custom types not bundled in client;
 * `triggerServerRender` swaps in the server-rendered HTML afterwards.
 *
 * `lang` is the deck's language (`resolveDeckLang(pres)`), and it is what the
 * interactive types read for their built-in copy. Leaving it out is not
 * neutral: the slide then falls back to `DEFAULT_SLIDE_COPY_LANG`, so a caller
 * that has a presentation in hand should always pass it.
 *
 * `renderVia` is where a server-rendered type is fetched from (see
 * `serverRenderRequest`). Every call site states it, like `lang`
 * (`tests/render-via-declaration.test.js`), because the surface is the only
 * thing that knows which capability it holds.
 */
export function renderSlideElement(
  slide,
  { mode, theme, followCodes, presentationId, renderVia, api, lang } = {},
) {
  let html;

  // Check if this is a custom slide type that needs server-side rendering
  if (needsServerRender(slide?.type)) {
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
      lang,
    }).trim();
  }

  const wrap = h('div');
  wrap.innerHTML = html;
  const el = wrap.firstElementChild;
  if (!el) throw new Error('renderSlideHtml returned empty markup');

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
  // Thumbnails use the same logical slide dimensions as full-size renders.
  cleanups.push(initTeamCardsJustify(el));
  // Follow-invite slides look blank without QR rendering. Which slides those
  // are is a question of markup, not of type name: the init scans for the
  // `[data-follow-qr]` / `[data-follow-go-url]` it fills and does nothing when
  // a slide carries neither (B386). Thumbnails render once without the resize
  // handler, so many of them can't leak listeners.
  cleanups.push(
    initFollowInviteSlides(
      el,
      mode === 'thumb' ? { enableResize: false } : undefined,
    ),
  );
  // Countdown timer: presenter-driven in present/follow, static in thumbnails.
  // Like the follow-invite init above, which slides these are is a question of
  // markup, not of type name: the init scans for `.slide-countdown` and does
  // nothing when a slide carries none (B387). `detectSlideRuntimeNeeds()` on
  // the server reads the same markup for the export path, so neither side
  // answers by type name. Both read the markup that exists *here*: markup a
  // server render swaps in below reaches neither init, because
  // `triggerServerRender` re-runs only the theme vars and code/math (B391).
  // `interactive` stays a branch — that one is driven by the render mode, not
  // by the type.
  cleanups.push(
    initCountdownSlides(el, {
      interactive: mode === 'present' || mode === 'follow',
    }),
  );

  // For custom slide types, trigger async server-side rendering through the
  // route the surface declared.
  if (el.dataset.needsServerRender === '1') {
    pendingServerRenders.set(
      el,
      triggerServerRender(el, slide, {
        mode,
        theme,
        renderVia,
        lang,
        api,
      }),
    );
  }

  return el;
}

// Placeholder element -> the promise of its server render (see slideRendered).
const pendingServerRenders = new WeakMap();

/**
 * Wait until a slide element returned by `renderSlideElement()` carries its
 * real markup.
 *
 * A client-rendered slide is complete when it is returned, so this resolves
 * `true` straight away. A server-rendered one starts as a `slide-loading`
 * placeholder; this resolves once `triggerServerRender` has settled: `true` when
 * the markup was swapped in, `false` when it never will be (the render failed
 * or the element was unmounted first).
 *
 * This is the one signal that server markup landed (D113): the editor canvas
 * awaits it to redecorate after a mount, the ghost spawn to find the field it
 * asked for. It settles on failure too, so an awaiting caller never hangs; a
 * caller that remounted in the meantime checks `el.isConnected` itself.
 *
 * @param {Element|null|undefined} el
 * @returns {Promise<boolean>}
 */
export function slideRendered(el) {
  if (!el) return Promise.resolve(false);
  if (el.dataset?.needsServerRender !== '1') return Promise.resolve(true);
  return pendingServerRenders.get(el) || Promise.resolve(false);
}

/**
 * Trigger server-side rendering for a custom slide type.
 * Replaces the placeholder element's content with server-rendered HTML.
 * Resolves `true` when the markup was swapped in, `false` otherwise.
 */
async function triggerServerRender(
  el,
  slide,
  { mode, theme, renderVia, lang, api },
) {
  try {
    const html = await serverRenderSlide({
      slide,
      renderVia,
      mode,
      theme,
      lang,
      api,
    });
    const wrap = h('div');
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
      // Callers that decorated the placeholder re-apply against the real slide
      // DOM by awaiting slideRendered(el).
      return true;
    }
  } catch (err) {
    console.error('[slide-render] Server render failed:', err);
    // Leave the placeholder in place
  }
  return false;
}

// Exported for the seam-order / fork-override guardrails: the render-path
// decision that a fork override of a core name is drawn by the server, which is
// what makes the inline descriptor safe to resolve definition-first.
export { needsServerRender, isServerOverriddenType };
// Exported for the render-source guard (tests/render-via-declaration.test.js):
// the route each `renderVia` kind resolves to is what it checks against the
// server's pre-gate route tables.
export { serverRenderRequest };
