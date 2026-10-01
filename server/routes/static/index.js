import { notFound } from '../../utils/http.js';
import { dispatchMounts } from '../../utils/router.js';
import { handleFeed } from '../feed.js';
import {
  handleCustomStyles,
  handleGo,
  handleStaticFiles,
} from './static-files.js';
import { handleEmbed } from './embed.js';
import { handleManagedFont } from './managed-fonts.js';
import { handlePublished } from './published.js';
import { handleSandboxOg } from './sandbox-og.js';
import { handleShareLink } from './share-viewer.js';
import { handleAppRoutes } from './app-shell.js';

/**
 * The static mount chain. Each handler owns one route family and returns true
 * once it has written a response; the order is significant and mirrors the
 * original if-chain (specific published/embed routes before the generic
 * static-dir and app-shell fallbacks). A mount with a `feature` is skipped
 * while that installation cluster is off (D257), so its paths reach the 404
 * at the end of {@link handleStatic}.
 *
 * @type {import('../../utils/router.js').Mount[]}
 */
export const STATIC_MOUNTS = [
  // RSS/Atom/JSON feed routes (public, no auth)
  { handle: handleFeed, feature: 'rssFeed' },
  { handle: handleGo },
  { handle: handleEmbed },
  { handle: handlePublished },
  { handle: handleSandboxOg },
  { handle: handleCustomStyles },
  { handle: handleManagedFont },
  { handle: handleStaticFiles },
  { handle: handleShareLink },
  { handle: handleAppRoutes },
];

/**
 * Terminal router for everything that is not `/api/*`: public/published pages,
 * embeds, feeds, static assets, and the SPA app shell.
 *
 * @param {import('./static-files.js').StaticContext} ctx
 */
export async function handleStatic(ctx) {
  if (await dispatchMounts(STATIC_MOUNTS, ctx)) return;
  return notFound(ctx.res);
}
