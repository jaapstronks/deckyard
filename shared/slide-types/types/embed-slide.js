import { bgClass, cryptoUuid, esc, BACKGROUND_FIELD } from '../helpers.js';

function normalizeEmbedUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  // Security: only allow HTTPS URLs
  if (!/^https:\/\//i.test(s)) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') return '';
    return u.toString();
  } catch {
    return '';
  }
}

function getSandboxValue(mode) {
  // 'restricted' - most secure, blocks scripts and forms
  // 'permissive' - allows scripts and forms for interactive content
  const m = String(mode || 'restricted').trim();
  if (m === 'permissive') {
    return 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox';
  }
  // Default: restricted (no scripts, no forms)
  return 'allow-same-origin';
}

export default {
  label: 'Embed',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: false,
      maxLength: 120,
    },
    {
      key: 'embedUrl',
      label: 'Embed URL (HTTPS only)',
      type: 'string',
      required: true,
      maxLength: 500,
    },
    {
      key: 'aspectRatio',
      label: 'Aspect ratio',
      type: 'enum',
      required: false,
      options: ['16:9', '4:3', '1:1', 'auto'],
    },
    {
      key: 'sandbox',
      label: 'Sandbox mode',
      type: 'enum',
      required: false,
      options: ['restricted', 'permissive'],
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      title: '',
      embedUrl: '',
      aspectRatio: '16:9',
      sandbox: 'restricted',
      background: 'lime',
    },
    'en-GB': {
      title: '',
      embedUrl: '',
      aspectRatio: '16:9',
      sandbox: 'restricted',
      background: 'lime',
    },
  },
  defaults: {
    title: '',
    embedUrl: '',
    aspectRatio: '16:9',
    sandbox: 'restricted',
    background: 'lime',
  },
  renderHtml: (content, slide, ctx) => {
    const bg = bgClass(content?.background || 'lime');
    const title =
      typeof content?.title === 'string' && content.title.trim()
        ? `<h2 class="heading" data-inline-field="title" dir="auto">${esc(content.title.trim())}</h2>`
        : '';

    const embedUrl = normalizeEmbedUrl(content?.embedUrl);
    const aspectRatio = String(content?.aspectRatio || '16:9').trim();
    const sandboxMode = String(content?.sandbox || 'restricted').trim();
    const sandboxAttr = getSandboxValue(sandboxMode);

    const aspectClass =
      aspectRatio === '4:3'
        ? 'embed-aspect-4-3'
        : aspectRatio === '1:1'
          ? 'embed-aspect-1-1'
          : aspectRatio === 'auto'
            ? 'embed-aspect-auto'
            : 'embed-aspect-16-9';

    const iframeId = `embed-${esc(slide?.id || cryptoUuid())}`;
    const iframeTitle =
      typeof content?.title === 'string' && content.title.trim()
        ? content.title.trim()
        : 'Embedded content';

    const frame = embedUrl
      ? `
          <div class="embed-frame ${aspectClass}">
            <iframe
              id="${iframeId}"
              class="embed-iframe"
              src="${esc(embedUrl)}"
              title="${esc(iframeTitle)}"
              frameborder="0"
              loading="lazy"
              sandbox="${esc(sandboxAttr)}"
              allow="fullscreen"
              allowfullscreen
              data-embed-url="${esc(embedUrl)}"
              data-sandbox-mode="${esc(sandboxMode)}"
            ></iframe>
          </div>
        `
      : `
          <div class="embed-empty">
            <div class="help">Paste an HTTPS URL to embed (e.g., Figma, Miro, Google Sheets).</div>
          </div>
        `;

    return `
      <div class="slide slide-embed ${bg}">
        <div class="slide-inner">
          ${title}
          ${frame}
        </div>
      </div>
    `;
  },
};