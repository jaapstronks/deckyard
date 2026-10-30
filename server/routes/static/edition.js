import { jsonError, notFound } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { buildDocumentCspHeader } from '../../utils/document-csp.js';
import { getRequestOrigin } from '../../utils/request-url.js';
import { getOgImageUrl } from '../../config/branding.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import {
  RENDERER_BUNDLE_ERRORS,
  RendererBundleError,
} from '../../render/renderer-bundle/index.js';
import {
  editionManifestBytes,
  editionOgImage,
  editionPackageBytes,
  findPublicEdition,
  renderEditionViews,
} from '../../services/public-edition.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('edition');

/**
 * Every response of an edition is fetched again on every visit. A revoked
 * edition must stop being served everywhere, so nothing in front of this
 * server may keep a copy (`docs/reference/publication-editions.md` § Caching).
 */
const NO_STORE = 'no-store';

/** The tombstone of a revoked edition: no title, no author, no content. */
const TOMBSTONE_HTML =
  '<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Withdrawn</title></head><body><p>This edition has been withdrawn.</p></body></html>\n';

function baseHeaders(contentType) {
  const headers = { 'Content-Type': contentType, 'Cache-Control': NO_STORE };
  if (sandboxEnabled()) headers['X-Robots-Tag'] = 'noindex, nofollow';
  return headers;
}

function sendTombstone(res) {
  res.writeHead(410, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': NO_STORE,
    'X-Robots-Tag': 'noindex',
  });
  res.end(TOMBSTONE_HTML);
  return true;
}

function sendDocument(res, html) {
  res.writeHead(200, {
    ...baseHeaders('text/html; charset=utf-8'),
    // The document carries this policy as a meta as well; the header adds
    // `frame-ancestors`, which a meta cannot (as for the live `/p/` page).
    'Content-Security-Policy': buildDocumentCspHeader({
      frameAncestors: "'none'",
    }),
  });
  res.end(html);
  return true;
}

/**
 * A render that could not happen is an error, never a fallback: there is no
 * other renderer an edition may be shown with.
 */
function renderFailed(res, err) {
  if (!(err instanceof RendererBundleError)) throw err;
  log.warn('[edition] render refused:', err.code);
  const unavailable = err.code === RENDERER_BUNDLE_ERRORS.SANDBOX_UNAVAILABLE;
  return jsonError(
    res,
    unavailable ? 503 : 500,
    err.code,
    unavailable
      ? 'This edition cannot be rendered right now'
      : 'This edition cannot be rendered',
    unavailable ? { headers: { 'Retry-After': '30' } } : {},
  );
}

/**
 * Resolve the edition a request names. Writes the 404 or 410 itself and
 * returns null then; otherwise the (non-revoked) edition.
 */
async function resolve({ repoRoot, res }, publicationId, versionText) {
  const edition = await findPublicEdition(
    repoRoot,
    publicationId,
    Number(versionText),
  );
  if (!edition) {
    notFound(res);
    return null;
  }
  if (edition.revokedAt) {
    sendTombstone(res);
    return null;
  }
  return edition;
}

function viewHandler(view) {
  return async (ctx, publicationId, versionText) => {
    const edition = await resolve(ctx, publicationId, versionText);
    if (!edition) return true;
    let views;
    try {
      views = await renderEditionViews(ctx.repoRoot, edition, {
        origin: getRequestOrigin(ctx.req) || 'http://localhost',
        lang: ctx.url.searchParams.get('lang'),
      });
    } catch (err) {
      return renderFailed(ctx.res, err);
    }
    if (!views) return sendTombstone(ctx.res);
    return sendDocument(ctx.res, views[view]);
  };
}

async function serveManifest(ctx, publicationId, versionText) {
  const edition = await resolve(ctx, publicationId, versionText);
  if (!edition) return true;
  const bytes = await editionManifestBytes(ctx.repoRoot, edition);
  if (!bytes) return sendTombstone(ctx.res);
  ctx.res.writeHead(200, baseHeaders('application/json; charset=utf-8'));
  ctx.res.end(bytes);
  return true;
}

async function servePackage(ctx, publicationId, versionText) {
  const edition = await resolve(ctx, publicationId, versionText);
  if (!edition) return true;
  const zip = await editionPackageBytes(ctx.repoRoot, edition);
  if (!zip) return sendTombstone(ctx.res);
  ctx.res.writeHead(200, {
    ...baseHeaders('application/zip'),
    'Content-Disposition': `attachment; filename="edition-${edition.publicationId}-v${edition.version}.zip"`,
  });
  ctx.res.end(zip);
  return true;
}

async function serveOgImage(ctx, publicationId, versionText) {
  const edition = await resolve(ctx, publicationId, versionText);
  if (!edition) return true;
  const og = await editionOgImage(ctx.repoRoot, edition);
  if (!og) return sendTombstone(ctx.res);
  if (!og.image) {
    // The edition shows no image: the installation's own card, which says
    // nothing about the deck and so cannot drift from it.
    ctx.res.writeHead(302, {
      Location: getOgImageUrl(),
      'Cache-Control': NO_STORE,
    });
    ctx.res.end();
    return true;
  }
  ctx.res.writeHead(200, {
    ...baseHeaders(og.image.mediaType),
    'X-Content-Type-Options': 'nosniff',
    // An SVG preview may carry script; as a document of its own it gets none.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  });
  ctx.res.end(og.image.bytes);
  return true;
}

const EDITION =
  '/p/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([1-9][0-9]{0,8})';

/**
 * One edition of a publication at `/p/:publicationId/:version`, and its
 * subresources. The version is part of the address: there is no route that
 * resolves "the latest" edition, and none that reaches the deck.
 */
export const ROUTES = [
  { suffix: '', handler: viewHandler('canvas') },
  { suffix: '/reader', handler: viewHandler('reader') },
  { suffix: '/manifest.json', handler: serveManifest },
  { suffix: '/edition.zip', handler: servePackage },
  { suffix: '/og', handler: serveOgImage },
].map(({ suffix, handler }) => ({
  method: 'GET',
  pattern: new RegExp(`^${EDITION}${suffix.replace('.', '\\.')}$`),
  captures: ['uuid', 'text'],
  handler,
}));

/**
 * Publication editions (open web, no auth).
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>|false} true if handled.
 */
export function handleEditions(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
