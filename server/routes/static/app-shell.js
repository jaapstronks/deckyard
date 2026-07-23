import path from 'node:path';
import fs from 'node:fs/promises';
import { sandboxAppSeoHeadHtml } from '../../utils/sandbox-seo.js';
import { isClientDebugLogEnabled } from '../../utils/debug-log.js';
import { readAppSettings } from '../../storage/settings.js';
import { analyticsHeadHtml } from '../../analytics/head.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import { ensureSandboxUser } from '../../auth/sandbox.js';
import { isRssFeedEnabled } from '../../config/features.js';
import { getDefaultOrganizationId } from '../../config/database.js';
import { getOrganizationById } from '../../storage/user-organizations.js';
import { getOrgSettings } from '../../utils/org-settings.js';

/** Read the SPA shell (client/index.html). */
export async function readIndexHtml(clientDir) {
  const htmlPath = path.join(clientDir, 'index.html');
  return fs.readFile(htmlPath, 'utf8');
}

/**
 * Inject the head fragments common to every app-shell response: sandbox SEO/OG
 * tags, the client debug flag, and analytics. Shared by the app index and the
 * share-link viewer so both stay in sync.
 * @param {string} html
 * @param {{ req: import('http').IncomingMessage, url: URL, repoRoot: string }} ctx
 * @returns {Promise<string>}
 */
export async function injectSeoDebugAnalytics(html, { req, url, repoRoot }) {
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
  return html;
}

/**
 * Sandbox mode: assign a guest session cookie on first HTML load so the app can
 * create isolated decks. Best-effort — never fail the app shell.
 */
export function ensureSandboxCookie(req, res) {
  if (sandboxEnabled()) {
    try {
      ensureSandboxUser(req, res);
    } catch {
      // best-effort; never fail app shell
    }
  }
}

/** Send an app-shell HTML response (never cached). */
export function serveShellHtml(res, html) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  // IMPORTANT: App UI must be theme-independent. Do not inject theme vars into the app shell.
  res.end(html);
}

/**
 * Inject RSS/Atom/JSON feed auto-discovery links when the default org has RSS
 * enabled. Feed discovery is nice-to-have — never fail the app shell.
 */
async function injectFeedDiscovery(html, repoRoot) {
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
  return html;
}

/**
 * Serve the SPA app shell (index.html) with SEO, debug, analytics and feed
 * discovery injected.
 * @param {import('./static-files.js').StaticContext} ctx
 */
export async function serveAppIndex({ repoRoot, req, res, url, clientDir }) {
  let html = await readIndexHtml(clientDir);
  html = await injectSeoDebugAnalytics(html, { req, url, repoRoot });
  html = await injectFeedDiscovery(html, repoRoot);
  ensureSandboxCookie(req, res);
  serveShellHtml(res, html);
}

/**
 * SPA routes that all resolve to the app shell (`/`, auth pages, and the
 * app-prefixed sections).
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
export async function handleAppRoutes(ctx) {
  const { url } = ctx;
  const p = url.pathname;
  if (p === '/' || p === '/index.html') {
    await serveAppIndex(ctx);
    return true;
  }
  if (p === '/login') {
    await serveAppIndex(ctx);
    return true;
  }
  if (p === '/forgot-password' || p === '/reset-password' || p === '/magic-login') {
    await serveAppIndex(ctx);
    return true;
  }
  if (
    p.startsWith('/app') ||
    p.startsWith('/settings') ||
    p.startsWith('/present') ||
    p.startsWith('/notes') ||
    p.startsWith('/notes-join') ||
    p.startsWith('/follow') ||
    p.startsWith('/analytics') ||
    p.startsWith('/reports') ||
    p.startsWith('/insights')
  ) {
    await serveAppIndex(ctx);
    return true;
  }
  return false;
}
