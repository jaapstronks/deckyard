/**
 * RSS/Atom/JSON Feed generation utility.
 * Uses the `feed` npm package to produce all three formats from a single data model.
 */

import { Feed } from 'feed';

/**
 * Build an RSS/Atom/JSON feed from published presentations.
 * @param {Object} options
 * @param {Object} options.org - Organization record
 * @param {Array}  options.presentations - Published presentations with full metadata
 * @param {string} options.baseUrl - Base URL (e.g. https://example.com)
 * @param {string} [options.format='rss'] - 'rss' | 'atom' | 'json'
 * @returns {string} Serialized feed content
 */
export function buildFeed({ org, presentations, baseUrl, format = 'rss' }) {
  const rssSettings = org.settings?.rss || {};

  const orgName = org.displayName || org.name || 'Presentations';

  const feed = new Feed({
    title: rssSettings.title || `${orgName} — Presentations`,
    description: rssSettings.description || `Published presentations from ${orgName}`,
    id: `${baseUrl}/`,
    link: `${baseUrl}/`,
    language: rssSettings.language || 'en',
    copyright: rssSettings.copyright || '',
    feedLinks: {
      rss: `${baseUrl}/feed/rss.xml`,
      atom: `${baseUrl}/feed/atom.xml`,
      json: `${baseUrl}/feed/feed.json`,
    },
    author: rssSettings.authorName ? { name: rssSettings.authorName } : undefined,
    image: org.logoUrl ? `${baseUrl}${org.logoUrl}` : undefined,
  });

  for (const pres of presentations) {
    const publishId = pres.published?.id;
    const slug = pres.published?.slug || '';
    const link = `${baseUrl}/p/${publishId}-${slug}`;

    feed.addItem({
      title: pres.title || 'Untitled',
      id: link,
      link,
      description: pres.description || '',
      date: new Date(pres.modified || pres.created),
      published: new Date(pres.published?.created || pres.created),
      // Attribution by display handle only; the owner's raw email is never
      // published to the feed (see docs/plans/identity-decoupling.md).
      author: pres.ownerName ? [{ name: pres.ownerName }] : [],
      image: pres.published?.ogImageUrl
        ? (pres.published.ogImageUrl.startsWith('http') ? pres.published.ogImageUrl : `${baseUrl}${pres.published.ogImageUrl}`)
        : undefined,
    });
  }

  switch (format) {
    case 'atom': return feed.atom1();
    case 'json': return feed.json1();
    default: return feed.rss2();
  }
}
