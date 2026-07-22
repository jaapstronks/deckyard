import { escapeHtml } from './helpers.js';
import { DEFAULT_THEME_ID } from '../../../shared/constants/themes.js';

export function renderEmbedHtmlDocument({
  title = 'Presentation',
  docLang = 'en',
  docDir = 'ltr',
  totalSlides = 0,
  publishId = '',
  ui = 'default',
  slidesHtml = '',
  themeId = DEFAULT_THEME_ID,
  themeVarsCss = '',
  headHtml = '',
  externalFontHtml = '',
  watermarkCss = '',
  watermarkHtml = '',
  boot = {},
} = {}) {
  const safeTitle = escapeHtml(title || 'Presentation');
  const lang = docLang === 'nl' ? 'nl' : 'en';
  const dir = docDir === 'rtl' ? 'rtl' : 'ltr';
  const mode = ui === 'min' ? 'min' : 'default';
  const safeTotalSlides = Math.max(
    0,
    Number(totalSlides || 0) || 0
  );
  const safeBoot = {
    publishId: String(boot?.publishId || publishId || ''),
    totalSlides: safeTotalSlides,
    options:
      boot?.options && typeof boot.options === 'object'
        ? boot.options
        : {},
    lang:
      boot?.lang === 'nl' || boot?.lang === 'en-GB'
        ? boot.lang
        : null,
    hasOtherLang: !!boot?.hasOtherLang,
  };
  const bootJson = JSON.stringify(safeBoot, null, 0);

  const safeThemeId = escapeHtml(String(themeId || DEFAULT_THEME_ID));
  const themeVars = String(themeVarsCss || '');
  const extraHead = String(headHtml || '');
  const extraFontHtml = String(externalFontHtml || '');
  const wmCss = String(watermarkCss || '');
  const wmHtml = String(watermarkHtml || '');
  return `<!doctype html>
<html lang="${escapeHtml(lang)}" dir="${escapeHtml(dir)}" data-theme="${safeThemeId}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>${safeTitle}</title>
    ${extraHead}
    ${extraFontHtml}
    <script src="https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js" data-bunny-playerjs="1"></script>
    <link rel="stylesheet" href="/client/styles/shared/fonts.css" />
    <link rel="stylesheet" href="/assets/fonts/google/fonts.css" />
    <link rel="stylesheet" href="/client/styles/embed.css" />
    <link rel="stylesheet" href="/client/styles/theme.css" />
    <link rel="stylesheet" href="/client/styles/slides.css" />
    <style id="ps-theme-vars">${themeVars}</style>
    <style>
      /* Embed shell: keep it iframe-friendly (no app chrome assumptions) */
      html, body { height: 100%; }
      body {
        margin: 0;
        background: #000;
        overflow: hidden;
      }
      .ps-embed {
        height: 100%;
        display: flex;
        flex-direction: column;
      }
      .ps-embed.ui-min .ps-embed-controls {
        display: none;
      }
      .ps-embed-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 10px 12px;
        background: rgba(0, 0, 0, 0.72);
        border-bottom: 1px solid rgba(255, 255, 255, 0.12);
        backdrop-filter: blur(10px);
      }
      .ps-embed-controls .row {
        display: flex;
        gap: 10px;
        align-items: center;
        flex-wrap: wrap;
      }
      .ps-embed-progress {
        font-size: 13px;
        opacity: 0.9;
        padding: 0 8px;
        user-select: none;
        white-space: nowrap;
      }
      /* The slide CSS already defines .deck and .deck-slide */
      .ps-embed-deck-wrap {
        flex: 1;
        min-height: 0;
      }
      .ps-embed-deck-wrap .deck {
        height: 100%;
        /* Override presenter styling from slides CSS (.deck centers content).
           In embeds we want the stage wrapper to fill the available space under the top controls. */
        align-items: stretch;
        justify-content: stretch;
      }

      /* Embed stage scaling: slides use fixed px typography; scale the whole stage like exports do. */
      .ps-embed-stage-wrap {
        position: relative;
        flex: 1;
        width: 100%;
        height: 100%;
        overflow: hidden;
        background: #000;
      }
      .ps-embed-stage {
        position: absolute;
        width: 1600px;
        height: 900px;
        left: 0;
        top: 0;
        transform-origin: top left;
        max-width: none;
        max-height: none;
      }
      /* In embed mode, we always show exactly 1 slide */
      .deck-slide {
        display: none;
      }
      .deck-slide.is-active {
        display: block;
      }
      ${wmCss}
    </style>
  </head>
  <body>
    <div class="ps-embed ui-${escapeHtml(mode)}">
      <div class="ps-embed-controls" role="toolbar" aria-label="Presentation controls">
        <div class="row">
          <button id="btnPrev" class="btn btn-secondary" type="button" aria-label="Previous slide">←</button>
          <button id="btnNext" class="btn btn-secondary" type="button" aria-label="Next slide">→</button>
          <div id="progress" class="ps-embed-progress" aria-live="polite"></div>
        </div>
        <div class="row">
          <div class="sb-segmented" style="width: 120px;" aria-label="Language">
            <button id="btnLangNl" class="sb-segmented-btn" type="button">NL</button>
            <button id="btnLangEn" class="sb-segmented-btn" type="button">EN</button>
          </div>
          <button id="btnFs" class="btn btn-secondary" type="button" aria-label="Fullscreen">⛶</button>
        </div>
      </div>
      <div class="ps-embed-deck-wrap">
        <div id="deck" class="deck" aria-live="polite">
          <div id="stageWrap" class="ps-embed-stage-wrap">
            <div id="stage" class="ps-embed-stage ps-theme">
              ${wmHtml}
              ${slidesHtml || ''}
            </div>
          </div>
        </div>
      </div>
    </div>

    <script id="boot" type="application/json">${escapeHtml(
      bootJson
    )}</script>
    <script type="module">

      const EMBED_SOURCE = 'presentation-system-embed';
      const BASE_W = 1600;
      const BASE_H = 900;

      function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
      function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

      const bootEl = document.getElementById('boot');
      const boot = safeJsonParse(bootEl ? bootEl.textContent : '') || {};
      const publishId = String(boot.publishId || '');
      const totalSlides = Math.max(0, Number(boot.totalSlides || 0) || 0);
      const options = boot.options && typeof boot.options === 'object' ? boot.options : {};
      const hasOtherLang = !!boot.hasOtherLang;
      const lang = boot.lang === 'nl' || boot.lang === 'en-GB' ? boot.lang : null;
      let controls = options.controls !== false;
      let loop = !!options.loop;
      let allowFullscreen = options.allowFullscreen !== false;
      let ui = options.ui === 'min' ? 'min' : 'default';
      let allowedOrigins = Array.isArray(options.allowedOrigins)
        ? options.allowedOrigins.map((x) => String(x || '').trim()).filter(Boolean)
        : [];
      let langSwitch = options.langSwitch === true;

      // Apply initial UI toggles
      const root = document.querySelector('.ps-embed');
      if (root) root.classList.toggle('ui-min', ui === 'min');
      const controlsEl = document.querySelector('.ps-embed-controls');
      if (controlsEl) controlsEl.style.display = controls ? '' : 'none';

      const deckEl = document.getElementById('deck');
      const stageWrapEl = document.getElementById('stageWrap');
      const stageEl = document.getElementById('stage');
      const slides = Array.from(document.querySelectorAll('.deck-slide'));
      const btnPrev = document.getElementById('btnPrev');
      const btnNext = document.getElementById('btnNext');
      const btnFs = document.getElementById('btnFs');
      const progress = document.getElementById('progress');
      const btnLangNl = document.getElementById('btnLangNl');
      const btnLangEn = document.getElementById('btnLangEn');

      // Scale the fixed 1600×900 stage to fit the available iframe area.
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
        ro.observe(stageWrapEl);
      } catch {
        // Fallback for older browsers (best-effort)
        window.addEventListener('resize', updateStageScale, { passive: true });
      }

      // Poll slides were removed as a standalone feature (no poll runtime here).

      // Bunny video embeds: best-effort init on active slide
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

      let idx = clamp(Number(options.start || 0) || 0, 0, Math.max(0, slides.length - 1));

      function setSlideActive(section, on) {
        if (!section) return;
        section.classList.toggle('is-active', !!on);
        section.setAttribute('aria-hidden', on ? 'false' : 'true');
        section.tabIndex = on ? 0 : -1;
        if (on) section.removeAttribute('inert');
        else section.setAttribute('inert', '');
      }

      function currentSlideId() {
        const s = slides[idx];
        return s ? String(s.dataset.slideId || s.getAttribute('data-slide-id') || '') : '';
      }

      function updateProgress() {
        if (!progress) return;
        progress.textContent = slides.length ? \`\${idx + 1} / \${slides.length}\` : '0 / 0';
      }

      function postToParent(type, payload) {
        try {
          if (!window.parent || window.parent === window) return;
          window.parent.postMessage(
            { source: EMBED_SOURCE, type: String(type || ''), payload: payload || {} },
            '*'
          );
        } catch {}
      }

      function show(nextIdx, { announce = true } = {}) {
        const prev = slides[idx];
        idx = clamp(nextIdx, 0, Math.max(0, slides.length - 1));
        for (let i = 0; i < slides.length; i += 1) setSlideActive(slides[i], i === idx);
        updateProgress();
        if (prev && prev !== slides[idx]) pauseVideoEmbeds(prev);
        activateVideoEmbeds(slides[idx]);
        if (announce) {
          postToParent('SLIDE_CHANGE', {
            publishId,
            slideIndex: idx,
            slideId: currentSlideId(),
            totalSlides: slides.length,
          });
        }
      }

      function next() {
        if (!slides.length) return;
        if (idx >= slides.length - 1) {
          if (!loop) return;
          show(0);
          return;
        }
        show(idx + 1);
      }

      function prev() {
        if (!slides.length) return;
        if (idx <= 0) {
          if (!loop) return;
          show(slides.length - 1);
          return;
        }
        show(idx - 1);
      }

      function goTo(i) {
        show(Number(i || 0) || 0);
      }

      function toggleFullscreen() {
        if (!allowFullscreen) return;
        const el = document.documentElement;
        if (!document.fullscreenElement) {
          const p = el.requestFullscreen && el.requestFullscreen();
          if (p && p.catch) p.catch(() => {});
        } else {
          const p = document.exitFullscreen && document.exitFullscreen();
          if (p && p.catch) p.catch(() => {});
        }
      }

      if (btnPrev) btnPrev.addEventListener('click', () => prev());
      if (btnNext) btnNext.addEventListener('click', () => next());
      if (btnFs) {
        btnFs.style.display = allowFullscreen ? '' : 'none';
        btnFs.addEventListener('click', () => toggleFullscreen());
      }

      // Optional language switch: reload iframe with ?lang=... while preserving other embed options.
      function setEmbedLang(next) {
        const l = next === 'nl' || next === 'en-GB' ? next : null;
        if (!l) return;
        try {
          const u = new URL(location.href);
          u.searchParams.set('lang', l);
          location.href = u.toString();
        } catch {}
      }
      function syncLangUi() {
        if (!btnLangNl || !btnLangEn) return;
        const show = langSwitch && hasOtherLang;
        btnLangNl.style.display = show ? '' : 'none';
        btnLangEn.style.display = show ? '' : 'none';
        btnLangNl.classList.toggle('is-active', lang === 'nl');
        btnLangEn.classList.toggle('is-active', lang === 'en-GB');
      }
      if (btnLangNl) btnLangNl.addEventListener('click', () => setEmbedLang('nl'));
      if (btnLangEn) btnLangEn.addEventListener('click', () => setEmbedLang('en-GB'));
      syncLangUi();

      // Keyboard navigation (works when iframe is focused)
      window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); next(); }
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); prev(); }
        if (e.key === 'Home') { e.preventDefault(); show(0); }
        if (e.key === 'End') { e.preventDefault(); show(slides.length - 1); }
        if (e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFullscreen(); }
      });

      function originAllowed(origin) {
        if (!allowedOrigins.length) return true;
        if (allowedOrigins.includes('*')) return true;
        return allowedOrigins.includes(String(origin || ''));
      }

      window.addEventListener('message', (ev) => {
        try {
          if (ev.source !== window.parent) return;
          if (!originAllowed(ev.origin)) return;
          const data = ev.data || {};
          if (!data || data.source !== EMBED_SOURCE) return;
          const type = String(data.type || '');
          const payload = data.payload && typeof data.payload === 'object' ? data.payload : {};

          if (type === 'NEXT') return next();
          if (type === 'PREV') return prev();
          if (type === 'GOTO') return goTo(payload.slideIndex);
          if (type === 'GET_STATE') {
            return postToParent('STATE', {
              publishId,
              slideIndex: idx,
              slideId: currentSlideId(),
              totalSlides: slides.length,
            });
          }
          if (type === 'SET_OPTIONS') {
            if (typeof payload.controls === 'boolean') controls = payload.controls;
            if (typeof payload.loop === 'boolean') loop = payload.loop;
            if (typeof payload.allowFullscreen === 'boolean') allowFullscreen = payload.allowFullscreen;
            if (payload.ui === 'min' || payload.ui === 'default') ui = payload.ui;
            if (Array.isArray(payload.allowedOrigins))
              allowedOrigins = payload.allowedOrigins.map((x) => String(x || '').trim()).filter(Boolean);
            if (typeof payload.langSwitch === 'boolean') langSwitch = payload.langSwitch;

            if (root) root.classList.toggle('ui-min', ui === 'min');
            if (controlsEl) controlsEl.style.display = controls ? '' : 'none';
            if (btnFs) btnFs.style.display = allowFullscreen ? '' : 'none';
            syncLangUi();
            if (payload.start != null) show(Number(payload.start || 0) || 0);
            return;
          }
        } catch (e) {
          postToParent('ERROR', { message: String(e && e.message ? e.message : e) });
        }
      });

      // Initial render + announce READY
      show(idx, { announce: false });
      postToParent('READY', { publishId, totalSlides: slides.length });
      postToParent('STATE', {
        publishId,
        slideIndex: idx,
        slideId: currentSlideId(),
        totalSlides: slides.length,
      });
    </script>
  </body>
</html>`;
}