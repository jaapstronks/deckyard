import {
  appendQuery,
  bgClass,
  bunnyEmbedUrlFromInput,
  cryptoUuid,
  escapeHtml,
  pickAltText,
  vimeoEmbedUrl,
  youtubeEmbedUrl,
  BACKGROUND_FIELD,
} from '../helpers.js';
import { bunnyPlayerColors } from './video-slide/player-colors.js';

export default {
  structure: 'singleton',
  // Content, not image: this type carries a title and a URL and no image field
  // at all, so image-slide's contract would hold none of it. The fallback is
  // chosen on what holds the content, not on family resemblance.
  fallback: 'content-slide',
  runtime: 'static',
  // The only type the PPTX export composes rather than photographs: the MP4
  // goes in as real embedded media, so it still plays in PowerPoint. A picture
  // of a video is not a video, which is why this one earned a mapper first.
  fidelity: { pptx: 'native' },
  // The Bunny library a bare video UUID embeds against belongs to whoever
  // owns the Bunny account, so core cannot name one — but an installation
  // that owns one should not have to type it on every slide either. The
  // declaration is the route: configuration seeds the authoring default, the
  // slide stores it, and every surface keeps reading `content.bunnyLibraryId`
  // as it already did. Vocabulary and rationale in
  // shared/slide-types/config-defaults.js (B653).
  configDefaults: { bunnyLibraryId: 'bunny-library-id' },
  label: 'Video',
  fields: [
    {
      key: 'title',
      role: 'heading',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: false,
      maxLength: 100,
    },
    {
      key: 'source',
      essential: true,
      label:
        'Video URL or Bunny ID (YouTube/Vimeo URL, Bunny embed URL, or Bunny video UUID)',
      type: 'string',
      required: true,
      maxLength: 400,
      // What this slide *is*, so it is content and not `presentational` — a
      // reader that dropped it would lose the video from the document. But it
      // is a reference, not document text: half its accepted values are a bare
      // Bunny UUID, which the reflowable projection used to print verbatim as
      // `<p>3045cc09-…</p>`. `mediaRef` says so once (D82): the projection
      // renders a stand-in named by `label`, linked when a link can be
      // resolved, and folds in the author's own `linkKey` field.
      mediaRef: { label: 'Video', linkKey: 'watchUrl' },
    },
    {
      key: 'transcript',
      label: 'Transcript',
      type: 'markdown',
      required: false,
      // A transcript of a few minutes of speech; the cap is a sanity bound,
      // not an editorial one.
      maxLength: 20000,
      // The text version of the video (D138). The canvas plays the video and
      // never shows this; the reader and print project it as prose under the
      // stand-in link, which is where a document puts what the film says.
      // Captions and audio description stay with the provider (`<track>` is
      // not ours to serve).
      role: 'prose',
      helpText:
        'Not shown on the slide. The reader document and the print version show it under the link to the video.',
      // Author-supplied, not inferable: an agent has not watched the video, so
      // anything it wrote here would be an invented transcript.
      ai: false,
    },
    BACKGROUND_FIELD,
    {
      key: 'autoplay',
      label: 'Autoplay',
      type: 'enum',
      required: false,
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
      ],
    },
    {
      key: 'watchUrl',
      label: 'Watch link for the PDF export',
      type: 'string',
      required: false,
      maxLength: 400,
      helpText:
        'Shown in the PDF export and the reader document instead of the generated link. Use it for a short, readable URL.',
      // Author-chosen, not inferable: it points at a real landing page (a
      // shortened link, a campaign page) that only a human knows exists.
      ai: false,
    },
    {
      key: 'bunnyLibraryId',
      label: 'Bunny library ID',
      type: 'string',
      required: false,
      maxLength: 20,
      helpText:
        'The video library in your own Bunny Stream account (Stream > Video Library). A pasted Bunny play or embed URL already carries one; a bare video UUID needs this.',
      // Infrastructure, not content: the id belongs to whoever owns the Bunny
      // account, and an invented one silently yields an empty player. Agents
      // supply `source` and inherit the configured library.
      ai: false,
      // The same sentence, said to the reader: an account number is not
      // document text, so the reader view must not print it as a paragraph.
      presentational: true,
    },
  ],
  defaults: {
    title: '',
    watchUrl: '',
    transcript: '',
    // No video: a new video slide is an empty one, and the only video core
    // could write here was one fork's (B650 left it as an inert UUID; B653
    // took it out, because an instance that configures its own library would
    // suddenly have resolved that stranger's id against it). The slide shows
    // its own "paste a link" state until the author pastes one. What an *agent*
    // gets offered as a worked example is `aiExamples` in ./video-slide/ai.js,
    // which is a separate question from what the editor pre-fills.
    source: '',
    background: 'mist',
    autoplay: 'off',
    // Empty in core and seeded from configuration where there is any: see
    // `configDefaults` above. Without a library the bare-UUID form of `source`
    // embeds nothing, which is the honest answer rather than a guess.
    bunnyLibraryId: '',
  },
  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background);
    const isThumb = ctx?.mode === 'thumb';
    const autoplayOn = !isThumb && content?.autoplay === 'on';
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-inline-field="title" dir="auto">${escapeHtml(content.title.trim())}</h2>`
        : '';

    const sourceRaw = String(content?.source || '').trim();

    const yt = youtubeEmbedUrl(sourceRaw);
    const vm = vimeoEmbedUrl(sourceRaw);
    // The field goes through as authored: the helper owns what a library id
    // has to be, and there is no fallback to fill in, because a library is
    // instance configuration and core owns none (B650).
    const bunny = bunnyEmbedUrlFromInput(sourceRaw, {
      libraryId: content?.bunnyLibraryId,
    });

    let embed = '';
    let embedNoAutoplay = '';
    let embedAutoplay = '';
    let provider = '';
    let needsPlayerJs = false;
    if (yt) {
      provider = 'youtube';
      embedNoAutoplay = appendQuery(
        yt,
        isThumb ? { autoplay: 0, mute: 1 } : { autoplay: 0 },
      );
      embedAutoplay = appendQuery(yt, { autoplay: 1, mute: 1 });
    } else if (vm) {
      provider = 'vimeo';
      embedNoAutoplay = appendQuery(
        vm,
        isThumb ? { autoplay: 0, muted: 1 } : { autoplay: 0 },
      );
      embedAutoplay = appendQuery(vm, { autoplay: 1, muted: 1 });
    } else if (bunny) {
      provider = 'bunny';
      // Slide chrome, so the player reads the theme like every other slide
      // colour; a theme that names none keeps Bunny's own default (B648).
      const playerColors = bunnyPlayerColors(ctx?.theme);
      embedNoAutoplay = appendQuery(bunny, {
        // Thumbnails must never produce sound (or autoplay).
        ...(isThumb
          ? { autoplay: 'false', muted: 'true' }
          : { autoplay: 'false' }),
        preload: 'true',
        responsive: 'true',
        ...playerColors,
      });
      embedAutoplay = appendQuery(bunny, {
        autoplay: 'true',
        loop: 'true',
        muted: 'true',
        preload: 'true',
        responsive: 'true',
        ...playerColors,
      });
      needsPlayerJs = !isThumb;
    }

    // Critical: in the interactive app, slides are often rendered before they are active.
    // If we bake autoplay into the iframe src, the video can start playing while hidden.
    // So we always render a non-autoplay src, and store the desired autoplay src in data-*.
    embed = isThumb ? embedNoAutoplay : embedNoAutoplay;

    const iframeId = `video-${escapeHtml(slide?.id || cryptoUuid())}`;
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
                src="${escapeHtml(embed)}"
                title="${escapeHtml(iframeTitle)}"
                frameborder="0"
                loading="lazy"
                allow="${allow}"
                allowfullscreen
                data-video-provider="${escapeHtml(provider)}"
                data-video-src-noautoplay="${escapeHtml(embedNoAutoplay)}"
                ${autoplayOn && embedAutoplay ? `data-video-src-autoplay="${escapeHtml(embedAutoplay)}"` : ''}
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
