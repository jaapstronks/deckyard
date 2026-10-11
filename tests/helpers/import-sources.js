/**
 * Minimal import sources for driving the AI import routes end to end: a
 * one-slide PPTX for `/api/convert`, and a one-paragraph Notion page served
 * from a `globalThis.fetch` stub for `/api/notion/import`.
 */

import JSZip from 'jszip';

/** The page id `notionPageResponse()` answers for. */
export const NOTION_PAGE_ID = '11111111222233334444555566667777';

/**
 * A PPTX with one slide holding `text`.
 * @param {string} text
 * @returns {Promise<Buffer>}
 */
export async function minimalPptx(text) {
  const zip = new JSZip();
  zip.file(
    'ppt/slides/slide1.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`,
  );
  return await zip.generateAsync({ type: 'nodebuffer' });
}

/**
 * A `data:` URL for `minimalPptx(text)`, as the convert route takes it.
 * @param {string} text
 */
export async function minimalPptxDataUrl(text) {
  const base64 = (await minimalPptx(text)).toString('base64');
  return `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${base64}`;
}

/** Whether a stubbed `fetch` call goes to the Notion API. @param {unknown} url */
export function isNotionRequest(url) {
  return new URL(String(url)).hostname === 'api.notion.com';
}

/**
 * The Notion API's answer for page `NOTION_PAGE_ID`: titled `title`, with one
 * paragraph block holding `text`.
 * @param {string} href
 * @param {{ title: string, text: string }} page
 * @returns {Response}
 */
export function notionPageResponse(href, { title, text }) {
  const json = (payload) =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  if (href.includes('/children')) {
    return json({
      results: [
        {
          id: 'block-1',
          type: 'paragraph',
          has_children: false,
          paragraph: { rich_text: [{ plain_text: text }] },
        },
      ],
      has_more: false,
      next_cursor: null,
    });
  }
  return json({
    id: NOTION_PAGE_ID,
    last_edited_time: '2026-02-01T00:00:00.000Z',
    properties: {
      title: { type: 'title', title: [{ plain_text: title }] },
    },
  });
}
