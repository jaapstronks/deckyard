import { renderSlideHtml } from '../utils/render-slide.js';
import { filterForExport, filterForPublished } from '../utils/public-output.js';
import { resolveDocLangFromPresentation, getDocDir } from '../utils/doc-lang.js';
import {
  escapeHtml,
  embedImgSrcDataUrls,
} from '../utils/html-utils.js';
import { buildPrismKatexCdnTags, buildPrismKatexInitScript } from '../utils/prism-katex.js';
import { loadExportCssBundle, embedSlideImages } from './css-bundle.js';
import { inlineLocalFontUrls } from '../utils/embed-fonts.js';
import { getSlideEffectiveDuration, DEFAULT_ADVANCE_INTERVAL_SECONDS } from '../../shared/slide-timing.js';

export async function buildStandaloneHtml(
  repoRoot,
  pres,
  { headHtml = '', topbarRightHtml = '', theme = null, watermark = null, context = 'export', presentationId = '', slideTypes = null } = {}
) {
  // Apply the appropriate visibility filter based on context
  pres = context === 'published' ? filterForPublished(pres) : filterForExport(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  const docDir = getDocDir(docLang);
  const css = await loadExportCssBundle(repoRoot, theme, watermark);

  // Inline any root-relative local font files (e.g. the shared Bricolage
  // Grotesque UI weight in client/styles/shared/fonts.css) as data URLs, so a
  // downloaded standalone file renders its fonts offline instead of falling
  // back to system fonts on a dead `/assets/fonts/*.woff2` reference. Theme
  // fonts are already embedded via css.fontCss; this only embeds the handful
  // of small weights the CSS actually references (a few KB each), not the
  // whole ~2.5 MB font library. See docs/reference/standalone-html-export.md.
  const [appCss, slidesCss] = await Promise.all([
    inlineLocalFontUrls(repoRoot, css.appCss),
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
  const externalFontLinks = Array.isArray(theme?.externalFontLinks) ? theme.externalFontLinks : [];
  const externalFontCssLinks = externalFontLinks
    .filter((l) => l.type === 'css' && l.url)
    .filter((l) => isSafeUrl(l.url))
    .map((l) => `<link rel="stylesheet" href="${l.url.replace(/"/g, '&quot;')}" />`)
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
  const autoAdvanceEnabled = !!autoAdvanceCfg.enabled && autoAdvanceCfg.mode !== 'pacing';
  const autoAdvanceLoop = !!autoAdvanceCfg.loop;
  const autoAdvanceInterval = Number(autoAdvanceCfg.intervalSeconds) || DEFAULT_ADVANCE_INTERVAL_SECONDS;
  const slideDurations = slides.map((s) => getSlideEffectiveDuration(s, autoAdvanceInterval));
  const autoAdvanceJson = JSON.stringify({
    enabled: autoAdvanceEnabled,
    loop: autoAdvanceLoop,
    intervalSeconds: autoAdvanceInterval,
    slideDurations,
  });

  let slidesHtml = slides
    .map(
      (s) => {
        const c =
          s?.content && typeof s.content === 'object' ? s.content : {};
        const a11yTitle = typeof c?.a11yTitle === 'string' ? c.a11yTitle.trim() : '';
        const a11ySummary =
          typeof c?.a11ySummary === 'string' ? c.a11ySummary.trim() : '';
        const a11yTitleAttr = a11yTitle
          ? ` data-a11y-title="${escapeHtml(a11yTitle)}"`
          : '';
        const a11ySummaryAttr = a11ySummary
          ? ` data-a11y-summary="${escapeHtml(a11ySummary)}"`
          : '';
        return `<section class="deck-slide" data-slide-id="${escapeHtml(
          s.id
        )}"${a11yTitleAttr}${a11ySummaryAttr}>${renderSlideHtml(s, { theme, slideTypes })}</section>`;
      }
    )
    .join('\n');
  slidesHtml = await embedImgSrcDataUrls(repoRoot, slidesHtml, {
    includeClient: true,
    cache: embedCache,
  });
  const title = escapeHtml(pres.title || 'Presentation');
  const extraHead = String(headHtml || '');
  const extraTopbar = String(topbarRightHtml || '');

  return `<!doctype html>
<html lang="${escapeHtml(docLang)}" dir="${escapeHtml(docDir)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    ${extraHead}
    ${externalFontCssLinks}
    ${externalFontScripts}
    <script src="https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js" data-bunny-playerjs="1"></script>
    ${buildPrismKatexCdnTags()}
    <style>
${css.fontCss}
${appCss}
${css.themeVarsCss}
${css.themeCss}
${slidesCss}
${css.wmCss}

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
    </style>
  </head>
  <body class="export-body">
    <a class="skip-link" href="#deck">Skip to slides</a>
    <div class="presenter-shell">
      <header class="presenter-topbar">
        <div class="presenter-title">${title}</div>
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
    <script>
      (function() {
        // Presentation ID for lead capture forms
        window.__PRESENTATION_ID__ = ${JSON.stringify(presentationId || pres?.id || '')};
        // Auto-advance / loop config baked in at render time. URL params can override.
        window.__DECK_AUTO_ADVANCE__ = ${autoAdvanceJson};

        const BASE_W = 1600;
        const BASE_H = 900;

        // Bunny Stream Player.js support (for video-slide embeds)
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
              try { new window.playerjs.Player(iframe); } catch (e) {}
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

        const stageWrapEl = document.getElementById('stageWrap');
        const stageEl = document.getElementById('stage');
        const btnPrev = document.getElementById('btnPrev');
        const btnNext = document.getElementById('btnNext');
        const srStatus = document.getElementById('srStatus');

        // Scale the fixed 1600×900 stage to fit the available area (between topbar and progress).
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
        updateStageScale();
        try {
          const ro = new ResizeObserver(() => updateStageScale());
          if (stageWrapEl) ro.observe(stageWrapEl);
        } catch {
          window.addEventListener('resize', updateStageScale, { passive: true });
        }

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
        const m = location.hash.match(/slide=(\d+)/);
        if (m) idx = clamp(parseInt(m[1], 10));
        show(idx);

        // Auto-advance / loop runtime — driven by deck settings, URL params override.
        // URL params: ?loop=1|0 (autoplay + loop at end), ?autoplay=1|0 (autoplay only),
        // ?interval=N (seconds per slide, 1–300; overrides per-slide + deck defaults).
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

        ${buildPrismKatexInitScript()}

        // Lead capture form handling
        function initLeadCaptureForms() {
          const forms = document.querySelectorAll('.slide-lead-capture [data-lead-form="1"]');
          for (const form of forms) {
            const slideEl = form.closest('.slide-lead-capture');
            if (!slideEl) continue;
            const slideId = slideEl.dataset.slideId || '';
            const formState = slideEl.querySelector('[data-lead-state="form"]');
            const thankYouState = slideEl.querySelector('[data-lead-state="thankyou"]');
            const errorEl = slideEl.querySelector('[data-lead-error="1"]');

            // Check if already submitted
            const storageKey = 'lead_submitted_' + slideId;
            if (localStorage.getItem(storageKey) === 'true') {
              if (formState) formState.hidden = true;
              if (thankYouState) thankYouState.hidden = false;
              continue;
            }

            form.addEventListener('submit', async function(e) {
              e.preventDefault();
              const formData = new FormData(form);
              const name = (formData.get('name') || '').trim();
              const email = (formData.get('email') || '').trim();
              const consentChecked = form.querySelector('input[name="consent"]');
              const consentText = formData.get('consentText') || '';
              const privacyUrl = formData.get('privacyUrl') || '';

              // Validation
              if (!name) { if (errorEl) errorEl.textContent = 'Please enter your name.'; return; }
              if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) { if (errorEl) errorEl.textContent = 'Please enter a valid email.'; return; }
              if (consentChecked && !consentChecked.checked) { if (errorEl) errorEl.textContent = 'Please accept the privacy terms.'; return; }
              if (errorEl) errorEl.textContent = '';

              try {
                const presentationId = window.__PRESENTATION_ID__ || '';
                const response = await fetch('/api/leads', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ presentationId, slideId, name, email, consentGiven: true, consentText, privacyUrl })
                });
                if (!response.ok) {
                  const data = await response.json().catch(() => ({}));
                  throw new Error(data.error || 'Submission failed');
                }
                localStorage.setItem(storageKey, 'true');
                if (formState) formState.hidden = true;
                if (thankYouState) thankYouState.hidden = false;
              } catch (err) {
                if (errorEl) errorEl.textContent = err.message || 'Something went wrong.';
              }
            });
          }
        }
        initLeadCaptureForms();
      })();
    </script>
  </body>
</html>`;
}