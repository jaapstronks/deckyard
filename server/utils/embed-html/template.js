import { escapeHtml } from './helpers.js';
import { DEFAULT_THEME_ID } from '../../../shared/constants/themes.js';
import { repoRoot as defaultRepoRoot } from '../../config/paths.js';
import { buildCssChain } from '../css-chain.js';
import { buildDocumentHead } from '../head-chain.js';
import { buildScriptChain } from '../script-chain.js';
import { buildPrismKatexTags, detectPrismKatexNeeds } from '../prism-katex.js';
import {
  getLangDisplayName,
  normalizeLang,
} from '../../../shared/i18n-utils.js';

/**
 * The embed shell's own CSS: iframe-friendly chrome around the deck, no app
 * assumptions. The three core stylesheets above it are <link>ed (the embed is a
 * served page, not a bundled export), so this is the last inline layer before
 * the fork seam — which `buildCssChain` appends. See server/utils/css-chain.js.
 */
const EMBED_SHELL_CSS = `
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
`;

/**
 * The embed runtime: one slide at a time inside an iframe, driven by the host
 * page over postMessage (NEXT/PREV/GOTO/GET_STATE/SET_OPTIONS) and by the bar
 * of controls above the stage.
 *
 * Path-specific, so it is a body handed to the script chain rather than part
 * of it. Video embeds and stage scaling used to sit inside here as a
 * byte-for-byte copy of the standalone export's; they now come from
 * `runtime: 'stage'` (server/utils/script-chain.js).
 */
const EMBED_RUNTIME_JS = `

      const EMBED_SOURCE = 'presentation-system-embed';

      function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
      function safeJsonParse(s) { try { return JSON.parse(s); } catch { return null; } }

      const bootEl = document.getElementById('boot');
      const boot = safeJsonParse(bootEl ? bootEl.textContent : '') || {};
      const publishId = String(boot.publishId || '');
      const totalSlides = Math.max(0, Number(boot.totalSlides || 0) || 0);
      const options = boot.options && typeof boot.options === 'object' ? boot.options : {};
      // boot is server-produced and already normalized against the deck axis
      // (see buildEmbedHtml); boot.versionLangs carries the versions THIS deck
      // has, so the switch below offers exactly those and can validate a
      // navigation without a second copy of any language list living in this
      // inlined script (B149/D61, B182/D72 #6).
      const versionLangs = Array.isArray(boot.versionLangs) ? boot.versionLangs : [];
      const lang = typeof boot.lang === 'string' && boot.lang ? boot.lang : null;
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
      const slides = Array.from(document.querySelectorAll('.deck-slide'));
      const btnPrev = document.getElementById('btnPrev');
      const btnNext = document.getElementById('btnNext');
      const btnFs = document.getElementById('btnFs');
      const progress = document.getElementById('progress');
      const langBtns = Array.from(document.querySelectorAll('[data-embed-lang]'));

      attachStageScale();

      // Poll slides were removed as a standalone feature (no poll runtime here).

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
        const l = versionLangs.includes(next) ? next : null;
        if (!l) return;
        try {
          const u = new URL(location.href);
          u.searchParams.set('lang', l);
          location.href = u.toString();
        } catch {}
      }
      function syncLangUi() {
        // The group is only rendered when the deck has more than one version,
        // so there is nothing to show or hide on a single-language deck.
        for (const btn of langBtns) {
          btn.style.display = langSwitch ? '' : 'none';
          btn.classList.toggle('is-active', lang === btn.dataset.embedLang);
        }
      }
      for (const btn of langBtns) {
        btn.addEventListener('click', () => setEmbedLang(btn.dataset.embedLang));
      }
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
`;

export function renderEmbedHtmlDocument({
  repoRoot = defaultRepoRoot,
  title = 'Presentation',
  docLang = 'nl',
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
  const mode = ui === 'min' ? 'min' : 'default';
  const safeTotalSlides = Math.max(0, Number(totalSlides || 0) || 0);
  const safeBoot = {
    publishId: String(boot?.publishId || publishId || ''),
    totalSlides: safeTotalSlides,
    options:
      boot?.options && typeof boot.options === 'object' ? boot.options : {},
    lang: normalizeLang(boot?.lang),
    versionLangs: Array.isArray(boot?.versionLangs)
      ? boot.versionLangs.map(normalizeLang).filter(Boolean)
      : [],
  };
  // A <script> block is raw text, so HTML entities inside it are never decoded.
  // This payload used to go through escapeHtml(), which wrote `&quot;` into the
  // JSON and made `JSON.parse()` fail on every embed ever served — the runtime
  // then silently ran on its defaults: no slide count, no language switch, no
  // allowed-origin list. Escaping only `<` is what the block actually needs
  // (nothing else can end it) and it leaves the JSON valid, which is the same
  // treatment the published page gives its JSON-LD.
  const bootScriptJson = JSON.stringify(safeBoot, null, 0).replace(
    /</g,
    '\\u003c',
  );

  const docThemeId = String(themeId || DEFAULT_THEME_ID);
  const themeVars = String(themeVarsCss || '');
  const extraHead = String(headHtml || '');
  const extraFontHtml = String(externalFontHtml || '');
  const wmCss = String(watermarkCss || '');
  const wmHtml = String(watermarkHtml || '');
  // Same gate as the export paths: a deck with no code block and no formula
  // requests nothing from a CDN. The embed used to emit neither the libraries
  // nor the initialiser, so a code block that highlighted in the download and
  // in /p/ rendered plain here — the one visible cost of six script assemblers.
  const highlightNeeds = detectPrismKatexNeeds(slidesHtml || '');

  // One button per version the deck has, in the order the versions were
  // written — not a fixed `NL EN` pair, which offered an English button on a
  // deck that had no English version (B182/D72 #6). Below two versions there
  // is nothing to switch between, so the group is left out entirely; the
  // runtime still hides what is here unless `langSwitch` is on.
  const langSwitchHtml =
    safeBoot.versionLangs.length > 1
      ? `<div class="sb-segmented" aria-label="Language">
            ${safeBoot.versionLangs
              .map(
                (l) =>
                  `<button data-embed-lang="${escapeHtml(l)}" class="sb-segmented-btn" type="button" lang="${escapeHtml(l)}">${escapeHtml(
                    getLangDisplayName(l),
                  )}</button>`,
              )
              .join('\n            ')}
          </div>`
      : '';
  return `${buildDocumentHead({
    lang: docLang,
    htmlAttrs: { 'data-theme': docThemeId },
    title: title || 'Presentation',
    robots: 'noindex,nofollow',
    head: [
      extraHead,
      extraFontHtml,
      // The embed is served by this server, so it links the vendored copies
      // and the browser caches them across decks.
      buildPrismKatexTags({ ...highlightNeeds, mode: 'linked' }),
    ],
    stylesheets: [
      '/assets/fonts/google/fonts.css',
      '/client/styles/embed.css',
      '/client/styles/theme.css',
      '/client/styles/slides.css',
    ],
    styles: [
      { id: 'ps-theme-vars', css: themeVars },
      buildCssChain(repoRoot, [EMBED_SHELL_CSS, wmCss]),
    ],
  })}
  <body>
    <div class="ps-embed ui-${escapeHtml(mode)}">
      <div class="ps-embed-controls" role="toolbar" aria-label="Presentation controls">
        <div class="row">
          <button id="btnPrev" class="btn btn-secondary" type="button" aria-label="Previous slide">←</button>
          <button id="btnNext" class="btn btn-secondary" type="button" aria-label="Next slide">→</button>
          <div id="progress" class="ps-embed-progress" aria-live="polite"></div>
        </div>
        <div class="row">
          ${langSwitchHtml}
          <button id="btnFs" class="btn btn-secondary" type="button" aria-label="Fullscreen">⛶</button>
        </div>
      </div>
      <div class="ps-embed-deck-wrap">
        <main id="deck" class="deck" aria-live="polite">
          <div id="stageWrap" class="ps-embed-stage-wrap">
            <div id="stage" class="ps-embed-stage ps-theme">
              ${wmHtml}
              ${slidesHtml || ''}
            </div>
          </div>
        </main>
      </div>
    </div>

    <script id="boot" type="application/json">${bootScriptJson}</script>
    ${buildScriptChain({
      runtime: 'stage',
      module: true,
      needs: highlightNeeds,
      body: EMBED_RUNTIME_JS,
    })}
  </body>
</html>`;
}
