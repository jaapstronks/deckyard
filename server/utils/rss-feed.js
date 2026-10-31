/**
 * RSS/Atom/JSON Feed generation utility.
 * Uses the `feed` npm package to produce all three formats from a single data model.
 */

import { Feed } from 'feed';

/**
 * Build an RSS/Atom/JSON feed from public editions.
 * @param {Object} options
 * @param {Object} options.org - Organization record
 * @param {Array<{publicationId: string, version: number, publishedAt: string, title: string, description: string}>} options.editions -
 *   The newest public edition of each publication, newest first
 * @param {string} options.baseUrl - Base URL (e.g. https://example.com)
 * @param {string} [options.format='rss'] - 'rss' | 'atom' | 'json'
 * @returns {string} Serialized feed content
 */
export function buildFeed({ org, editions, baseUrl, format = 'rss' }) {
  const rssSettings = org.settings?.rss || {};

  const orgName = org.displayName || org.name || 'Presentations';

  const feed = new Feed({
    title: rssSettings.title || `${orgName} — Presentations`,
    description:
      rssSettings.description || `Published presentations from ${orgName}`,
    id: `${baseUrl}/`,
    link: `${baseUrl}/`,
    language: rssSettings.language || 'en',
    copyright: rssSettings.copyright || '',
    feedLinks: {
      rss: `${baseUrl}/feed/rss.xml`,
      atom: `${baseUrl}/feed/atom.xml`,
      json: `${baseUrl}/feed/feed.json`,
    },
    author: rssSettings.authorName
      ? { name: rssSettings.authorName }
      : undefined,
    image: org.logoUrl ? `${baseUrl}${org.logoUrl}` : undefined,
  });

  for (const edition of editions) {
    const path = `/p/${edition.publicationId}/${edition.version}`;
    const link = `${baseUrl}${path}`;

    feed.addItem({
      title: edition.title || 'Untitled',
      id: link,
      link,
      description: edition.description || '',
      // An edition never changes: its date is the moment it was published.
      date: new Date(edition.publishedAt),
      published: new Date(edition.publishedAt),
      // No per-item author: nothing public derives a name from the owner's
      // email, and a display name arrives with identity decoupling
      // (docs/plans/briefs/identity-decoupling.md).
      image: `${baseUrl}${path}/og`,
    });
  }

  switch (format) {
    case 'atom':
      return feed.atom1();
    case 'json':
      return feed.json1();
    default:
      return feed.rss2();
  }
}
