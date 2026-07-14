import { renderSlideToPngBuffer } from '../render/png.js';
import {
  parseVideoSource,
  buildBunnyMp4Url,
  fetchVideoBuffer,
  getBunnyConfig,
} from './video-helpers.js';

function safeScale(n) {
  const s = Number(n) || 2;
  return Math.max(1, Math.min(3, s));
}

/**
 * Build PPTX buffer from presentation.
 * @param {string} repoRoot - Repository root path
 * @param {object} pres - Presentation object
 * @param {object} options - Export options
 * @param {number} options.scale - Image scale (1-3)
 * @param {object} options.theme - Theme object
 * @returns {Promise<{ buffer: Buffer, warnings: string[] }>}
 */
export async function buildPptxBuffer(
  repoRoot,
  pres,
  { scale = 2, theme = null, slideTypes = null } = {}
) {
  const warnings = [];

  let pptxgen;
  try {
    // ESM/CJS interop: pptxgenjs exports a default class in most setups.
    pptxgen = await import('pptxgenjs');
  } catch {
    const err = new Error(
      'PPTX export requires pptxgenjs. Install it with: npm i pptxgenjs'
    );
    err.code = 'PPTXGEN_MISSING';
    throw err;
  }

  const PptxGen =
    pptxgen?.default || pptxgen?.PptxGenJS || pptxgen;
  const pptx = new PptxGen();
  // 16:9 widescreen (PowerPoint default)
  pptx.layout = 'LAYOUT_WIDE';

  // PPTXGenJS wide layout is ~13.333 x 7.5 inches
  const SLIDE_W_IN = 13.333;
  const SLIDE_H_IN = 7.5;

  pptx.author = 'Slide Deck Builder';
  pptx.company = '';
  pptx.subject = String(pres?.title || 'Presentation');
  pptx.title = String(pres?.title || 'Presentation');

  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const s = safeScale(scale);

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideNum = i + 1;

    // Special handling for video slides
    if (slide?.type === 'video-slide') {
      const videoResult = await handleVideoSlide(pptx, slide, slideNum, {
        slideWidth: SLIDE_W_IN,
        slideHeight: SLIDE_H_IN,
      });
      if (videoResult.warning) {
        warnings.push(videoResult.warning);
      }
      continue;
    }

    // Regular slide: render as PNG
    const pngBuf = await renderSlideToPngBuffer(
      repoRoot,
      slide,
      { scale: s, theme, slideTypes }
    );

    const pptxSlide = pptx.addSlide();
    pptxSlide.addImage({
      data: `data:image/png;base64,${pngBuf.toString('base64')}`,
      x: 0,
      y: 0,
      w: SLIDE_W_IN,
      h: SLIDE_H_IN,
    });
  }

  const out = await pptx.write('nodebuffer');
  return { buffer: out, warnings };
}

/**
 * Handle a video slide for PPTX export.
 * For Bunny videos: attempts to embed the MP4 directly.
 * For YouTube/Vimeo: creates a placeholder with instructions.
 */
async function handleVideoSlide(pptx, slide, slideNum, { slideWidth, slideHeight }) {
  const content = slide?.content || {};
  const source = String(content.source || '').trim();
  const title = String(content.title || '').trim();
  const bunnyLibraryId = String(content.bunnyLibraryId || '366590').trim();
  const background = content.background === 'lime' ? 'DBFF00' : 'E8F0F0'; // lime or mist

  const parsed = parseVideoSource(source, bunnyLibraryId);
  const pptxSlide = pptx.addSlide();

  // Set background color
  pptxSlide.background = { color: background };

  // For Bunny videos, try to embed the MP4
  if (parsed.provider === 'bunny' && parsed.videoId) {
    const bunnyConfig = getBunnyConfig();

    if (!bunnyConfig.configured) {
      // No pull zone configured - create placeholder with warning
      addVideoPlaceholder(pptxSlide, {
        title,
        slideWidth,
        slideHeight,
        message: 'Bunny video kon niet worden ingesloten',
        detail: 'BUNNY_PULLZONE is niet geconfigureerd op de server.',
        instruction: 'Vraag de beheerder om de Bunny CDN-instellingen te configureren, of voeg de video handmatig toe.',
        videoUrl: `https://iframe.mediadelivery.net/embed/${parsed.libraryId}/${parsed.videoId}`,
      });
      return {
        warning: `Slide ${slideNum}: Bunny video niet ingesloten - BUNNY_PULLZONE niet geconfigureerd`,
      };
    }

    // Try to fetch the MP4
    const mp4Url = buildBunnyMp4Url(bunnyConfig.pullZone, parsed.videoId, 720);
    const fetchResult = await fetchVideoBuffer(mp4Url, {
      timeoutMs: 120000, // 2 minutes for video download
      maxSizeMb: 200, // Allow up to 200MB videos
    });

    if (fetchResult.success && fetchResult.buffer) {
      // Successfully fetched - embed the video
      try {
        pptxSlide.addMedia({
          type: 'video',
          data: `data:video/mp4;base64,${fetchResult.buffer.toString('base64')}`,
          x: 0.5,
          y: title ? 1.2 : 0.5,
          w: slideWidth - 1,
          h: title ? slideHeight - 1.7 : slideHeight - 1,
        });

        // Add title if present
        if (title) {
          pptxSlide.addText(title, {
            x: 0.5,
            y: 0.4,
            w: slideWidth - 1,
            h: 0.6,
            fontSize: 28,
            bold: true,
            color: '1a1a1a',
          });
        }

        return { warning: null };
      } catch (err) {
        // Failed to add media - fall back to placeholder
        addVideoPlaceholder(pptxSlide, {
          title,
          slideWidth,
          slideHeight,
          message: 'Video kon niet worden ingesloten',
          detail: err.message || 'Onbekende fout bij het toevoegen van video',
          instruction: 'Voeg de video handmatig toe in PowerPoint.',
          videoUrl: mp4Url,
        });
        return {
          warning: `Slide ${slideNum}: Video niet ingesloten - ${err.message}`,
        };
      }
    } else {
      // Failed to fetch - create placeholder with error
      addVideoPlaceholder(pptxSlide, {
        title,
        slideWidth,
        slideHeight,
        message: 'Bunny video kon niet worden gedownload',
        detail: fetchResult.error || 'Controleer of MP4 Fallback is ingeschakeld in Bunny.',
        instruction: 'Download de video handmatig en voeg deze toe in PowerPoint.',
        videoUrl: mp4Url,
      });
      return {
        warning: `Slide ${slideNum}: Bunny video niet ingesloten - ${fetchResult.error}`,
      };
    }
  }

  // For YouTube videos - always create placeholder (requires internet)
  if (parsed.provider === 'youtube' && parsed.videoId) {
    const youtubeUrl = `https://www.youtube.com/watch?v=${parsed.videoId}`;
    addVideoPlaceholder(pptxSlide, {
      title,
      slideWidth,
      slideHeight,
      message: 'YouTube video',
      detail: 'YouTube-video\'s kunnen niet offline worden afgespeeld in PowerPoint.',
      instruction: 'Download de video van YouTube en voeg deze handmatig toe, of gebruik "Online video invoegen" in PowerPoint (vereist internet tijdens presentatie).',
      videoUrl: youtubeUrl,
    });
    return {
      warning: `Slide ${slideNum}: YouTube video niet ingesloten - download handmatig of voeg online video toe`,
    };
  }

  // For Vimeo videos - create placeholder
  if (parsed.provider === 'vimeo' && parsed.videoId) {
    const vimeoUrl = `https://vimeo.com/${parsed.videoId}`;
    addVideoPlaceholder(pptxSlide, {
      title,
      slideWidth,
      slideHeight,
      message: 'Vimeo video',
      detail: 'Vimeo-video\'s kunnen niet offline worden afgespeeld in PowerPoint.',
      instruction: 'Download de video van Vimeo en voeg deze handmatig toe.',
      videoUrl: vimeoUrl,
    });
    return {
      warning: `Slide ${slideNum}: Vimeo video niet ingesloten - download handmatig`,
    };
  }

  // Unknown provider or empty source
  addVideoPlaceholder(pptxSlide, {
    title,
    slideWidth,
    slideHeight,
    message: 'Video bron niet herkend',
    detail: source || 'Geen video bron opgegeven',
    instruction: 'Voeg de video handmatig toe in PowerPoint.',
    videoUrl: source,
  });
  return {
    warning: `Slide ${slideNum}: Video bron niet herkend`,
  };
}

/**
 * Add a video placeholder slide with instructions.
 */
function addVideoPlaceholder(pptxSlide, {
  title,
  slideWidth,
  slideHeight,
  message,
  detail,
  instruction,
  videoUrl,
}) {
  let yPos = 0.5;

  // Title
  if (title) {
    pptxSlide.addText(title, {
      x: 0.5,
      y: yPos,
      w: slideWidth - 1,
      h: 0.6,
      fontSize: 28,
      bold: true,
      color: '1a1a1a',
    });
    yPos += 0.8;
  }

  // Video icon placeholder (using a rectangle as visual indicator)
  const boxY = yPos;
  const boxH = slideHeight - yPos - 2.5;
  pptxSlide.addShape('rect', {
    x: 0.5,
    y: boxY,
    w: slideWidth - 1,
    h: boxH,
    fill: { color: 'f5f5f5' },
    line: { color: 'cccccc', width: 1, dashType: 'dash' },
  });

  // Play icon (triangle) in center of box
  const centerX = slideWidth / 2;
  const centerY = boxY + boxH / 2;
  pptxSlide.addText('▶', {
    x: centerX - 0.5,
    y: centerY - 0.4,
    w: 1,
    h: 0.8,
    fontSize: 48,
    color: '999999',
    align: 'center',
    valign: 'middle',
  });

  // Message below video box
  yPos = boxY + boxH + 0.3;
  pptxSlide.addText(message, {
    x: 0.5,
    y: yPos,
    w: slideWidth - 1,
    h: 0.4,
    fontSize: 16,
    bold: true,
    color: '333333',
  });
  yPos += 0.45;

  // Detail text
  if (detail) {
    pptxSlide.addText(detail, {
      x: 0.5,
      y: yPos,
      w: slideWidth - 1,
      h: 0.35,
      fontSize: 12,
      color: '666666',
    });
    yPos += 0.4;
  }

  // Instruction
  if (instruction) {
    pptxSlide.addText(instruction, {
      x: 0.5,
      y: yPos,
      w: slideWidth - 1,
      h: 0.5,
      fontSize: 11,
      color: '888888',
      italic: true,
    });
    yPos += 0.5;
  }

  // Video URL (as clickable link if possible)
  if (videoUrl) {
    pptxSlide.addText([{
      text: videoUrl,
      options: {
        hyperlink: { url: videoUrl },
        color: '0066cc',
        fontSize: 10,
      },
    }], {
      x: 0.5,
      y: yPos,
      w: slideWidth - 1,
      h: 0.3,
    });
  }
}
