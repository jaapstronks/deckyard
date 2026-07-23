import { notFound } from '../../utils/http.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { getPresentation } from '../../storage/presentations.js';
import { getPublishedById } from '../../storage/published.js';
import { loadTheme } from '../../utils/themes.js';
import { buildMergedSlideTypes } from '../../utils/custom-slide-type-runtime.js';
import { getDefaultOrganizationId } from '../../config/database.js';
import { buildEmbedHtml, parseEmbedOptionsFromUrl } from '../../utils/embed-html.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import {
  hasLangVersion,
  otherLang,
  projectPresentationForLang,
  resolveLangModeFromPresOrUrl,
} from '../../utils/i18n.js';
import { analyticsHeadHtml } from '../../analytics/head.js';
import { readAppSettings } from '../../storage/settings.js';
import { log } from './log.js';

/**
 * Published embed player (iframe-friendly, public, no auth). Kept iframe-safe:
 * render failures return a styled HTML page, never JSON or a thrown error.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
export async function handleEmbed({ repoRoot, req, res, url }) {
  const embedMatch = url.pathname.match(/^\/embed\/([a-f0-9]{8})(?:-([^/]+))?$/);
  if (!embedMatch || req.method !== 'GET') return false;

  const publishId = embedMatch[1];
  const reqSlug = String(embedMatch[2] || '').trim();
  const entry = await getPublishedById(repoRoot, publishId);
  if (!entry?.presentationId) {
    notFound(res);
    return true;
  }

  const pres = await getPresentation(repoRoot, entry.presentationId);
  if (!pres) {
    notFound(res);
    return true;
  }

  const slug = String(entry.slug || '').trim() || 'presentation';
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
    return true;
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
    return true;
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
      log.error(
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
    return true;
  }
}
