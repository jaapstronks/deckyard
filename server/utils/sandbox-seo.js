import { sandboxEnabled } from '../config/sandbox.js';
import { getRequestOrigin } from './request-url.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';

export function sandboxAppSeoHeadHtml(req, { path = '/' } = {}) {
  if (!sandboxEnabled()) return '';
  const origin = getRequestOrigin(req);
  const canonical = new URL(path || '/', origin).href;

  const title = 'Deckyard Sandbox';
  const description =
    'Try Deckyard in sandbox mode. No login required. Presentations expire after 24 hours.';
  const ogImage = new URL('/og/sandbox.png', origin).href;

  // Index the root landing; keep internal SPA routes out of search results.
  const isRoot = String(path || '/') === '/' || String(path || '/') === '/index.html';
  const robots = isRoot ? 'index,follow' : 'noindex,nofollow';

  return `
    <meta name="robots" content="${escapeHtml(robots)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="description" content="${escapeHtml(description)}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Deckyard" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${escapeHtml(ogImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
  `.trim();
}
