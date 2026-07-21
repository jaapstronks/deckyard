import { renderSlideHtml } from '../utils/render-slide.js';
import { stripFontFacesFromCss } from '../utils/embed-fonts.js';
import { stripLiveOnlySlidesFromPresentation } from '../utils/public-output.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import {
  escapeHtml,
  embedImgSrcDataUrls,
} from '../utils/html-utils.js';
import { buildPrismKatexCdnTags, buildPrismKatexInitScript } from '../utils/prism-katex.js';
import { renderVideoSlidePngHtml } from '../utils/video-slide-html.js';
import { loadExportCssBundle, embedSlideImages } from './css-bundle.js';

export async function buildSlidesPngExportHtml(
  repoRoot,
  pres,
  { theme = null, watermark = null, slideTypes = null } = {}
) {
  pres = stripLiveOnlySlidesFromPresentation(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  const css = await loadExportCssBundle(repoRoot, theme, watermark);

  const titleRaw = pres.title || 'Presentation';
  const title = escapeHtml(titleRaw);

  // Embed uploads referenced as field values (shared cache dedupes the same
  // source across this pass and the rendered-HTML pass below).
  const embedCache = new Map();
  const slides = await embedSlideImages(repoRoot, pres.slides, { cache: embedCache });

  let slidesHtml = slides
    .map((s, idx) => {
      const slideHtml =
        s?.type === 'video-slide'
          ? renderVideoSlidePngHtml(s)
          : renderSlideHtml(s, { theme, slideTypes });
      return `<div class="png-item" data-idx="${idx}">
        <div class="png-thumb ps-theme">${css.wmHtml}${slideHtml}</div>
        <div class="png-actions">
          <button class="btn btn-secondary png-one">Download slide ${idx + 1}</button>
          <span class="png-status" aria-live="polite"></span>
        </div>
      </div>`;
    })
    .join('\n');

  // Embed any remaining <img src="/uploads|/assets|/client/..."> into data URLs.
  slidesHtml = await embedImgSrcDataUrls(repoRoot, slidesHtml, {
    includeClient: true,
    cache: embedCache,
  });

  return `<!doctype html>
<html lang="${escapeHtml(docLang)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} (PNG Export)</title>
    ${buildPrismKatexCdnTags()}
    <style id="pngExportCss">
${css.fontCss}
${stripFontFacesFromCss(css.appCss)}
${css.themeVarsCss}
${css.themeCss}
${stripFontFacesFromCss(css.slidesCss)}
${css.wmCss}
      /* PNG export is static; disable animated gradients so the result is deterministic. */
      .ps-theme { --t-gradient-enabled: 0; }
    </style>
    <style>
      body { margin: 0; background: #0f1413; color: #fff; }
      .toolbar {
        position: sticky;
        top: 0;
        z-index: 10;
        padding: 12px 16px;
        background: rgba(0,0,0,0.72);
        display: flex;
        gap: 10px;
        align-items: center;
      }
      .toolbar .btn { border-radius: 6px; }
      .wrap { max-width: 980px; margin: 0 auto; padding: 16px; }
      .hint { opacity: 0.82; font-size: 13px; }
      .list { display: grid; gap: 14px; margin-top: 14px; }
      .png-item {
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 12px;
        padding: 12px;
        background: rgba(255,255,255,0.04);
      }
      .png-actions { display: flex; gap: 10px; align-items: center; margin-top: 10px; }
      .png-status { opacity: 0.8; font-size: 12px; }

      .png-thumb {
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.12);
        background: rgba(0,0,0,0.25);
        aspect-ratio: 16 / 9;
        position: relative;
        --thumb-scale: 0.18;
      }
      .png-thumb .slide {
        position: absolute;
        top: 0;
        left: 0;
        width: 1600px;
        height: 900px;
        transform: scale(var(--thumb-scale));
        transform-origin: top left;
        max-width: none;
        max-height: none;
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div style="flex:1">${title}</div>
      <button class="btn btn-primary" id="btnAll">Download all PNGs</button>
      <label class="hint" style="display:flex; gap:8px; align-items:center;">
        <span>Scale</span>
        <select id="scaleSel" class="form-input" style="width:auto;">
          <option value="1">1x (1600×900)</option>
          <option value="2" selected>2x (3200×1800)</option>
        </select>
      </label>
    </div>
    <div class="wrap">
      <div class="hint">
        "Download all PNGs" levert alle slides als één ZIP-bestand. Of download een losse slide met de knop eronder.
      </div>
      <div class="list" id="list">
        ${slidesHtml}
      </div>
    </div>
    <script>
      (function() {
        const SLIDE_W = 1600;
        const SLIDE_H = 900;

        function currentScale() {
          return Number(document.getElementById('scaleSel')?.value || 2) || 2;
        }

        function slideUrl(idx1) {
          const scale = currentScale();
          // Preserve current query params (notably lang=...) when requesting individual PNG files.
          let u;
          try { u = new URL(location.href); } catch { u = null; }
          const basePath = location.pathname + '/' + String(idx1) + '.png';
          if (!u) return basePath + '?scale=' + encodeURIComponent(String(scale));
          u.pathname = basePath;
          u.searchParams.set('scale', String(scale));
          return u.pathname + '?' + u.searchParams.toString();
        }

        function zipUrl() {
          const scale = currentScale();
          // The preview page lives at .../export/png ; the bundle is .../export/png.zip
          let u;
          try { u = new URL(location.href); } catch { u = null; }
          const basePath = location.pathname.replace(/\\/png$/, '/png.zip');
          if (!u) return basePath + '?scale=' + encodeURIComponent(String(scale));
          u.pathname = basePath;
          u.searchParams.set('scale', String(scale));
          return u.pathname + '?' + u.searchParams.toString();
        }

        function layoutThumbs() {
          const thumbs = document.querySelectorAll('.png-thumb');
          for (const el of thumbs) {
            const r = el.getBoundingClientRect();
            const scale = Math.min(r.width / SLIDE_W, r.height / SLIDE_H);
            el.style.setProperty('--thumb-scale', String(scale));
          }
        }

        async function downloadOne(itemEl, idx) {
          const status = itemEl.querySelector('.png-status');
          const url = slideUrl(idx + 1);
          status.textContent = 'Downloading…';
          // Trigger download (server sets Content-Disposition: attachment)
          const a = document.createElement('a');
          a.href = url;
          a.rel = 'noopener noreferrer';
          a.target = '_blank';
          document.body.appendChild(a);
          a.click();
          a.remove();
          status.textContent = 'Started download.';
          setTimeout(() => { status.textContent = ''; }, 1500);
        }

        const items = Array.from(document.querySelectorAll('.png-item'));
        items.forEach((itemEl) => {
          const idx = Number(itemEl.dataset.idx || 0) || 0;
          const btn = itemEl.querySelector('.png-one');
          btn?.addEventListener('click', async () => {
            try { await downloadOne(itemEl, idx); }
            catch (e) {
              const status = itemEl.querySelector('.png-status');
              if (status) status.textContent = String(e?.message || e);
            }
          });
        });

        // Download all slides as a single ZIP. Triggering N separate downloads
        // does not work: after the first one the browser blocks the rest (the
        // user gesture is lost across the awaits), so only the first slide
        // actually downloaded. One ZIP is one download, so it always completes.
        let busy = false;
        const btnAll = document.getElementById('btnAll');
        document.getElementById('btnAll')?.addEventListener('click', async () => {
          if (busy) return;
          busy = true;
          const label = btnAll ? btnAll.textContent : '';
          if (btnAll) { btnAll.disabled = true; btnAll.textContent = 'Preparing ZIP…'; }
          try {
            const a = document.createElement('a');
            a.href = zipUrl();
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            a.remove();
          } catch (e) {
            alert(String(e?.message || e));
          } finally {
            // Re-enable after a beat; the download itself is handled by the browser.
            setTimeout(() => {
              if (btnAll) { btnAll.disabled = false; btnAll.textContent = label; }
              busy = false;
            }, 1200);
          }
        });

        window.addEventListener('resize', layoutThumbs);
        setTimeout(layoutThumbs, 50);
        setTimeout(layoutThumbs, 250);

        ${buildPrismKatexInitScript()}
      })();
    </script>
  </body>
</html>`;
}
