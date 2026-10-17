import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { countDeckView } from '../../storage/instance-health.js';
import { validateShareLink } from '../../storage/share-links/index.js';
import { getAppName, getOgImageUrl } from '../../config/branding.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';
import {
  getSlideCopy,
  fillCopy,
} from '../../../shared/slide-types/slide-copy.js';
import {
  readIndexHtml,
  injectSeoDebugAnalytics,
  injectLinkPreview,
  ensureSandboxCookie,
  serveShellHtml,
} from './app-shell.js';

/**
 * Share-link viewer (public, token-based). Serves the app shell with
 * presentation-specific og: metadata injected for rich link previews.
 *
 * Only a live link unfurls with its deck: a revoked, expired or spent token
 * keeps the shell's generic preview, so pasting a withdrawn link names no deck.
 * The fallback description is in the deck's language (`shareLinkDescription`).
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
async function serveShareLink({ repoRoot, req, res, url, clientDir }, token) {
  // Try to get presentation info for og: tags (best-effort, don't fail if unavailable)
  let ogHeadHtml = '';
  try {
    const validation = await validateShareLink(token);
    const shareLink = validation.ok ? validation.shareLink : null;
    if (shareLink?.presentationId) {
      const pres = await getPresentation(
        crossOrganizationScope(
          repoRoot,
          'share link: the share token is the authorization',
        ),
        shareLink.presentationId,
      );
      if (pres) {
        countDeckView('share', pres);
        const proto =
          (req.headers['x-forwarded-proto'] &&
            String(req.headers['x-forwarded-proto']).split(',')[0].trim()) ||
          'http';
        const host = req.headers.host || 'localhost';
        const origin = `${proto}://${host}`;
        const canonicalUrl = new URL(url.pathname, origin).href;
        const ogImageAbs = new URL(getOgImageUrl(), origin).href;

        const copy = getSlideCopy(resolveDeckLang(pres));
        const rawTitle = pres.title || copy.readerDocument;
        const title = escapeHtml(rawTitle);
        const rawDesc =
          typeof pres?.description === 'string' ? pres.description.trim() : '';
        const description = escapeHtml(
          rawDesc || fillCopy(copy.shareLinkDescription, { title: rawTitle }),
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
  let html = injectLinkPreview(await readIndexHtml(clientDir));

  // Replace default og: tags with presentation-specific ones
  if (ogHeadHtml) {
    // Remove existing meta description
    html = html.replace(/<meta\s+name="description"[^>]*>/gi, '');
    // Remove existing Open Graph tags
    html = html.replace(
      /<!-- Open Graph -->[\s\S]*?<!-- Twitter -->/i,
      '<!-- Open Graph -->\n  <!-- Twitter -->',
    );
    html = html.replace(/<meta\s+property="og:[^"]*"[^>]*>/gi, '');
    // Remove existing Twitter tags; the shell wraps the long ones over lines
    html = html.replace(/<meta\s+name="twitter:[^"]*"[^>]*>/gi, '');
    // Inject presentation-specific tags
    html = html.replace('</head>', `  ${ogHeadHtml}\n</head>`);
  }

  const shell = await injectSeoDebugAnalytics(html, { req, url, repoRoot });
  ensureSandboxCookie(req, res);
  serveShellHtml(res, shell);
  return true;
}

/** `/s/:token`. The token is a share-link token (`varchar(64)`), so `text`. */
export const ROUTES = [
  {
    method: 'GET',
    pattern: /^\/s\/([^/]+)$/,
    captures: ['text'],
    handler: serveShareLink,
  },
];

/**
 * Share-link viewer (public, token-based).
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>|false} true if handled.
 */
export function handleShareLink(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
