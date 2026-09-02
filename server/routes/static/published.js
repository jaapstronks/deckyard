import { notFound } from '../../utils/http.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { getPublishedById } from '../../storage/published.js';
import { buildStandaloneHtml } from '../../export/html.js';
import { buildDocumentCspHeader } from '../../utils/document-csp.js';
import { buildReaderHtml } from '../../export/reader.js';
import { loadThemeAssets } from '../../utils/themes.js';
import { buildMergedSlideTypes } from '../../utils/custom-slide-type-runtime.js';
import { getAppName } from '../../config/branding.js';
import { sandboxEnabled } from '../../config/sandbox.js';
import {
  projectPresentationForLang,
  resolveLangModeFromPresOrUrl,
} from '../../utils/i18n.js';
import { getLangDisplayName } from '../../../shared/i18n-utils.js';
import { existingVersionLangs } from '../../../shared/i18n-progress.js';
import { generateTrackingScriptHtml } from '../../analytics/tracking-script.js';
import { crossOrganizationScope } from '../../storage/scope.js';

/**
 * Semantic reflowable "reader" view of a published deck (open web, no auth).
 * A JS-optional, accessible document projection of the same model; the canvas
 * page lives at /p/:id-:slug. Served at /p/:id-:slug/reader.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
export async function handlePublishedReader({ repoRoot, req, res, url }) {
  const pubReaderMatch = url.pathname.match(
    /^\/p\/([a-f0-9]{8})(?:-([^/]+))?\/reader$/,
  );
  if (!pubReaderMatch || req.method !== 'GET') return false;

  const publishId = pubReaderMatch[1];
  const reqSlug = String(pubReaderMatch[2] || '').trim();
  const entry = await getPublishedById(
    crossOrganizationScope(
      repoRoot,
      'published-deck: the publish id is the authorization',
    ),
    publishId,
  );
  if (!entry?.presentationId) {
    notFound(res);
    return true;
  }

  const pres = await getPresentation(
    crossOrganizationScope(
      repoRoot,
      'published-deck: the publish id is the authorization',
    ),
    entry.presentationId,
  );
  if (!pres) {
    notFound(res);
    return true;
  }

  const slug = String(entry.slug || '').trim() || 'presentation';
  const canonicalCanvasPath = `/p/${publishId}-${slug}`;
  if (!reqSlug || reqSlug !== slug) {
    res.writeHead(302, {
      Location: `${canonicalCanvasPath}/reader`,
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }

  const modeLang = resolveLangModeFromPresOrUrl(pres, url);
  const projected = projectPresentationForLang(pres, modeLang);
  const orgId = pres?.organizationId;
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
    // The document already carries this policy as a meta; the header adds the
    // one directive a meta cannot: `frame-ancestors`. `'none'` mirrors the
    // `X-Frame-Options: DENY` that security-headers.js already sets here, so
    // the two agree instead of the (winning) CSP quietly widening framing.
    'Content-Security-Policy': buildDocumentCspHeader({
      frameAncestors: "'none'",
    }),
  });
  res.end(html);
  return true;
}

/**
 * Published public pages (open web, no auth): the canvas deck at /p/:id-:slug
 * with full OG/Twitter metadata, canonical + reader alternates, and JSON-LD.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if handled.
 */
export async function handlePublishedPage({ repoRoot, req, res, url }) {
  const pubMatch = url.pathname.match(/^\/p\/([a-f0-9]{8})(?:-([^/]+))?$/);
  if (!pubMatch || req.method !== 'GET') return false;

  const publishId = pubMatch[1];
  const reqSlug = String(pubMatch[2] || '').trim();
  const entry = await getPublishedById(
    crossOrganizationScope(
      repoRoot,
      'published-deck: the publish id is the authorization',
    ),
    publishId,
  );
  if (!entry?.presentationId) {
    notFound(res);
    return true;
  }

  const pres = await getPresentation(
    crossOrganizationScope(
      repoRoot,
      'published-deck: the publish id is the authorization',
    ),
    entry.presentationId,
  );
  if (!pres) {
    notFound(res);
    return true;
  }

  const slug = String(entry.slug || '').trim() || 'presentation';
  const canonicalPath = `/p/${publishId}-${slug}`;
  if (!reqSlug || reqSlug !== slug) {
    res.writeHead(302, {
      Location: canonicalPath,
      'Cache-Control': 'no-store',
    });
    res.end();
    return true;
  }

  const proto =
    (req.headers['x-forwarded-proto'] &&
      String(req.headers['x-forwarded-proto']).split(',')[0].trim()) ||
    'http';
  const host = req.headers.host || 'localhost';
  const origin = `${proto}://${host}`;
  const modeLang = resolveLangModeFromPresOrUrl(pres, url);
  const projected = projectPresentationForLang(pres, modeLang);
  const canonicalUrl = new URL(
    `${canonicalPath}?lang=${encodeURIComponent(modeLang)}`,
    origin,
  ).href;
  const ogImageAbs = entry.ogImageUrl
    ? new URL(entry.ogImageUrl, origin).href
    : new URL('/assets/images/slides-previewimage.png', origin).href;

  const title = escapeHtml(projected.title || 'Presentation');
  const rawDesc =
    typeof pres?.description === 'string' ? pres.description.trim() : '';
  const descriptionRaw =
    rawDesc || `Bekijk de presentatie “${projected.title || 'Presentation'}”.`;
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
    rawDesc || `Bekijk de presentatie “${projected.title || 'Presentation'}”.`;
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
    jsonLd,
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
  // One link per version the deck actually has, in the order the versions were
  // written — not a fixed `NL EN` pair, which showed a Dutch deck an English
  // link it had no version for and hid a German one it did (B182/D72 #6).
  // Below two versions there is nothing to switch between, so the group is
  // omitted rather than rendered with a single dead button.
  const versionLangs = existingVersionLangs(pres);
  const switchHtml =
    versionLangs.length > 1
      ? `
            <div class="sb-segmented" role="group" aria-label="Language">
              ${versionLangs
                .map(
                  (lang) =>
                    `<a class="sb-segmented-btn${lang === modeLang ? ' is-active' : ''}" href="${escapeHtml(
                      `${canonicalPath}?lang=${encodeURIComponent(lang)}`,
                    )}" hreflang="${escapeHtml(lang)}" rel="nofollow">${escapeHtml(
                      getLangDisplayName(lang),
                    )}</a>`,
                )
                .join('\n              ')}
            </div>
          `.trim()
      : '';

  // Visible link to the semantic reader view (discoverable a11y/no-JS surface).
  const readerLinkHtml = `<a class="presenter-help ps-reader-link" href="${escapeHtml(
    readerPath,
  )}" rel="alternate" style="text-decoration: underline; white-space: nowrap;">${escapeHtml(
    readerLabel,
  )}</a>`;

  const theme = await loadThemeAssets(repoRoot, pres?.theme);

  // Add analytics tracking script for published pages
  const trackingScript = generateTrackingScriptHtml({
    presentationId: entry.presentationId,
    sourceType: 'published',
    sourceId: publishId,
  });

  const orgId = pres?.organizationId;
  const slideTypes = await buildMergedSlideTypes({ organizationId: orgId });

  const html = await buildStandaloneHtml(repoRoot, projected, {
    headHtml: `${headHtml}\n${trackingScript}`.trim(),
    topbarRightHtml: `${switchHtml}${readerLinkHtml}`,
    theme,
    slideTypes,
    context: 'published', // Use published visibility filter
    description: descriptionRaw,
  });
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // The document already carries this policy as a meta; the header adds the
    // one directive a meta cannot: `frame-ancestors`. `'none'` mirrors the
    // `X-Frame-Options: DENY` that security-headers.js already sets here, so
    // the two agree instead of the (winning) CSP quietly widening framing.
    'Content-Security-Policy': buildDocumentCspHeader({
      frameAncestors: "'none'",
    }),
  });
  res.end(html);
  return true;
}
