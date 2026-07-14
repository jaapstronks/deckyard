(function (global) {
  'use strict';

  const EMBED_SOURCE = 'presentation-system-embed';

  function isEl(x) {
    return !!x && typeof x === 'object' && x.nodeType === 1;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function toBool01(v) {
    if (v == null) return null;
    return v ? 1 : 0;
  }

  function normalizeAspectRatio(ar) {
    const n = Number(ar);
    if (!Number.isFinite(n) || n <= 0) return 16 / 9;
    return n;
  }

  function ensureUrl(baseUrl) {
    if (typeof baseUrl === 'string' && baseUrl.trim())
      return baseUrl.trim().replace(/\/+$/, '');
    return String(
      global.location && global.location.origin
        ? global.location.origin
        : ''
    ).replace(/\/+$/, '');
  }

  function buildEmbedSrc({
    baseUrl,
    publishId,
    slug,
    options,
  }) {
    const base = ensureUrl(baseUrl);
    const pid = String(publishId || '').trim();
    if (!pid) throw new Error('publishId is required');
    const s = typeof slug === 'string' ? slug.trim() : '';

    const path = s
      ? `/embed/${pid}-${encodeURIComponent(s)}`
      : `/embed/${pid}`;
    const url = new URL(path, base);

    const opt =
      options && typeof options === 'object' ? options : {};

    const controls = toBool01(opt.controls);
    if (controls != null)
      url.searchParams.set('controls', String(controls));

    const loop = toBool01(opt.loop);
    if (loop != null)
      url.searchParams.set('loop', String(loop));

    const allowFs = toBool01(opt.allowFullscreen);
    if (allowFs != null)
      url.searchParams.set(
        'allowFullscreen',
        String(allowFs)
      );

    if (opt.ui != null)
      url.searchParams.set('ui', String(opt.ui));

    // Language selection (optional): lets host pages embed a specific i18n version.
    if (opt.lang === 'nl' || opt.lang === 'en-GB')
      url.searchParams.set('lang', String(opt.lang));

    // Optional UI: show language switch inside the embed iframe (default off).
    const langSwitch = toBool01(opt.langSwitch);
    if (langSwitch != null)
      url.searchParams.set('langSwitch', String(langSwitch));

    if (opt.start != null)
      url.searchParams.set(
        'start',
        String(Math.max(0, Number(opt.start) || 0))
      );

    // postMessage origin allowlist for iframe to validate parent
    const allowedOrigins = Array.isArray(opt.allowedOrigins)
      ? opt.allowedOrigins
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      : [];
    if (allowedOrigins.length)
      url.searchParams.set(
        'allowedOrigins',
        allowedOrigins.join(',')
      );

    return url.toString();
  }

  function createEventEmitter() {
    const handlers = new Map();
    return {
      on(name, fn) {
        const k = String(name || '').toLowerCase();
        if (!k || typeof fn !== 'function') return () => {};
        const arr = handlers.get(k) || [];
        arr.push(fn);
        handlers.set(k, arr);
        return () => this.off(k, fn);
      },
      off(name, fn) {
        const k = String(name || '').toLowerCase();
        const arr = handlers.get(k) || [];
        handlers.set(
          k,
          arr.filter((x) => x !== fn)
        );
      },
      emit(name, payload) {
        const k = String(name || '').toLowerCase();
        const arr = handlers.get(k) || [];
        for (const fn of arr) {
          try {
            fn(payload);
          } catch (e) {}
        }
      },
    };
  }

  /**
   * createDeckEmbed({ el, publishId, options }) -> controller
   *
   * Options:
   * - baseUrl?: string
   * - controls?: boolean (default true)
   * - start?: number (default 0)
   * - loop?: boolean (default false)
   * - allowFullscreen?: boolean (default true)
   * - ui?: "min"|"default" (default "default")
   * - aspectRatio?: number (default 16/9)
   * - allowedOrigins?: string[] (default [location.origin])
   * - onReady?, onSlideChange?, onError? callbacks
   */
  function createDeckEmbed({
    el,
    publishId,
    options,
  } = {}) {
    if (!isEl(el))
      throw new Error('Expected { el: HTMLElement }');
    const opt =
      options && typeof options === 'object' ? options : {};

    // Default to allowing the current origin, so the iframe can validate its parent safely.
    const defaultAllowedOrigins =
      global.location && global.location.origin
        ? [global.location.origin]
        : [];
    if (!Array.isArray(opt.allowedOrigins))
      opt.allowedOrigins = defaultAllowedOrigins;

    const aspectRatio = normalizeAspectRatio(
      opt.aspectRatio
    );

    const wrap = document.createElement('div');
    wrap.className = 'ps-embed-wrap';
    // Aspect-ratio + fallback for older browsers
    wrap.style.position = 'relative';
    wrap.style.width = '100%';
    wrap.style.maxWidth = '100%';
    wrap.style.background = '#000';
    wrap.style.borderRadius = '12px';
    wrap.style.overflow = 'hidden';
    // Prefer native aspect-ratio, but provide a padding-top fallback for older browsers.
    let supportsAspectRatio = false;
    try {
      supportsAspectRatio = !!(
        global.CSS &&
        global.CSS.supports &&
        global.CSS.supports('aspect-ratio: 16 / 9')
      );
    } catch (e) {
      supportsAspectRatio = false;
    }
    if (supportsAspectRatio) {
      wrap.style.aspectRatio = String(aspectRatio);
      wrap.style.paddingTop = '';
    } else {
      // Old-school intrinsic ratio box fallback
      wrap.style.aspectRatio = '';
      wrap.style.paddingTop = `calc(100% / ${aspectRatio})`;
    }

    const inner = document.createElement('div');
    inner.style.position = 'absolute';
    inner.style.inset = '0';
    wrap.appendChild(inner);

    const iframe = document.createElement('iframe');
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = '0';
    iframe.loading = 'lazy';
    iframe.referrerPolicy =
      'strict-origin-when-cross-origin';
    iframe.allow =
      opt.allowFullscreen === false ? '' : 'fullscreen';
    if (opt.allowFullscreen !== false)
      iframe.setAttribute('allowfullscreen', '');
    iframe.title =
      typeof opt.title === 'string' && opt.title.trim()
        ? opt.title.trim()
        : 'Embedded presentation';

    const src = buildEmbedSrc({
      baseUrl: opt.baseUrl,
      publishId,
      slug: opt.slug,
      options: opt,
    });
    iframe.src = src;

    inner.appendChild(iframe);
    el.appendChild(wrap);

    const emitter = createEventEmitter();
    const iframeOrigin = new URL(src).origin;
    const lastState = {
      slideIndex: 0,
      slideId: '',
      totalSlides: 0,
      publishId: String(publishId || ''),
    };

    function dispatchDomEvent(name, detail) {
      try {
        wrap.dispatchEvent(
          new CustomEvent(name, { detail })
        );
      } catch (e) {
        // ignore
      }
    }

    function safeCall(fn, payload) {
      if (typeof fn !== 'function') return;
      try {
        fn(payload);
      } catch (e) {}
    }

    function postToIframe(type, payload) {
      try {
        if (!iframe.contentWindow) return;
        iframe.contentWindow.postMessage(
          {
            source: EMBED_SOURCE,
            type: String(type || ''),
            payload: payload || {},
          },
          iframeOrigin
        );
      } catch (e) {
        // ignore
      }
    }

    function onMessage(event) {
      if (!event || event.source !== iframe.contentWindow)
        return;
      if (event.origin !== iframeOrigin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== EMBED_SOURCE) return;
      const type = String(data.type || '');
      const payload =
        data.payload && typeof data.payload === 'object'
          ? data.payload
          : {};

      if (type === 'READY') {
        lastState.totalSlides =
          Number(payload.totalSlides || 0) || 0;
        emitter.emit('ready', payload);
        dispatchDomEvent('ready', payload);
        safeCall(opt.onReady, payload);
        return;
      }
      if (type === 'SLIDE_CHANGE') {
        lastState.slideIndex =
          Number(payload.slideIndex || 0) || 0;
        lastState.slideId = String(payload.slideId || '');
        emitter.emit('slidechange', payload);
        dispatchDomEvent('slidechange', payload);
        safeCall(opt.onSlideChange, payload);
        return;
      }
      if (type === 'STATE') {
        lastState.slideIndex =
          Number(payload.slideIndex || 0) || 0;
        lastState.slideId = String(payload.slideId || '');
        lastState.totalSlides =
          Number(
            payload.totalSlides || lastState.totalSlides
          ) || lastState.totalSlides;
        emitter.emit('state', payload);
        dispatchDomEvent('state', payload);
        return;
      }
      if (type === 'ERROR') {
        emitter.emit('error', payload);
        dispatchDomEvent('error', payload);
        safeCall(opt.onError, payload);
        return;
      }
    }

    global.addEventListener('message', onMessage);

    const controller = {
      next() {
        postToIframe('NEXT', {});
      },
      prev() {
        postToIframe('PREV', {});
      },
      goToSlide(i) {
        postToIframe('GOTO', {
          slideIndex: clamp(
            Number(i) || 0,
            0,
            Number.MAX_SAFE_INTEGER
          ),
        });
      },
      getState() {
        return { ...lastState };
      },
      destroy() {
        try {
          global.removeEventListener('message', onMessage);
        } catch {}
        try {
          wrap.remove();
        } catch {
          try {
            if (wrap.parentNode)
              wrap.parentNode.removeChild(wrap);
          } catch {}
        }
      },
      on(name, fn) {
        return emitter.on(name, fn);
      },
      off(name, fn) {
        return emitter.off(name, fn);
      },
      _iframe: iframe,
      _wrapper: wrap,
      _src: src,
    };

    return controller;
  }

  global.PresentationSystemEmbed =
    global.PresentationSystemEmbed || {};
  global.PresentationSystemEmbed.createDeckEmbed =
    createDeckEmbed;
})(typeof window !== 'undefined' ? window : globalThis);