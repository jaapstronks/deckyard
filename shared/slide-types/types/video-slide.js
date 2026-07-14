import {
  appendQuery,
  bgClass,
  BUNNY_PLAYER_COLORS,
  bunnyEmbedUrlFromInput,
  cryptoUuid,
  esc,
  pickAltText,
  vimeoEmbedUrl,
  youtubeEmbedUrl,
  BACKGROUND_FIELD,
} from '../helpers.js';

export default {
  label: 'Video',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 100,
    },
    {
      key: 'source',
      label:
        'Video URL or Bunny ID (YouTube/Vimeo URL, Bunny embed URL, or Bunny video UUID)',
      type: 'string',
      required: true,
      maxLength: 400,
    },
    BACKGROUND_FIELD,
    {
      key: 'autoplay',
      label: 'Autoplay',
      type: 'enum',
      required: false,
      options: ['off', 'on'],
    },
    {
      key: 'bunnyLibraryId',
      label: 'Bunny library ID',
      type: 'string',
      required: false,
      maxLength: 20,
    },
  ],
  defaults: {
    title: '',
    // Default Bunny video: "Ride the immersive wave"
    source: '3045cc09-605c-40d9-aa76-9ace93e7f637',
    background: 'mist',
    autoplay: 'off',
    bunnyLibraryId: '366590',
  },
  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background || 'mist');
    const isThumb = ctx?.mode === 'thumb';
    const autoplayOn = !isThumb && content?.autoplay === 'on';
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';

    const sourceRaw = String(content?.source || '').trim();
    const libId =
      typeof content?.bunnyLibraryId === 'string' && content.bunnyLibraryId.trim()
        ? content.bunnyLibraryId.trim()
        : '366590';

    const yt = youtubeEmbedUrl(sourceRaw);
    const vm = vimeoEmbedUrl(sourceRaw);
    const bunny = bunnyEmbedUrlFromInput(sourceRaw, {
      libraryId: libId,
    });

    let embed = '';
    let embedNoAutoplay = '';
    let embedAutoplay = '';
    let provider = '';
    let needsPlayerJs = false;
    if (yt) {
      provider = 'youtube';
      embedNoAutoplay = appendQuery(yt, isThumb ? { autoplay: 0, mute: 1 } : { autoplay: 0 });
      embedAutoplay = appendQuery(yt, { autoplay: 1, mute: 1 });
    } else if (vm) {
      provider = 'vimeo';
      embedNoAutoplay = appendQuery(vm, isThumb ? { autoplay: 0, muted: 1 } : { autoplay: 0 });
      embedAutoplay = appendQuery(vm, { autoplay: 1, muted: 1 });
    } else if (bunny) {
      provider = 'bunny';
      embedNoAutoplay = appendQuery(bunny, {
        // Thumbnails must never produce sound (or autoplay).
        ...(isThumb ? { autoplay: 'false', muted: 'true' } : { autoplay: 'false' }),
        preload: 'true',
        responsive: 'true',
        ...BUNNY_PLAYER_COLORS,
      });
      embedAutoplay = appendQuery(bunny, {
        autoplay: 'true',
        loop: 'true',
        muted: 'true',
        preload: 'true',
        responsive: 'true',
        ...BUNNY_PLAYER_COLORS,
      });
      needsPlayerJs = !isThumb;
    }

    // Critical: in the interactive app, slides are often rendered before they are active.
    // If we bake autoplay into the iframe src, the video can start playing while hidden.
    // So we always render a non-autoplay src, and store the desired autoplay src in data-*.
    embed = isThumb ? embedNoAutoplay : embedNoAutoplay;

    const iframeId = `video-${esc(slide?.id || cryptoUuid())}`;
    const allow = isThumb
      ? 'accelerometer; gyroscope; encrypted-media; picture-in-picture; fullscreen'
      : 'accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen';
    const iframeTitle = pickAltText({
      explicit: content?.title,
      fallbacks: [provider ? `${provider} video` : '', 'Video'],
      hardFallback: 'Video',
    });
    const frame = embed
      ? `
            <div class="video-frame">
              <iframe
                id="${iframeId}"
                class="video-iframe"
                src="${esc(embed)}"
                title="${esc(iframeTitle)}"
                frameborder="0"
                loading="lazy"
                allow="${allow}"
                allowfullscreen
                data-video-provider="${esc(provider)}"
                data-video-src-noautoplay="${esc(embedNoAutoplay)}"
                ${autoplayOn && embedAutoplay ? `data-video-src-autoplay="${esc(embedAutoplay)}"` : ''}
                ${autoplayOn && embedAutoplay ? 'data-video-autoplay="1"' : 'data-video-autoplay="0"'}
                ${needsPlayerJs ? 'data-bunny-playerjs="1"' : ''}
              ></iframe>
            </div>
          `
      : `
            <div class="video-empty">
              <div class="help">Paste a YouTube/Vimeo URL or a Bunny video UUID.</div>
            </div>
          `;

    return `
        <div class="slide slide-video ${bg}">
          <div class="slide-inner">
            ${title}
            ${frame}
          </div>
        </div>
      `;
  },
};
