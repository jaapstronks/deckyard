import { notFound } from '../utils/http.js';
import { handleFeed } from './feed.js';
import { handleGo, handleStaticFiles } from './static/static-files.js';
import { handleUploadVariant } from './static/upload-variant.js';
import { handleEmbed } from './static/embed.js';
import { handlePublishedReader, handlePublishedPage } from './static/published.js';
import { handleSandboxOg } from './static/sandbox-og.js';
import { handleShareLink } from './static/share-viewer.js';
import { handleAppRoutes } from './static/app-shell.js';

/**
 * Terminal router for everything that is not `/api/*`: public/published pages,
 * embeds, feeds, static assets, and the SPA app shell. Each handler owns one
 * route family and returns true once it has written a response; the order below
 * is significant and mirrors the original if-chain (specific published/embed
 * routes before the generic static-dir and app-shell fallbacks).
 *
 * @param {import('./static/static-files.js').StaticContext} ctx
 */
export async function handleStatic(ctx) {
  const { repoRoot, req, res, url } = ctx;

  // RSS/Atom/JSON feed routes (public, no auth)
  if (url.pathname.startsWith('/feed/')) {
    const handled = await handleFeed({ repoRoot, req, res, url });
    if (handled) return;
  }

  if (handleGo(ctx)) return;
  if (await handleEmbed(ctx)) return;
  if (await handlePublishedReader(ctx)) return;
  if (await handlePublishedPage(ctx)) return;
  if (await handleSandboxOg(ctx)) return;
  if (await handleUploadVariant(ctx)) return;
  if (handleStaticFiles(ctx)) return;
  if (await handleShareLink(ctx)) return;
  if (await handleAppRoutes(ctx)) return;

  return notFound(res);
}
