/**
 * Persistent video overlay layer for live presentations.
 *
 * Usage:
 *   const vl = createVideoLayer({ containerEl, getCurrentSlide });
 *   vl.setConfig(pres.settings.liveVideo);   // configure + start
 *   vl.updatePosition();                      // call on slide change
 *   vl.destroy();                             // cleanup
 */

import {
  detectStreamProvider,
  buildEmbedUrl,
  isIframeProvider,
  resolvePosition,
} from '../../shared/video-stream-providers.js';
import { ensureHlsJs } from './ensure-hls.js';
import { t } from './ui-i18n.js';

/**
 * @param {Object} opts
 * @param {HTMLElement} opts.containerEl - Stage wrapper to append the layer to
 * @param {() => Object|null} opts.getCurrentSlide - Returns current slide object
 * @returns {{ setConfig, updatePosition, show, hide, destroy, el }}
 */
export function createVideoLayer({ containerEl, getCurrentSlide }) {
  // --- DOM scaffold ---
  const el = document.createElement('div');
  el.className = 'video-layer';
  el.dataset.visible = 'false';

  const playerWrap = document.createElement('div');
  playerWrap.className = 'video-layer-player';

  const controlsWrap = document.createElement('div');
  controlsWrap.className = 'video-layer-controls';

  const unmuteBtn = document.createElement('button');
  unmuteBtn.className = 'video-layer-unmute';
  unmuteBtn.textContent = t('video.unmute', 'Unmute');
  unmuteBtn.type = 'button';
  unmuteBtn.setAttribute('aria-label', t('video.unmuteAria', 'Unmute video stream'));
  controlsWrap.append(unmuteBtn);

  el.append(playerWrap, controlsWrap);
  containerEl.append(el);

  // --- State ---
  let config = null;      // liveVideo settings object
  let provider = null;
  let embedUrl = '';
  let hlsInstance = null;
  let playerEl = null;    // <iframe> or <video>
  let unmuted = false;

  // --- Unmute handler ---
  unmuteBtn.addEventListener('click', () => {
    unmuted = true;
    unmuteBtn.hidden = true;
    if (playerEl?.tagName === 'VIDEO') {
      playerEl.muted = false;
    } else if (playerEl?.tagName === 'IFRAME') {
      // For iframes we can't directly unmute; replace the iframe URL without mute param.
      // YouTube: remove &mute=1; Vimeo/Bunny/Cloudflare: muted=false
      try {
        const src = playerEl.src || '';
        const u = new URL(src);
        u.searchParams.delete('mute');
        u.searchParams.delete('muted');
        // Cloudflare and Bunny use muted=true/false
        if (provider === 'cloudflare' || provider === 'bunny') {
          u.searchParams.set('muted', 'false');
        }
        playerEl.src = u.toString();
      } catch {
        // ignore
      }
    }
  });

  // --- Build / replace player element ---
  function buildPlayer() {
    destroyPlayer();

    if (!embedUrl) return;

    if (isIframeProvider(provider)) {
      const iframe = document.createElement('iframe');
      iframe.src = embedUrl;
      iframe.title = t('video.iframeTitle', 'Live video stream');
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
      iframe.allowFullscreen = true;
      iframe.setAttribute('frameborder', '0');
      playerWrap.append(iframe);
      playerEl = iframe;
    } else {
      // Native <video> for HLS / Mux / DASH
      const video = document.createElement('video');
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.loop = false;
      video.controls = false;
      playerWrap.append(video);
      playerEl = video;

      if (provider === 'hls' || provider === 'mux') {
        // Use hls.js if the browser doesn't support HLS natively
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = embedUrl;
        } else {
          ensureHlsJs()
            .then(() => {
              if (!globalThis.Hls?.isSupported?.()) {
                showError(t('video.error.hlsUnsupported', 'HLS is not supported in this browser.'));
                return;
              }
              hlsInstance = new globalThis.Hls();
              hlsInstance.loadSource(embedUrl);
              hlsInstance.attachMedia(video);
              hlsInstance.on(globalThis.Hls.Events.ERROR, (_e, data) => {
                if (data.fatal)
                  showError(t('video.error.stream', 'Stream error. Check the URL.'));
              });
            })
            .catch(() =>
              showError(t('video.error.hlsLoadFailed', 'Failed to load HLS player.'))
            );
        }
      } else {
        // DASH or unknown native - just set src (dash.js deferred to v2)
        video.src = embedUrl;
      }
    }

    unmuted = false;
    unmuteBtn.hidden = false;
  }

  function destroyPlayer() {
    if (hlsInstance) {
      try { hlsInstance.destroy(); } catch { /* ignore */ }
      hlsInstance = null;
    }
    playerWrap.innerHTML = '';
    playerEl = null;
    el.querySelector('.video-layer-error')?.remove();
  }

  function showError(msg) {
    el.querySelector('.video-layer-error')?.remove();
    const errEl = document.createElement('div');
    errEl.className = 'video-layer-error';
    errEl.textContent = msg;
    el.append(errEl);
  }

  // --- Position ---
  function applyPosition(pos) {
    if (!pos) return;
    el.style.left = `${pos.x}%`;
    el.style.top = `${pos.y}%`;
    el.style.width = `${pos.width}%`;
  }

  // --- Public API ---

  function setConfig(liveVideo) {
    config = liveVideo && typeof liveVideo === 'object' ? liveVideo : null;

    if (!config?.enabled || !config?.streamUrl) {
      hide();
      destroyPlayer();
      return;
    }

    const detectedProvider = config.provider || detectStreamProvider(config.streamUrl);
    const newEmbedUrl = buildEmbedUrl(config.streamUrl, detectedProvider);

    if (newEmbedUrl === embedUrl && provider === detectedProvider) {
      // Config unchanged - just ensure visibility
      show();
      updatePosition();
      return;
    }

    provider = detectedProvider;
    embedUrl = newEmbedUrl;

    if (!embedUrl) {
      hide();
      showError(t('video.error.embedFailed', 'Unable to embed this stream URL.'));
      return;
    }

    buildPlayer();
    show();
    updatePosition();
  }

  function updatePosition() {
    if (!config?.enabled) return;

    const slide = typeof getCurrentSlide === 'function' ? getCurrentSlide() : null;
    const override = slide?.content?.videoOverride;

    // Per-slide visibility override
    if (override && override.visible === false) {
      el.dataset.visible = 'false';
      return;
    }
    el.dataset.visible = 'true';

    // Per-slide position override or deck default
    const preset = override?.position || config?.defaultPosition || 'pip-top-right';
    applyPosition(resolvePosition(preset));

    // Mobile position via data attribute (CSS handles the rest)
    el.dataset.mobilePosition = config?.mobilePosition || 'bottom';
  }

  function show() {
    el.dataset.visible = 'true';
  }

  function hide() {
    el.dataset.visible = 'false';
  }

  function destroy() {
    destroyPlayer();
    try { el.remove(); } catch { /* ignore */ }
  }

  return { setConfig, updatePosition, show, hide, destroy, el };
}
