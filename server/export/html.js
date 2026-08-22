import {
  renderSlideHtml,
  computeHeadingShifts,
} from '../utils/render-slide.js';
import { filterForExport, filterForPublished } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { escapeHtml, embedImgSrcDataUrls } from '../utils/html-utils.js';
import {
  buildPrismKatexTags,
  detectPrismKatexNeeds,
} from '../utils/prism-katex.js';
import { buildScriptChain } from '../utils/script-chain.js';
import { loadExportCssBundle, embedSlideImages } from './css-bundle.js';
import { buildCssChain } from '../utils/css-chain.js';
import { buildDocumentHead } from '../utils/head-chain.js';
import { inlineLocalFontUrls } from '../utils/embed-fonts.js';
import {
  getSlideEffectiveDuration,
  DEFAULT_ADVANCE_INTERVAL_SECONDS,
} from '../../shared/slide-timing.js';

/**
 * Chrome the standalone/published page adds on top of the deck bundle: the
 * letterboxed 1600x900 stage, the visible nav controls, and the `?ui=min`
 * embed shape. A layer of the same chain, so the fork seam still lands last
 * (server/utils/css-chain.js).
 */
const STANDALONE_CSS = `
      /* Standalone published view: scale fixed design (1600×900) to fit viewport, letterboxed. */
      .export-body .deck {
        align-items: stretch;
        justify-content: stretch;
      }
      .ps-standalone-stage-wrap {
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
      }
      .ps-standalone-stage {
        position: absolute;
        width: 1600px;
        height: 900px;
        left: 0;
        top: 0;
        transform-origin: top left;
        max-width: none;
        max-height: none;
      }

      /* Standalone published view: visible navigation controls (touch + discoverability). */
      .ps-standalone-progress-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 6px;
      }
      .ps-standalone-nav {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }
      .ps-standalone-loop {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-muted, #666);
      }
      .ps-standalone-loop-interval {
        width: 56px;
        padding: 4px 6px;
        border: 1px solid var(--color-border, #d0d0d0);
        border-radius: 6px;
        font: inherit;
        text-align: right;
      }
      .ps-standalone-loop-interval::-webkit-outer-spin-button,
      .ps-standalone-loop-interval::-webkit-inner-spin-button {
        -webkit-appearance: none;
        margin: 0;
      }
      .ps-standalone-loop-interval[type='number'] {
        -moz-appearance: textfield;
      }
      .ps-standalone-loop-bar {
        position: relative;
        height: 2px;
        margin-bottom: 6px;
        background: var(--color-border, rgba(0, 0, 0, 0.08));
        border-radius: 2px;
        overflow: hidden;
        display: none;
      }
      .ps-standalone-loop-bar.is-on {
        display: block;
      }
      .ps-standalone-loop-bar-fill {
        position: absolute;
        inset: 0;
        width: 0%;
        background: var(--color-accent, #3b82f6);
        transition: none;
      }
      .ps-standalone-loop-bar.is-paused .ps-standalone-loop-bar-fill {
        opacity: 0.4;
      }
      /* Override presenter default spacing when we put the progress text in a row. */
      .presenter-progress .presenter-progress-text {
        margin-bottom: 0;
        white-space: nowrap;
      }

      /* ?ui=min — embed-shaped chrome. The topbar and the control row go away
         and their grid rows collapse to 0, so the scaled stage is the whole
         frame and a host page can size the iframe with aspect-ratio: 16 / 9
         alone (no "chrome height" constant to keep in sync). What remains is
         the 3px progress fill, absolutely positioned so it costs no layout
         height: it is the only cue that the deck has more slides, it is not
         interactive, and it cannot wrap. The slide counter is dropped from
         view but still announced through #srStatus.
         Keyboard nav (arrows/space/Home/End) and F for fullscreen are
         untouched — with the buttons gone they are the interaction surface. */
      html.ui-min .presenter-shell {
        --presenter-topbar-height: 0px;
        --presenter-progress-height: 0px;
      }
      html.ui-min .presenter-topbar,
      html.ui-min .ps-standalone-progress-row,
      html.ui-min .ps-standalone-loop-bar {
        display: none;
      }
      html.ui-min .presenter-progress {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 60;
        padding: 0;
        background: transparent;
        border-top: none;
        backdrop-filter: none;
        pointer-events: none;
      }
      html.ui-min .presenter-progress-bar {
        height: 3px;
        border-radius: 0;
        background: transparent;
      }
`;

/**
 * The standalone/published deck runtime: slide navigation, the progress bar and
 * screen-reader status, fullscreen, and the auto-advance/loop machinery.
 *
 * Path-specific — no other render path shows one slide at a time with visible
 * nav — so it stays here and is handed to the script chain as a body. What it
 * is *not* responsible for any more: video embeds and stage scaling, which it
 * shared byte-for-byte with the embed and which now come from
 * `runtime: 'stage'` (server/utils/script-chain.js).
 *
 * @param {Object} options
 * @param {string} options.autoAdvanceJson - Pre-serialised auto-advance config
 * @returns {string} JavaScript source
 */
function deckRuntimeJs({ autoAdvanceJson }) {
  return `
        // Auto-advance / loop config baked in at render time. URL params can override.
        window.__DECK_AUTO_ADVANCE__ = ${autoAdvanceJson};

        const btnPrev = document.getElementById('btnPrev');
        const btnNext = document.getElementById('btnNext');
        const srStatus = document.getElementById('srStatus');

        attachStageScale();

        const slides = Array.from(document.querySelectorAll('.deck-slide'));
        let idx = 0;
        function clamp(n) { return Math.max(0, Math.min(slides.length - 1, n)); }
        function updateNavDisabled() {
          if (btnPrev) btnPrev.disabled = idx <= 0;
          if (btnNext) btnNext.disabled = idx >= slides.length - 1;
        }
        function readHeadingFromSlideEl(deckSlideEl) {
          const root = deckSlideEl ? deckSlideEl.querySelector('.slide') : null;
          if (!root) return '';
          const h = root.querySelector('h1, h2, h3');
          const t = h ? String(h.textContent || '').trim() : '';
          return t;
        }
        function slideA11yLabel(deckSlideEl) {
          const n = idx + 1;
          const total = slides.length;
          const prefix = total ? ('Slide ' + n + ' of ' + total) : ('Slide ' + n);
          const t1 = deckSlideEl && deckSlideEl.dataset ? String(deckSlideEl.dataset.a11yTitle || '').trim() : '';
          const t2 = t1 || readHeadingFromSlideEl(deckSlideEl);
          return t2 ? (prefix + ': ' + t2) : prefix;
        }
        function slideA11ySummary(deckSlideEl) {
          return deckSlideEl && deckSlideEl.dataset
            ? String(deckSlideEl.dataset.a11ySummary || '').trim()
            : '';
        }
        function updateSlideA11y() {
          for (let j = 0; j < slides.length; j += 1) {
            const s = slides[j];
            const isActive = j === idx;
            s.classList.toggle('is-active', isActive);
            s.setAttribute('aria-hidden', isActive ? 'false' : 'true');
            if (isActive) {
              s.setAttribute('aria-current', 'true');
              s.removeAttribute('inert');
            } else {
              s.removeAttribute('aria-current');
              s.setAttribute('inert', '');
            }
          }
        }
        function show(i) {
          const prev = slides[idx];
          idx = clamp(i);
          updateSlideA11y();
          if (prev && prev !== slides[idx]) pauseVideoEmbeds(prev);
          activateVideoEmbeds(slides[idx]);
          const txt = document.getElementById('progressText');
          const fill = document.getElementById('progressFill');
          if (txt) txt.textContent = (idx + 1) + ' / ' + slides.length;
          if (fill) fill.style.width = (slides.length ? ((idx + 1) / slides.length * 100) : 0) + '%';
          updateNavDisabled();
          if (srStatus) {
            const label = slideA11yLabel(slides[idx]);
            const summary = slideA11ySummary(slides[idx]);
            srStatus.textContent = summary ? (label + '. ' + summary) : label;
          }
          history.replaceState(null, '', '#slide=' + idx);
        }
        function next() { show(idx + 1); }
        function prev() { show(idx - 1); }
        function toggleFullscreen() {
          const d = document.documentElement;
          if (!document.fullscreenElement) d.requestFullscreen && d.requestFullscreen();
          else document.exitFullscreen && document.exitFullscreen();
        }
        if (btnPrev) btnPrev.addEventListener('click', () => prev());
        if (btnNext) btnNext.addEventListener('click', () => next());
        document.addEventListener('keydown', (e) => {
          const target = e.target;
          const tag =
            target && target.tagName ? String(target.tagName).toUpperCase() : '';
          const isTyping =
            tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            tag === 'SELECT' ||
            (target && target.isContentEditable);
          if (isTyping) return;
          if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
          if (e.key === 'Home') { e.preventDefault(); show(0); }
          if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
          if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); }
          if (e.key === 'Escape' && document.fullscreenElement) { e.preventDefault(); document.exitFullscreen(); }
        });
        const m = location.hash.match(/slide=(\\d+)/);
        if (m) idx = clamp(parseInt(m[1], 10));
        show(idx);

        // Auto-advance / loop runtime — driven by deck settings, URL params override.
        // URL params: ?loop=1|0 (autoplay + loop at end), ?autoplay=1|0 (autoplay only),
        // ?interval=N (seconds per slide, 1–300; overrides per-slide + deck defaults).
        // (?ui=min is handled by the inline script at the top of <body>.)
        (function setupAutoLoop() {
          const cfg = window.__DECK_AUTO_ADVANCE__ || {};
          const baseEnabled = !!cfg.enabled;
          const baseLoop = !!cfg.loop;
          const baseInterval = Number(cfg.intervalSeconds) || 20;
          const slideDurs = Array.isArray(cfg.slideDurations) ? cfg.slideDurations : [];

          const params = new URLSearchParams(location.search);
          function paramBool(name) {
            if (!params.has(name)) return null;
            const v = String(params.get(name)).toLowerCase().trim();
            if (v === '1' || v === 'true' || v === 'on' || v === 'yes') return true;
            if (v === '0' || v === 'false' || v === 'off' || v === 'no') return false;
            return null;
          }
          const pLoop = paramBool('loop');
          const pAuto = paramBool('autoplay');
          const pIntervalRaw = params.get('interval');
          const pInterval = pIntervalRaw != null ? Number(pIntervalRaw) : null;

          let shouldAutoplay;
          if (pLoop === false || pAuto === false) shouldAutoplay = false;
          else if (pLoop === true || pAuto === true) shouldAutoplay = true;
          else shouldAutoplay = baseEnabled;

          let loopAtEnd;
          if (pLoop === false) loopAtEnd = false;
          else if (pLoop === true) loopAtEnd = true;
          else loopAtEnd = baseLoop;

          let intervalOverride = null;
          if (pInterval != null && Number.isFinite(pInterval) && pInterval >= 1 && pInterval <= 300) {
            intervalOverride = Math.round(pInterval);
          }

          const btnLoop = document.getElementById('btnLoop');
          const loopIntervalInput = document.getElementById('loopInterval');
          const loopIntervalWrap = document.getElementById('loopIntervalWrap');
          const loopBar = document.getElementById('loopBar');
          const loopBarFill = document.getElementById('loopBarFill');

          if (btnLoop) btnLoop.hidden = false;
          if (loopIntervalWrap) loopIntervalWrap.hidden = false;
          if (loopIntervalInput) {
            loopIntervalInput.value = String(intervalOverride != null ? intervalOverride : baseInterval);
          }

          let isPlaying = false;
          let timerId = null;
          let rafId = null;
          let slideStartedAt = 0;
          let slideDurationMs = 0;

          function getSlideDurationSec() {
            const inputVal = Number(loopIntervalInput && loopIntervalInput.value);
            if (Number.isFinite(inputVal) && inputVal >= 1 && inputVal <= 300) {
              return Math.round(inputVal);
            }
            const slideDur = Number(slideDurs[idx]);
            if (Number.isFinite(slideDur) && slideDur >= 1 && slideDur <= 300) return slideDur;
            return baseInterval;
          }

          function tickBar() {
            if (!isPlaying || !loopBarFill) return;
            const now = performance.now();
            const elapsed = now - slideStartedAt;
            const pct = Math.min(100, (elapsed / slideDurationMs) * 100);
            loopBarFill.style.width = pct.toFixed(1) + '%';
            rafId = requestAnimationFrame(tickBar);
          }

          function clearTimers() {
            if (timerId) { clearTimeout(timerId); timerId = null; }
            if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          }

          function scheduleNext() {
            clearTimers();
            if (!isPlaying) return;
            const sec = getSlideDurationSec();
            slideDurationMs = sec * 1000;
            slideStartedAt = performance.now();
            if (loopBarFill) loopBarFill.style.width = '0%';
            rafId = requestAnimationFrame(tickBar);
            timerId = setTimeout(() => {
              if (idx >= slides.length - 1) {
                if (loopAtEnd) show(0);
                else { setPlaying(false); return; }
              } else {
                show(idx + 1);
              }
            }, slideDurationMs);
          }

          function updateButton() {
            if (btnLoop) {
              btnLoop.textContent = isPlaying ? '⏸ Loop' : '▶ Loop';
              btnLoop.setAttribute('aria-pressed', isPlaying ? 'true' : 'false');
            }
            if (loopBar) loopBar.classList.toggle('is-on', isPlaying);
          }

          function setPlaying(on) {
            isPlaying = !!on;
            if (isPlaying) scheduleNext();
            else { clearTimers(); if (loopBarFill) loopBarFill.style.width = '0%'; }
            updateButton();
          }

          // Re-arm timer on any slide change (including manual nav).
          const __origShow = show;
          show = function(i) {
            __origShow(i);
            if (isPlaying) scheduleNext();
          };

          if (btnLoop) btnLoop.addEventListener('click', () => setPlaying(!isPlaying));
          if (loopIntervalInput) {
            loopIntervalInput.addEventListener('change', () => {
              if (isPlaying) scheduleNext();
            });
          }

          document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
              if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
            } else if (isPlaying) {
              rafId = requestAnimationFrame(tickBar);
            }
          });

          if (shouldAutoplay) setPlaying(true);
          else updateButton();
        })();
`;
}

export async function buildStandaloneHtml(
  repoRoot,
  pres,
  {
    headHtml = '',
    topbarRightHtml = '',
    theme = null,
    watermark = null,
    context = 'export',
    slideTypes = null,
    description = null,
  } = {},
) {
  // Apply the appropriate visibility filter based on context
  pres =
    context === 'published' ? filterForPublished(pres) : filterForExport(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  // The deck's own language, for slide types that render built-in copy. Not
  // the same value as docLang: that one always answers (falling back to nl for
  // <html lang>), this one stays null when the deck names no language so the
  // copy table can apply its own documented default.
  const deckLang = resolveDeckLang(pres);
  // Meta description: use the caller-supplied string (the published route
  // passes one with its own fallback), else the deck's own description. The
  // reader view already emits this; the visual export/published head didn't.
  const metaDescription = (
    typeof description === 'string' && description.trim()
      ? description
      : typeof pres?.description === 'string'
        ? pres.description
        : ''
  ).trim();
  const css = await loadExportCssBundle(repoRoot, theme, watermark);

  // Inline any root-relative local font file a bundled stylesheet still
  // references (a custom theme's own face) as a data URL, so a downloaded
  // standalone file renders it offline instead of falling back to system fonts
  // on a dead `/assets/...woff2` reference. Theme fonts are already embedded
  // via css.fontCss; this only embeds what the CSS actually references, never
  // the whole ~2.7 MB pinned library. See
  // docs/reference/standalone-html-export.md.
  const [chromeCss, slidesCss] = await Promise.all([
    inlineLocalFontUrls(repoRoot, css.chromeCss),
    inlineLocalFontUrls(repoRoot, css.slidesCss),
  ]);

  // Build external font links/scripts for managed fonts (Adobe, Monotype, Google)
  function isSafeUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' || parsed.protocol === 'http:';
    } catch {
      return false;
    }
  }
  const externalFontLinks = Array.isArray(theme?.externalFontLinks)
    ? theme.externalFontLinks
    : [];
  const externalFontCssLinks = externalFontLinks
    .filter((l) => l.type === 'css' && l.url)
    .filter((l) => isSafeUrl(l.url))
    .map(
      (l) =>
        `<link rel="stylesheet" href="${l.url.replace(/"/g, '&quot;')}" />`,
    )
    .join('\n    ');
  const externalFontScripts = externalFontLinks
    .filter((l) => l.type === 'js' && l.url)
    .filter((l) => isSafeUrl(l.url))
    .map((l) => `<script src="${l.url.replace(/"/g, '&quot;')}"></script>`)
    .join('\n    ');

  // Embed uploads + /client assets (Lucide icon SVGs), so the downloaded
  // standalone HTML works without a server. Shared cache dedupes the same
  // source across this pass and the rendered-HTML pass below.
  const embedCache = new Map();
  const slides = await embedSlideImages(repoRoot, pres.slides, {
    includeClient: true,
    cache: embedCache,
  });

  // Auto-advance / loop config (used by published /p/ pages and downloaded standalone HTML).
  // URL params (?loop / ?autoplay / ?interval) can override these at runtime.
  const autoAdvanceCfg =
    pres?.settings?.autoAdvance && typeof pres.settings.autoAdvance === 'object'
      ? pres.settings.autoAdvance
      : {};
  const autoAdvanceEnabled =
    !!autoAdvanceCfg.enabled && autoAdvanceCfg.mode !== 'pacing';
  const autoAdvanceLoop = !!autoAdvanceCfg.loop;
  const autoAdvanceInterval =
    Number(autoAdvanceCfg.intervalSeconds) || DEFAULT_ADVANCE_INTERVAL_SECONDS;
  const slideDurations = slides.map((s) =>
    getSlideEffectiveDuration(s, autoAdvanceInterval),
  );
  const autoAdvanceJson = JSON.stringify({
    enabled: autoAdvanceEnabled,
    loop: autoAdvanceLoop,
    intervalSeconds: autoAdvanceInterval,
    slideDurations,
  });

  // Per-slide heading depth for the document outline: the deck title below is
  // the single <h1>; chapter sections push their slides one level deeper.
  const headingShifts = computeHeadingShifts(slides);
  let slidesHtml = slides
    .map((s, i) => {
      const c = s?.content && typeof s.content === 'object' ? s.content : {};
      const a11yTitle =
        typeof c?.a11yTitle === 'string' ? c.a11yTitle.trim() : '';
      const a11ySummary =
        typeof c?.a11ySummary === 'string' ? c.a11ySummary.trim() : '';
      const a11yTitleAttr = a11yTitle
        ? ` data-a11y-title="${escapeHtml(a11yTitle)}"`
        : '';
      const a11ySummaryAttr = a11ySummary
        ? ` data-a11y-summary="${escapeHtml(a11ySummary)}"`
        : '';
      return `<section class="deck-slide" data-slide-id="${escapeHtml(
        s.id,
      )}"${a11yTitleAttr}${a11ySummaryAttr}>${renderSlideHtml(s, { theme, slideTypes, stripEditorAttrs: true, headingShift: headingShifts[i], lang: deckLang })}</section>`;
    })
    .join('\n');
  slidesHtml = await embedImgSrcDataUrls(repoRoot, slidesHtml, {
    includeClient: true,
    cache: embedCache,
  });
  const title = escapeHtml(pres.title || 'Presentation');
  const extraHead = String(headHtml || '');
  const extraTopbar = String(topbarRightHtml || '');

  // Prism/KaTeX come from client/vendor/, and only when the rendered slides
  // actually contain a code block or math — Prism then loads just the language
  // packs this deck uses. The two contexts reach the same bytes differently:
  // a published /p/ page is served by this server, so it links them and the
  // browser caches them across decks; a downloaded file has no origin to
  // resolve `/client/vendor/…` against, so it carries them inline.
  const highlightNeeds = detectPrismKatexNeeds(slidesHtml);

  return `${buildDocumentHead({
    lang: docLang,
    title: pres.title || 'Presentation',
    description: metaDescription,
    head: [
      extraHead,
      externalFontCssLinks,
      externalFontScripts,
      buildPrismKatexTags({
        ...highlightNeeds,
        mode: context === 'published' ? 'linked' : 'inlined',
      }),
    ],
    styles: [
      buildCssChain(
        repoRoot,
        [
          css.fontCss,
          chromeCss,
          css.themeVarsCss,
          css.themeCss,
          slidesCss,
          css.wmCss,
          STANDALONE_CSS,
        ],
        { customCss: css.customCss },
      ),
    ],
  })}
  <body class="export-body">
    <script>
      // ?ui=min: hide the presenter chrome (see the .ui-min rules above). Read
      // before the shell renders so an embedded deck never flashes a topbar it
      // is about to drop. Same param name and meaning as buildEmbedHtml's ui
      // option, so the two runtimes keep one vocabulary.
      (function () {
        var ui = 'default';
        try {
          var raw = new URLSearchParams(location.search).get('ui');
          if (String(raw || '').toLowerCase().trim() === 'min') ui = 'min';
        } catch (e) {}
        window.__DECK_UI__ = ui;
        if (ui === 'min') document.documentElement.classList.add('ui-min');
      })();
    </script>
    <a class="skip-link" href="#deck">Skip to slides</a>
    <div class="presenter-shell">
      <header class="presenter-topbar">
        <h1 class="presenter-title">${title}</h1>
        <div class="row" style="gap: 10px; align-items:center;">
          ${extraTopbar}
          <div class="presenter-help">←/→ or Space · F fullscreen · Esc</div>
        </div>
      </header>
      <main id="deck" class="deck" aria-live="polite">
        <div id="stageWrap" class="ps-standalone-stage-wrap">
          <div id="stage" class="ps-standalone-stage ps-theme">
            ${css.wmHtml}
            ${slidesHtml}
          </div>
        </div>
      </main>
      <footer class="presenter-progress">
        <div id="srStatus" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
        <div id="loopBar" class="ps-standalone-loop-bar"><div id="loopBarFill" class="ps-standalone-loop-bar-fill"></div></div>
        <div class="ps-standalone-progress-row">
          <nav class="ps-standalone-nav" aria-label="Slide navigation">
            <button id="btnPrev" class="btn btn-secondary is-compact" type="button" aria-label="Previous slide">Previous</button>
            <button id="btnNext" class="btn btn-secondary is-compact" type="button" aria-label="Next slide">Next</button>
            <button id="btnLoop" class="btn btn-secondary is-compact" type="button" aria-label="Auto-loop" aria-pressed="false" hidden>▶ Loop</button>
            <label class="ps-standalone-loop" hidden id="loopIntervalWrap">
              <input id="loopInterval" class="ps-standalone-loop-interval" type="number" min="1" max="300" step="1" aria-label="Seconds per slide" />
              <span>s</span>
            </label>
          </nav>
          <div id="progressText" class="presenter-progress-text" aria-live="polite"></div>
        </div>
        <div class="presenter-progress-bar"><div id="progressFill" class="presenter-progress-fill"></div></div>
      </footer>
    </div>
    ${buildScriptChain({
      runtime: 'stage',
      needs: highlightNeeds,
      body: deckRuntimeJs({ autoAdvanceJson }),
    })}
  </body>
</html>`;
}
