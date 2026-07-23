import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { getPresentation } from '../../storage/presentations.js';
import { getShareLinkByToken } from '../../storage/share-links.js';
import { getAppName } from '../../config/branding.js';
import {
  readIndexHtml,
  injectSeoDebugAnalytics,
  ensureSandboxCookie,
  serveShellHtml,
} from './app-shell.js';

/**
 * Share-link viewer (public, token-based). Serves the app shell with
 * presentation-specific og: metadata injected for rich link previews.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
export async function handleShareLink({ repoRoot, req, res, url, clientDir }) {
  const shareMatch = url.pathname.match(/^\/s\/([^/]+)$/);
  if (!shareMatch || req.method !== 'GET') return false;

  const token = shareMatch[1];

  // Try to get presentation info for og: tags (best-effort, don't fail if unavailable)
  let ogHeadHtml = '';
  try {
    const shareLink = await getShareLinkByToken(token);
    if (shareLink?.presentationId) {
      const pres = await getPresentation(repoRoot, shareLink.presentationId);
      if (pres) {
        const proto =
          (req.headers['x-forwarded-proto'] &&
            String(req.headers['x-forwarded-proto']).split(',')[0].trim()) ||
          'http';
        const host = req.headers.host || 'localhost';
        const origin = `${proto}://${host}`;
        const canonicalUrl = new URL(url.pathname, origin).href;
        const ogImageAbs = new URL(
          '/assets/images/slides-previewimage.png',
          origin
        ).href;

        const title = escapeHtml(pres.title || 'Presentation');
        const rawDesc =
          typeof pres?.description === 'string' ? pres.description.trim() : '';
        const description = escapeHtml(
          rawDesc || `Bekijk de presentatie "${pres.title || 'Presentation'}".`
        );

        ogHeadHtml = `
    <meta name="description" content="${description}" />
    <meta name="robots" content="noindex,nofollow" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(getAppName())}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta property="og:image" content="${ogImageAbs}" />
    <meta property="og:image:width" content="1600" />
    <meta property="og:image:height" content="900" />

    <!-- Twitter -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${ogImageAbs}" />
          `.trim();
      }
    }
  } catch {
    // Silently ignore errors - og: tags are nice-to-have, not critical
  }

  // Serve app shell with injected og: tags if available
  let html = await readIndexHtml(clientDir);

  // Replace default og: tags with presentation-specific ones
  if (ogHeadHtml) {
    // Remove existing meta description
    html = html.replace(/<meta name="description"[^>]*>/gi, '');
    // Remove existing Open Graph tags
    html = html.replace(
      /<!-- Open Graph -->[\s\S]*?<!-- Twitter -->/i,
      '<!-- Open Graph -->\n  <!-- Twitter -->'
    );
    html = html.replace(/<meta property="og:[^"]*"[^>]*>/gi, '');
    // Remove existing Twitter tags
    html = html.replace(/<meta name="twitter:[^"]*"[^>]*>/gi, '');
    // Inject presentation-specific tags
    html = html.replace('</head>', `  ${ogHeadHtml}\n</head>`);
  }

  html = await injectSeoDebugAnalytics(html, { req, url, repoRoot });
  ensureSandboxCookie(req, res);
  serveShellHtml(res, html);
  return true;
}
