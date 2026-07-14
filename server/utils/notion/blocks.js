/**
 * Notion Block Creators
 * Helper functions for creating Notion block objects.
 */

import { notionFetchJson } from './client.js';
import { extractPageId } from './parser.js';

/**
 * Append blocks to the bottom of a Notion page.
 * Uses PATCH /blocks/{block_id}/children to append without removing existing content.
 *
 * @param {string} pageId - The Notion page ID (also serves as the block ID for appending)
 * @param {Array} blocks - Array of Notion block objects to append
 * @returns {Object} The API response
 */
export async function appendBlocksToPage(pageId, blocks) {
  const id = String(pageId || '').trim();
  if (!id) {
    const err = new Error('Page ID is required');
    err.statusCode = 400;
    throw err;
  }

  if (!Array.isArray(blocks) || blocks.length === 0) {
    const err = new Error('At least one block is required');
    err.statusCode = 400;
    throw err;
  }

  return await notionFetchJson(`/blocks/${encodeURIComponent(id)}/children`, {
    method: 'PATCH',
    body: { children: blocks },
  });
}

/**
 * Create a divider block for Notion.
 */
export function createDividerBlock() {
  return {
    object: 'block',
    type: 'divider',
    divider: {},
  };
}

/**
 * Create a heading block for Notion.
 *
 * @param {string} text - The heading text
 * @param {number} level - Heading level (1, 2, or 3)
 */
export function createHeadingBlock(text, level = 2) {
  const type = `heading_${Math.max(1, Math.min(3, level))}`;
  return {
    object: 'block',
    type,
    [type]: {
      rich_text: [{ type: 'text', text: { content: String(text || '') } }],
    },
  };
}

/**
 * Create a paragraph block for Notion.
 *
 * @param {string} text - The paragraph text
 * @param {string} link - Optional URL to make the text a link
 */
export function createParagraphBlock(text, link = null) {
  const textObj = { content: String(text || '') };
  if (link) textObj.link = { url: link };

  return {
    object: 'block',
    type: 'paragraph',
    paragraph: {
      rich_text: [{ type: 'text', text: textObj }],
    },
  };
}

/**
 * Create an embed block for Notion.
 *
 * @param {string} url - The URL to embed
 */
export function createEmbedBlock(url) {
  return {
    object: 'block',
    type: 'embed',
    embed: {
      url: String(url || ''),
    },
  };
}

/**
 * Create a callout block for Notion (useful for highlighting the embed link).
 *
 * @param {string} text - The callout text
 * @param {string} emoji - The emoji icon (default: target)
 */
export function createCalloutBlock(text, emoji = '\uD83C\uDFAF') {
  return {
    object: 'block',
    type: 'callout',
    callout: {
      rich_text: [{ type: 'text', text: { content: String(text || '') } }],
      icon: { type: 'emoji', emoji: String(emoji || '\uD83C\uDFAF') },
    },
  };
}

/**
 * Publish to Notion: append embed blocks to the source page.
 * Adds a divider, heading, and embed block with the presentation URL.
 *
 * @param {string} pageId - The Notion page ID to append to
 * @param {Object} options - Options
 * @param {string} options.embedUrl - The embed URL for the presentation
 * @param {string} options.title - The presentation title (for the heading)
 * @param {string} options.lang - Language for labels ('nl' or 'en-GB')
 * @returns {Object} Result with success status
 */
export async function publishEmbedToNotionPage(pageId, { embedUrl, title, lang = 'nl' } = {}) {
  const id = extractPageId(pageId);
  if (!id) {
    const err = new Error('Invalid Notion page ID');
    err.statusCode = 400;
    throw err;
  }

  if (!embedUrl) {
    const err = new Error('Embed URL is required');
    err.statusCode = 400;
    throw err;
  }

  const headingText = lang === 'nl' ? 'Presentatie' : 'Presentation';
  const linkText = lang === 'nl'
    ? 'Bekijk de presentatie'
    : 'View the presentation';

  const blocks = [
    createDividerBlock(),
    createHeadingBlock(title || headingText, 2),
    createEmbedBlock(embedUrl),
    createParagraphBlock(linkText, embedUrl),
  ];

  const result = await appendBlocksToPage(id, blocks);
  return { success: true, blocksAdded: blocks.length, result };
}