/**
 * Text out of PresentationML / DrawingML XML.
 *
 * The leaf under `pptx-parser.js` and `pptx-notes.js`: both read text runs
 * out of a slide or notes part, and neither should have to import the other
 * for it.
 */

/**
 * Extract text content from OOXML slide XML.
 * Handles <a:t> text elements within paragraphs.
 * @param {string} xml
 * @returns {string} Paragraphs on their own line
 */
export function extractTextFromSlideXml(xml) {
  const textParts = [];

  // Find all paragraph elements and extract text
  // OOXML structure: <a:p> contains <a:r> (run) which contains <a:t> (text)
  const paragraphRegex = /<a:p[^>]*>([\s\S]*?)<\/a:p>/gi;
  let paraMatch;

  while ((paraMatch = paragraphRegex.exec(xml)) !== null) {
    const paraContent = paraMatch[1];

    // Extract all text runs within this paragraph
    // IMPORTANT: Don't trim individual runs - spaces are often at the end of runs
    // e.g., <a:t>What </a:t><a:t>are </a:t><a:t>immersive </a:t>
    const textRegex = /<a:t>([^<]*)<\/a:t>/gi;
    let textMatch;
    const paraTexts = [];

    while ((textMatch = textRegex.exec(paraContent)) !== null) {
      const text = decodeXmlEntities(textMatch[1]);
      if (text) {
        paraTexts.push(text);
      }
    }

    if (paraTexts.length > 0) {
      // Join runs directly (they contain their own spacing), then trim the paragraph
      const paragraphText = paraTexts.join('').trim();
      if (paragraphText) {
        textParts.push(paragraphText);
      }
    }
  }

  return textParts.join('\n');
}

/**
 * Decode XML entities
 * @param {string} text
 * @returns {string}
 */
export function decodeXmlEntities(text) {
  // `&amp;` is decoded LAST — decoding it before the others would turn
  // `&amp;lt;` into `&lt;` and then into `<`, un-escaping text the document
  // escaped on purpose (js/double-escaping).
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/&amp;/g, '&');
}
