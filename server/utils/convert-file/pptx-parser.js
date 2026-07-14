/**
 * PPTX Parser
 * Extracts text content and images from PowerPoint files.
 * PPTX files are ZIP archives containing XML files.
 */

import JSZip from 'jszip';

/**
 * Extract text content and images from each slide in a PPTX file.
 * @param {Buffer} buffer - The PPTX file contents
 * @returns {Promise<{slides: Array<{slideNumber: number, textContent: string, notes: string, images?: Array<{data: Buffer, mimeType: string, filename: string}>, isImageOnly?: boolean}>, metadata: object, errors: string[]}>}
 */
export async function parsePptx(buffer) {
  const errors = [];
  const slides = [];
  let metadata = {};

  try {
    const zip = await JSZip.loadAsync(buffer);

    // Extract presentation metadata from docProps/core.xml
    try {
      const coreXml = await zip.file('docProps/core.xml')?.async('string');
      if (coreXml) {
        metadata = parseMetadata(coreXml);
      }
    } catch (e) {
      errors.push(`Warning: Could not parse metadata: ${e.message}`);
    }

    // Find all slide XML files (ppt/slides/slide1.xml, slide2.xml, etc.)
    const slideFiles = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const numA = parseInt(a.match(/slide(\d+)/i)?.[1] || '0', 10);
        const numB = parseInt(b.match(/slide(\d+)/i)?.[1] || '0', 10);
        return numA - numB;
      });

    for (const slidePath of slideFiles) {
      const slideNumber = parseInt(slidePath.match(/slide(\d+)/i)?.[1] || '0', 10);

      try {
        const slideXml = await zip.file(slidePath)?.async('string');
        if (!slideXml) {
          errors.push(`Warning: Could not read ${slidePath}`);
          continue;
        }

        const textContent = extractTextFromSlideXml(slideXml);

        // Extract images from the slide
        const images = await extractImagesFromSlide(zip, slidePath, slideXml, slideNumber);

        // Try to get slide notes
        let notes = '';
        const notesPath = slidePath
          .replace('slides/slide', 'notesSlides/notesSlide')
          .replace('.xml', '.xml');
        try {
          const notesXml = await zip.file(notesPath)?.async('string');
          if (notesXml) {
            notes = extractTextFromSlideXml(notesXml);
          }
        } catch {
          // Notes are optional
        }

        // Determine if this is an image-only slide
        // Criteria: has at least one image AND minimal text (< 50 chars, excluding whitespace)
        const cleanText = textContent.trim().replace(/\s+/g, ' ');
        const isImageOnly = images.length > 0 && cleanText.length < 50;

        slides.push({
          slideNumber,
          textContent: textContent.trim(),
          notes: notes.trim(),
          images: images.length > 0 ? images : undefined,
          isImageOnly,
        });
      } catch (e) {
        errors.push(`Error parsing slide ${slideNumber}: ${e.message}`);
      }
    }
  } catch (e) {
    errors.push(`Fatal error parsing PPTX: ${e.message}`);
  }

  return { slides, metadata, errors };
}

/**
 * Extract images from a slide.
 * Parses the slide relationships to find image references and extracts them from ppt/media/.
 * @param {JSZip} zip - The PPTX ZIP archive
 * @param {string} slidePath - Path to the slide XML (e.g., 'ppt/slides/slide1.xml')
 * @param {string} slideXml - The slide XML content
 * @param {number} slideNumber - The slide number
 * @returns {Promise<Array<{data: Buffer, mimeType: string, filename: string}>>}
 */
async function extractImagesFromSlide(zip, slidePath, slideXml, slideNumber) {
  const images = [];

  try {
    // Get the slide relationships file (e.g., ppt/slides/_rels/slide1.xml.rels)
    const slideFileName = slidePath.split('/').pop(); // e.g., 'slide1.xml'
    const relsPath = `ppt/slides/_rels/${slideFileName}.rels`;
    const relsXml = await zip.file(relsPath)?.async('string');

    if (!relsXml) {
      return images;
    }

    // Parse relationships to find image references
    // Format: <Relationship Id="rId2" Type="http://...image" Target="../media/image1.png"/>
    const imageRels = new Map();
    const relRegex = /<Relationship[^>]+Id="([^"]+)"[^>]+Type="[^"]*image[^"]*"[^>]+Target="([^"]+)"[^>]*\/?>/gi;
    let relMatch;
    while ((relMatch = relRegex.exec(relsXml)) !== null) {
      const rId = relMatch[1];
      let target = relMatch[2];
      // Normalize target path (relative to ppt/slides/)
      if (target.startsWith('../')) {
        target = 'ppt/' + target.slice(3);
      } else if (!target.startsWith('ppt/')) {
        target = 'ppt/slides/' + target;
      }
      imageRels.set(rId, target);
    }

    // Also check for Target before Type in the XML
    const relRegex2 = /<Relationship[^>]+Target="([^"]+)"[^>]+Type="[^"]*image[^"]*"[^>]+Id="([^"]+)"[^>]*\/?>/gi;
    while ((relMatch = relRegex2.exec(relsXml)) !== null) {
      let target = relMatch[1];
      const rId = relMatch[2];
      if (target.startsWith('../')) {
        target = 'ppt/' + target.slice(3);
      } else if (!target.startsWith('ppt/')) {
        target = 'ppt/slides/' + target;
      }
      if (!imageRels.has(rId)) {
        imageRels.set(rId, target);
      }
    }

    // Find image references in the slide XML (<a:blip r:embed="rId2"/>)
    const blipRegex = /<a:blip[^>]+r:embed="([^"]+)"[^>]*\/?>/gi;
    const usedImageIds = new Set();
    let blipMatch;
    while ((blipMatch = blipRegex.exec(slideXml)) !== null) {
      usedImageIds.add(blipMatch[1]);
    }

    // Extract only images that are actually used in this slide
    let imageIndex = 0;
    for (const rId of usedImageIds) {
      const imagePath = imageRels.get(rId);
      if (!imagePath) continue;

      try {
        const imageFile = zip.file(imagePath);
        if (!imageFile) continue;

        const data = await imageFile.async('nodebuffer');
        const ext = imagePath.split('.').pop()?.toLowerCase() || 'png';
        const mimeType = getMimeType(ext);

        // Only include supported image types
        if (mimeType) {
          images.push({
            data,
            mimeType,
            filename: `slide${slideNumber}_image${++imageIndex}.${ext}`,
          });
        }
      } catch (e) {
        // Skip images that can't be read
        console.warn(`Could not extract image ${imagePath}: ${e.message}`);
      }
    }
  } catch (e) {
    console.warn(`Error extracting images from slide ${slideNumber}: ${e.message}`);
  }

  return images;
}

/**
 * Get MIME type from file extension
 */
function getMimeType(ext) {
  const mimeTypes = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    tiff: 'image/tiff',
    tif: 'image/tiff',
  };
  return mimeTypes[ext] || null;
}

/**
 * Parse metadata from docProps/core.xml
 */
function parseMetadata(xml) {
  const metadata = {};

  const titleMatch = xml.match(/<dc:title>([^<]*)<\/dc:title>/i);
  if (titleMatch) metadata.title = decodeXmlEntities(titleMatch[1]);

  const creatorMatch = xml.match(/<dc:creator>([^<]*)<\/dc:creator>/i);
  if (creatorMatch) metadata.author = decodeXmlEntities(creatorMatch[1]);

  const subjectMatch = xml.match(/<dc:subject>([^<]*)<\/dc:subject>/i);
  if (subjectMatch) metadata.subject = decodeXmlEntities(subjectMatch[1]);

  return metadata;
}

/**
 * Extract text content from OOXML slide XML.
 * Handles <a:t> text elements within paragraphs.
 */
function extractTextFromSlideXml(xml) {
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
 */
function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    );
}