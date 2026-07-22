import path from 'node:path';
import fs from 'node:fs/promises';
import { notFound, serveFile } from '../utils/http.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';
import { getPresentation } from '../storage/presentations.js';
import { getPublishedById } from '../storage/published.js';
import { buildStandaloneHtml } from '../export/html.js';
import { buildReaderHtml } from '../export/reader.js';
import { loadTheme } from '../utils/themes.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { getDefaultOrganizationId } from '../config/database.js';
import { getAppName } from '../config/branding.js';
import {
  buildEmbedHtml,
  parseEmbedOptionsFromUrl,
} from '../utils/embed-html.js';
import { sandboxEnabled } from '../config/sandbox.js';
import { ensureSandboxUser } from '../auth/sandbox.js';
import {
  hasLangVersion,
  otherLang,
  projectPresentationForLang,
  resolveLangModeFromPresOrUrl,
} from '../utils/i18n.js';
import { isClientDebugLogEnabled } from '../utils/debug-log.js';
import { sandboxAppSeoHeadHtml } from '../utils/sandbox-seo.js';
import { renderSandboxOgImagePng } from '../utils/sandbox-og-image.js';
import { analyticsHeadHtml } from '../analytics/head.js';
import { getShareLinkByToken } from '../storage/share-links.js';
import { generateTrackingScriptHtml } from '../analytics/tracking-script.js';
import { readAppSettings } from '../storage/settings.js';
import { handleFeed } from './feed.js';
import { getOrganizationById } from '../storage/user-organizations.js';
import { getOrgSettings } from '../utils/org-settings.js';
import { isRssFeedEnabled } from '../config/features.js';

export async function handleStatic({
  repoRoot,
  req,
  res,
  url,
  clientDir,
  sharedPublicDirs,
}) {
  async function serveAppIndex() {
    const htmlPath = path.join(clientDir, 'index.html');
    const raw = await fs.readFile(htmlPath, 'utf8');
    let html = raw;
    // Sandbox SEO + OG tags (root indexed, internal SPA routes noindex).
    const seo = sandboxAppSeoHeadHtml(req, { path: url?.pathname || '/' });
    if (seo) {
      html = html.replace('</head>', `  ${seo}\n</head>`);
    }
    if (isClientDebugLogEnabled()) {
      html = html.replace(
        '</head>',
        `  <script>window.__DEBUG_LOG__=true;</script>\n</head>`
      );
    }
    const appSettings = await readAppSettings(repoRoot);
    const analytics = analyticsHeadHtml({
      context: 'app',
      sandbox: sandboxEnabled(),
      settings: appSettings,
    });
    if (analytics) {
      html = html.replace('</head>', `  ${analytics}</head>`);
    }
    // RSS/Atom/JSON feed auto-discovery links
    try {
      if (isRssFeedEnabled()) {
        const feedOrgId = getDefaultOrganizationId();
        const feedOrg = await getOrganizationById(feedOrgId);
        const feedSettings = getOrgSettings(feedOrg);
        if (feedSettings.rss?.enabled) {
          const feedLinks = [
            '<link rel="alternate" type="application/rss+xml" title="Presentations (RSS)" href="/feed/rss.xml">',
            '<link rel="alternate" type="application/atom+xml" title="Presentations (Atom)" href="/feed/atom.xml">',
            '<link rel="alternate" type="application/feed+json" title="Presentations (JSON)" href="/feed/feed.json">',
          ].join('\n    ');
          html = html.replace('</head>', `    ${feedLinks}\n</head>`);
        }
      }
    } catch {
      // Feed discovery is nice-to-have, don't fail the app shell
    }
    // Sandbox mode: assign a guest session cookie on first HTML load so the app can create isolated decks.
    if (sandboxEnabled()) {
      try {
        ensureSandboxUser(req, res);
      } catch {
        // best-effort; never fail app shell
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    // IMPORTANT: App UI must be theme-independent. Do not inject theme vars into the app shell.
    res.end(html);
  }

  // RSS/Atom/JSON feed routes (public, no auth)
  if (url.pathname.startsWith('/feed/')) {
    const handled = await handleFeed({ repoRoot, req, res, url });
    if (handled) return;
  }

  // Follow code entry page (static asset; kept out of this router for maintainability)
  if (
    (url.pathname === '/go' || url.pathname === '/go/') &&
    req.method === 'GET'
  ) {
    const fsPath = path.join(clientDir, 'go.html');
    return serveFile(res, fsPath);
  }

  // Published embed player (iframe-friendly, public, no auth)
  const embedMatch = url.pathname.match(
    /^\/embed\/([a-f0-9]{8})(?:-([^/]+))?$/
  );
  if (embedMatch && req.method === 'GET') {
    const publishId = embedMatch[1];
    const reqSlug = String(embedMatch[2] || '').trim();
    const entry = await getPublishedById(
      repoRoot,
      publishId
    );
    if (!entry?.presentationId) return notFound(res);

    const pres = await getPresentation(
      repoRoot,
      entry.presentationId
    );
    if (!pres) return notFound(res);

    const slug =
      String(entry.slug || '').trim() || 'presentation';
    const canonicalPath = `/embed/${publishId}-${slug}`;

    // Only redirect when a slug is provided but incorrect.
    // (If slug is omitted, keep it working for simple iframe use.)
    if (reqSlug && reqSlug !== slug) {
      const qs = url.search ? url.search : '';
      res.writeHead(302, {
        Location: `${canonicalPath}${qs}`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    const opts = parseEmbedOptionsFromUrl(url);
    const theme = await loadTheme(repoRoot, pres?.theme);
    const modeLang = resolveLangModeFromPresOrUrl(pres, url);
    const projected = projectPresentationForLang(pres, modeLang);
    const embedSettings = await readAppSettings(repoRoot);
    const analytics = analyticsHeadHtml({
      context: 'embed',
      sandbox: sandboxEnabled(),
      settings: embedSettings,
    });
    const embedOrgId = pres?.organizationId || getDefaultOrganizationId();
    const embedSlideTypes = await buildMergedSlideTypes({ organizationId: embedOrgId });

    try {
      const html = buildEmbedHtml(repoRoot, projected, {
        publishId,
        theme,
        lang: modeLang,
        hasOtherLang: hasLangVersion(pres, otherLang(modeLang)),
        headHtml: analytics,
        slideTypes: embedSlideTypes,
        ...opts,
      });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    } catch (e) {
      // Important: keep embed iframe-friendly even if something goes wrong.
      // If we let this throw, `server/server.js` will return JSON, which is a terrible UX in Notion/iframes.
      // Info-disclosure guard: this is the unauthenticated /embed surface, so
      // never leak the error message or stack (absolute paths, module layout)
      // to visitors in production — dev keeps them for debugging
      // (security-audit H6).
      const isDev = process.env.NODE_ENV !== 'production';
      const msgRaw = String(e?.message || e);
      const msg = escapeHtml(msgRaw);
      const stackRaw = typeof e?.stack === 'string' ? e.stack : '';
      const stack = escapeHtml(stackRaw);
      try {
        // eslint-disable-next-line no-console
        console.error(
          `[embed] render failed publishId=${publishId} slug=${slug} url=${url.pathname}${url.search}\n${stackRaw || msgRaw}`
        );
      } catch {
        // ignore
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Embed error</title>
    <style>
      body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; background: #0b0f0e; color: rgba(255,255,255,0.92); }
      .wrap { padding: 18px; }
      .card { background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 14px; padding: 14px; max-width: 900px; }
      .title { font-weight: 700; margin: 0 0 8px; }
      .help { opacity: 0.85; margin: 0; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="title">Deze presentatie kan nu niet worden geladen</p>
        <p class="help">Publicatie-ID: <code>${escapeHtml(publishId)}</code></p>
        ${isDev ? `<p class="help">Foutmelding: <code>${msg}</code></p>` : ''}
        ${
          isDev && stackRaw
            ? `<details style="margin-top:10px;">
            <summary style="cursor:pointer; opacity:0.9;">Technische details</summary>
            <pre style="white-space:pre-wrap; word-break:break-word; font-size:12px; opacity:0.9; margin:10px 0 0;">${stack}</pre>
          </details>`
            : ''
        }
      </div>
    </div>
  </body>
</html>`);
      return;
    }
  }

  // Semantic reflowable "reader" view of a published deck (open web, no auth).
  // A JS-optional, accessible document projection of the same model; the canvas
  // page lives at /p/:id-:slug. Served at /p/:id-:slug/reader.
  const pubReaderMatch = url.pathname.match(
    /^\/p\/([a-f0-9]{8})(?:-([^/]+))?\/reader$/
  );
  if (pubReaderMatch && req.method === 'GET') {
    const publishId = pubReaderMatch[1];
    const reqSlug = String(pubReaderMatch[2] || '').trim();
    const entry = await getPublishedById(repoRoot, publishId);
    if (!entry?.presentationId) return notFound(res);

    const pres = await getPresentation(repoRoot, entry.presentationId);
    if (!pres) return notFound(res);

    const slug = String(entry.slug || '').trim() || 'presentation';
    const canonicalCanvasPath = `/p/${publishId}-${slug}`;
    if (!reqSlug || reqSlug !== slug) {
      res.writeHead(302, {
        Location: `${canonicalCanvasPath}/reader`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    const modeLang = resolveLangModeFromPresOrUrl(pres, url);
    const projected = projectPresentationForLang(pres, modeLang);
    const orgId = pres?.organizationId || getDefaultOrganizationId();
    const slideTypes = await buildMergedSlideTypes({ organizationId: orgId });
    const readerHeadHtml = `<meta name="robots" content="${
      sandboxEnabled() ? 'noindex,nofollow' : 'index,follow'
    }" />`;

    const html = buildReaderHtml(repoRoot, projected, {
      context: 'published',
      slideTypes,
      canonicalUrl: `${canonicalCanvasPath}?lang=${encodeURIComponent(modeLang)}`,
      headHtml: readerHeadHtml,
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  // Published public pages (open web, no auth)
  const pubMatch = url.pathname.match(
    /^\/p\/([a-f0-9]{8})(?:-([^/]+))?$/
  );
  if (pubMatch && req.method === 'GET') {
    const publishId = pubMatch[1];
    const reqSlug = String(pubMatch[2] || '').trim();
    const entry = await getPublishedById(
      repoRoot,
      publishId
    );
    if (!entry?.presentationId) return notFound(res);

    const pres = await getPresentation(
      repoRoot,
      entry.presentationId
    );
    if (!pres) return notFound(res);

    const slug =
      String(entry.slug || '').trim() || 'presentation';
    const canonicalPath = `/p/${publishId}-${slug}`;
    if (!reqSlug || reqSlug !== slug) {
      res.writeHead(302, {
        Location: canonicalPath,
        'Cache-Control': 'no-store',
      });
      res.end();
      return;
    }

    const proto =
      (req.headers['x-forwarded-proto'] &&
        String(req.headers['x-forwarded-proto'])
          .split(',')[0]
          .trim()) ||
      'http';
    const host = req.headers.host || 'localhost';
    const origin = `${proto}://${host}`;
    const modeLang = resolveLangModeFromPresOrUrl(pres, url);
    const projected = projectPresentationForLang(pres, modeLang);
    const canonicalUrl = new URL(
      `${canonicalPath}?lang=${encodeURIComponent(modeLang)}`,
      origin
    ).href;
    const ogImageAbs = entry.ogImageUrl
      ? new URL(entry.ogImageUrl, origin).href
      : new URL(
          '/assets/images/slides-previewimage.png',
          origin
        ).href;

    const title = escapeHtml(projected.title || 'Presentation');
    const rawDesc =
      typeof pres?.description === 'string' ? pres.description.trim() : '';
    const descriptionRaw =
      rawDesc ||
      `Bekijk de presentatie “${projected.title || 'Presentation'}”.`;
    const description = escapeHtml(descriptionRaw);
    const sandboxNoindex = sandboxEnabled();
    // The plain <meta name="description"> is emitted by buildStandaloneHtml
    // (via the `description` option below) so exports carry it too; only the
    // OG/Twitter description variants live here.

    // Semantic reader view of this deck (open web, no-JS a11y surface).
    const readerPath = `${canonicalPath}/reader`;
    const readerLabel = modeLang === 'nl' ? 'Leesweergave' : 'Reading view';

    // Structured data: a published deck is a schema.org PresentationDigitalDocument.
    const ldDescription =
      rawDesc ||
      `Bekijk de presentatie “${projected.title || 'Presentation'}”.`;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'PresentationDigitalDocument',
      name: projected.title || 'Presentation',
      description: ldDescription,
      url: canonicalUrl,
      thumbnailUrl: ogImageAbs,
      inLanguage: modeLang,
    };
    if (typeof pres?.ownerName === 'string' && pres.ownerName.trim()) {
      jsonLd.author = { '@type': 'Person', name: pres.ownerName.trim() };
    }
    if (typeof pres?.createdAt === 'string' && pres.createdAt.trim()) {
      jsonLd.datePublished = pres.createdAt.trim();
    }
    // Escape `<` so a value can never break out of the <script> block.
    const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(
      jsonLd
    ).replace(/</g, '\\u003c')}</script>`;

    const headHtml = `
    <meta name="robots" content="${sandboxNoindex ? 'noindex,nofollow' : 'index,follow'}" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="alternate" href="${escapeHtml(readerPath)}" title="${escapeHtml(readerLabel)}" />

    <!-- Open Graph -->
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${escapeHtml(sandboxNoindex ? `${getAppName()} Sandbox` : getAppName())}" />
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

    ${jsonLdScript}
    `.trim();
    const publishedSettings = await readAppSettings(repoRoot);
    const analytics = analyticsHeadHtml({
      context: 'published',
      sandbox: sandboxNoindex,
      settings: publishedSettings,
    });

    const hasOther = hasLangVersion(pres, otherLang(modeLang));
    const switchHtml = hasOther
      ? (() => {
          const nlHref = `${canonicalPath}?lang=nl`;
          const enHref = `${canonicalPath}?lang=en-GB`;
          return `
            <div class="sb-segmented" style="width: 140px;" role="group" aria-label="Language">
              <a class="sb-segmented-btn ${modeLang === 'nl' ? 'is-active' : ''}" href="${escapeHtml(nlHref)}" rel="nofollow">NL</a>
              <a class="sb-segmented-btn ${modeLang === 'en-GB' ? 'is-active' : ''}" href="${escapeHtml(enHref)}" rel="nofollow">EN</a>
            </div>
          `.trim();
        })()
      : '';

    // Visible link to the semantic reader view (discoverable a11y/no-JS surface).
    const readerLinkHtml = `<a class="presenter-help ps-reader-link" href="${escapeHtml(
      readerPath
    )}" rel="alternate" style="text-decoration: underline; white-space: nowrap;">${escapeHtml(
      readerLabel
    )}</a>`;

    const theme = await loadTheme(repoRoot, pres?.theme);

    // Add analytics tracking script for published pages
    const trackingScript = generateTrackingScriptHtml({
      presentationId: entry.presentationId,
      sourceType: 'published',
      sourceId: publishId,
    });

    const orgId = pres?.organizationId || getDefaultOrganizationId();
    const slideTypes = await buildMergedSlideTypes({ organizationId: orgId });

    const html = await buildStandaloneHtml(repoRoot, projected, {
      headHtml: `${headHtml}\n${analytics}\n${trackingScript}`.trim(),
      topbarRightHtml: `${switchHtml}${readerLinkHtml}`,
      theme,
      slideTypes,
      context: 'published', // Use published visibility filter
      presentationId: entry.presentationId,
      description: descriptionRaw,
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  // Sandbox OG image (generated server-side, no binary assets committed).
  if (url.pathname === '/og/sandbox.png' && req.method === 'GET') {
    try {
      const buf = await renderSandboxOgImagePng();
      res.writeHead(200, {
        'Content-Type': 'image/png',
        // Cache for a day; safe because the image is not user-specific.
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(buf);
      return;
    } catch (e) {
      // Fall back to the existing generic preview image.
      const fsPath = path.join(repoRoot, 'assets', 'images', 'slides-previewimage.png');
      return serveFile(res, fsPath);
    }
  }

  // Serve known static dirs
  for (const { urlPrefix, dir } of sharedPublicDirs) {
    if (url.pathname.startsWith(urlPrefix)) {
      const relRaw = url.pathname.slice(urlPrefix.length);
      // Decode URL-escaped paths (e.g. spaces => %20) so filenames with spaces work.
      // Also prevent path traversal after decoding.
      let rel = relRaw;
      try {
        rel = decodeURIComponent(relRaw);
      } catch {
        rel = relRaw;
      }

      const base = path.resolve(dir);
      const fsPath = path.resolve(base, rel);
      if (
        fsPath !== base &&
        !fsPath.startsWith(base + path.sep)
      ) {
        return notFound(res);
      }

      // /uploads/ is user-controlled content: serve risky types (SVG) inert.
      return serveFile(res, fsPath, { userUpload: urlPrefix === '/uploads/' });
    }
  }

  // Share link viewer (public, token-based access)
  // Serves the app shell with og: metadata for rich link previews
  const shareMatch = url.pathname.match(/^\/s\/([^/]+)$/);
  if (shareMatch && req.method === 'GET') {
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
              String(req.headers['x-forwarded-proto'])
                .split(',')[0]
                .trim()) ||
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
            rawDesc ||
              `Bekijk de presentatie "${pres.title || 'Presentation'}".`
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
    const htmlPath = path.join(clientDir, 'index.html');
    const raw = await fs.readFile(htmlPath, 'utf8');
    let html = raw;

    // Replace default og: tags with presentation-specific ones
    if (ogHeadHtml) {
      // Remove existing meta description
      html = html.replace(/<meta name="description"[^>]*>/gi, '');
      // Remove existing Open Graph tags
      html = html.replace(/<!-- Open Graph -->[\s\S]*?<!-- Twitter -->/i, '<!-- Open Graph -->\n  <!-- Twitter -->');
      html = html.replace(/<meta property="og:[^"]*"[^>]*>/gi, '');
      // Remove existing Twitter tags
      html = html.replace(/<meta name="twitter:[^"]*"[^>]*>/gi, '');
      // Inject presentation-specific tags
      html = html.replace('</head>', `  ${ogHeadHtml}\n</head>`);
    }

    // Sandbox SEO + OG tags (root indexed, internal SPA routes noindex).
    const seo = sandboxAppSeoHeadHtml(req, { path: url?.pathname || '/' });
    if (seo) {
      html = html.replace('</head>', `  ${seo}\n</head>`);
    }
    if (isClientDebugLogEnabled()) {
      html = html.replace(
        '</head>',
        `  <script>window.__DEBUG_LOG__=true;</script>\n</head>`
      );
    }
    const shareSettings = await readAppSettings(repoRoot);
    const analytics = analyticsHeadHtml({
      context: 'app',
      sandbox: sandboxEnabled(),
      settings: shareSettings,
    });
    if (analytics) {
      html = html.replace('</head>', `  ${analytics}</head>`);
    }
    // Sandbox mode: assign a guest session cookie on first HTML load so the app can create isolated decks.
    if (sandboxEnabled()) {
      try {
        ensureSandboxUser(req, res);
      } catch {
        // best-effort; never fail app shell
      }
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(html);
    return;
  }

  // App routes
  if (
    url.pathname === '/' ||
    url.pathname === '/index.html'
  ) {
    return serveAppIndex();
  }
  if (url.pathname === '/login') {
    return serveAppIndex();
  }
  if (url.pathname === '/forgot-password' || url.pathname === '/reset-password' || url.pathname === '/magic-login') {
    return serveAppIndex();
  }
  if (
    url.pathname.startsWith('/app') ||
    url.pathname.startsWith('/settings') ||
    url.pathname.startsWith('/present') ||
    url.pathname.startsWith('/notes') ||
    url.pathname.startsWith('/notes-join') ||
    url.pathname.startsWith('/follow') ||
    url.pathname.startsWith('/analytics') ||
    url.pathname.startsWith('/reports') ||
    url.pathname.startsWith('/insights')
  ) {
    return serveAppIndex();
  }

  return notFound(res);
}
