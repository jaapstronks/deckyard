/**
 * Notion Parser
 * Functions for parsing Notion blocks and extracting text content.
 */

export function richTextToPlain(richText) {
  const parts = Array.isArray(richText) ? richText : [];
  return parts
    .map((rt) => String(rt?.plain_text || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('');
}

export function pageTitleFromProperties(props) {
  if (!props || typeof props !== 'object') return '';
  for (const v of Object.values(props)) {
    if (!v || typeof v !== 'object') continue;
    if (v.type !== 'title') continue;
    const title = richTextToPlain(v.title);
    if (title) return title;
  }
  return '';
}

export function blockTextLine(block, indent = 0) {
  const pad = '  '.repeat(Math.max(0, indent));
  const type = String(block?.type || '');
  const data = block && typeof block === 'object' ? block[type] : null;

  const rt = data?.rich_text || data?.text || null;
  const txt = richTextToPlain(rt);

  if (type === 'heading_1') return txt ? `${pad}${txt}\n` : '';
  if (type === 'heading_2') return txt ? `${pad}${txt}\n` : '';
  if (type === 'heading_3') return txt ? `${pad}${txt}\n` : '';
  if (type === 'bulleted_list_item') return txt ? `${pad}- ${txt}\n` : '';
  if (type === 'numbered_list_item') return txt ? `${pad}- ${txt}\n` : '';
  if (type === 'to_do') {
    const checked = !!data?.checked;
    return txt ? `${pad}- [${checked ? 'x' : ' '}] ${txt}\n` : '';
  }
  if (type === 'quote') return txt ? `${pad}> ${txt}\n` : '';
  if (type === 'code') {
    const lang = String(data?.language || '').trim();
    const code = txt;
    if (!code) return '';
    return `${pad}${lang ? `(${lang}) ` : ''}${code}\n`;
  }
  if (type === 'callout') return txt ? `${pad}${txt}\n` : '';
  if (type === 'paragraph') return txt ? `${pad}${txt}\n` : '';
  if (type === 'toggle') return txt ? `${pad}${txt}\n` : '';

  // Fallback: try whatever rich_text we can find.
  return txt ? `${pad}${txt}\n` : '';
}

/**
 * Extract image URL from an image block.
 * Notion images can be external URLs or hosted on Notion's CDN.
 */
export function extractImageFromBlock(block) {
  if (block?.type !== 'image') return null;
  const imageData = block.image;
  if (!imageData) return null;

  let url = null;
  if (imageData.type === 'external') {
    url = imageData.external?.url;
  } else if (imageData.type === 'file') {
    url = imageData.file?.url;
  }

  if (!url) return null;

  const caption = richTextToPlain(imageData.caption);
  return { url, caption, blockId: block.id };
}

/**
 * Extract a Notion page ID from a URL or raw ID.
 * Handles:
 * - Clean 32-char hex IDs
 * - Full Notion URLs: https://www.notion.so/workspace/Page-Title-abc123...
 * - Short URLs: https://notion.so/abc123...
 * - IDs with dashes
 */
export function extractPageId(urlOrId) {
  const input = String(urlOrId || '').trim();
  if (!input) return null;

  // Already a clean 32-char hex ID?
  if (/^[a-f0-9]{32}$/i.test(input)) return input.toLowerCase();

  // UUID with dashes (36 chars)?
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input)) {
    return input.replace(/-/g, '').toLowerCase();
  }

  // URL? Extract the ID from the path
  let url;
  try {
    url = new URL(input);
  } catch {
    // Maybe it's a partial URL without protocol
    try {
      url = new URL(`https://${input}`);
    } catch {
      return null;
    }
  }

  // Must be a notion.so domain
  if (!url.hostname.endsWith('notion.so') && !url.hostname.endsWith('notion.site')) {
    return null;
  }

  // The page ID is typically the last 32 hex chars in the path
  const path = url.pathname;
  const match = path.match(/([a-f0-9]{32})(?:[?#]|$)/i);
  if (match) return match[1].toLowerCase();

  // Sometimes the ID has dashes in the URL
  const dashMatch = path.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
  if (dashMatch) return dashMatch[1].replace(/-/g, '').toLowerCase();

  // Last segment might be Title-<id> where id is 32 chars
  const segments = path.split('/').filter(Boolean);
  const last = segments[segments.length - 1] || '';
  const endMatch = last.match(/[a-f0-9]{32}$/i);
  if (endMatch) return endMatch[0].toLowerCase();

  return null;
}