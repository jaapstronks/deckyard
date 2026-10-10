import { renderSlideToPngBuffer } from '../render/png.js';
import { SLIDE_TYPES } from '../../shared/slide-types.js';
import {
  exportFidelity,
  needsNativeComposition,
} from '../../shared/slide-types/fidelity.js';
import { resolveDeckLang } from '../../shared/i18n-utils.js';
import { resolveDocLangFromPresentation } from '../utils/doc-lang.js';
import { getAppName } from '../config/branding.js';
import { createLogger } from '../utils/logger.js';
import { slideHeading } from '../../shared/slide-types/semantic-projection.js';
import { applyThemeToPptx, createWidePptx } from './pptx-theme.js';
import {
  composeGenericSlide,
  layerZeroCovers,
  finishEditablePackage,
} from './pptx-generic.js';
import { composeImageSlide } from './pptx-image-slide.js';
import { composeQuoteSlide } from './pptx-quote-slide.js';
import { composeChapterTitleSlide } from './pptx-chapter-title-slide.js';
import { composeImageTextSlide } from './pptx-image-text-slide.js';
import { composeKpiMetricsSlide } from './pptx-kpi-metrics-slide.js';
import { composeChartSlide } from './pptx-chart-slide.js';
import { composeComparisonSlide } from './pptx-comparison-slide.js';
import { composeCalloutSlide } from './pptx-callout-slide.js';
import { fillCopy, getSlideCopy } from '../../shared/slide-types/slide-copy.js';
import {
  parseVideoSource,
  buildBunnyMp4Url,
  fetchVideoBuffer,
  getBunnyConfig,
  resolveBunnyLibraryId,
} from './video-helpers.js';
import { IMAGE_SLIDES_HEADER } from '../../shared/export-headers.js';

function safeScale(n) {
  const s = Number(n) || 2;
  return Math.max(1, Math.min(3, s));
}

/**
 * The compositions of its own a type has in this export, keyed by slide type.
 *
 * The `fidelity` facet says which types *claim* an editable slide; layer 0
 * (`pptx-generic.js`) is the standard composition behind every such claim, and
 * this map holds the upgrades on it (D306). A handler here needs a claim, or it
 * never runs; a claim needs either a handler here or layer 0 finding text in
 * the type's example. `tests/slide-type-fidelity.test.js` holds both. The claim
 * lives with the type, where an author adding a type is looking, and the
 * implementation lives here, where an author adding a mapper is looking.
 *
 * Each entry declares which file it serves. Every handler serves the editable
 * export; one that also declares `pixelPerfect` serves the pixel-perfect
 * export, where every other slide travels as its image (D307). That is a
 * declaration on the entry, not a second map or a branch on a name: the menu
 * row "every slide as an image, videos play" is pinned to the entries that
 * declare it ({@link PIXEL_PERFECT_HANDLER_TYPES}).
 *
 * Every `compose` takes the layer-0 contract: `(pptx, slide, ctx)`, adds its
 * own slide (on the theme's layouts when `ctx.spec` is set) and returns
 * `{ pptxSlide, warnings }`.
 *
 * @type {Readonly<Record<string, Readonly<{ compose: Function, pixelPerfect?: true }>>>}
 */
const NATIVE_PPTX_HANDLERS = Object.freeze({
  'video-slide': Object.freeze({
    compose: handleVideoSlide,
    pixelPerfect: true,
  }),
  'image-slide': Object.freeze({ compose: composeImageSlide }),
  'image-text-slide': Object.freeze({ compose: composeImageTextSlide }),
  'quote-slide': Object.freeze({ compose: composeQuoteSlide }),
  'chapter-title-slide': Object.freeze({ compose: composeChapterTitleSlide }),
  'kpi-metrics-slide': Object.freeze({ compose: composeKpiMetricsSlide }),
  'chart-slide': Object.freeze({ compose: composeChartSlide }),
  'comparison-slide': Object.freeze({ compose: composeComparisonSlide }),
  'callout-slide': Object.freeze({ compose: composeCalloutSlide }),
});

/**
 * The slide types with a composition of their own, in either file.
 *
 * Exported for the facet's guardrail, which is the only consumer: the export
 * itself reads the map, not the names.
 *
 * @type {ReadonlyArray<string>}
 */
export const PPTX_HANDLER_TYPES = Object.freeze(
  Object.keys(NATIVE_PPTX_HANDLERS),
);

/**
 * The slide types the pixel-perfect file composes natively instead of as an
 * image. Exported for the menu-copy pin, which promises exactly this list.
 *
 * @type {ReadonlyArray<string>}
 */
export const PIXEL_PERFECT_HANDLER_TYPES = Object.freeze(
  PPTX_HANDLER_TYPES.filter((type) => NATIVE_PPTX_HANDLERS[type].pixelPerfect),
);

const log = createLogger('export-pptx');

/**
 * The types in a registry whose `fidelity.pptx` claims an editable slide this
 * build cannot write: no handler of its own, and layer 0 finds no text in its
 * example (D306).
 *
 * The facet's guardrail pins the core types in CI; this is the same check for
 * the registry a *running* server composed,
 * which is where a fork's file-JS types appear. Called once at boot so the
 * mismatch is reported where the person who wrote the declaration is looking —
 * the server log at startup — rather than only inside an export nobody can see
 * the warnings of (a download is a binary file; it carries no message). The
 * validator cannot do this: it lives in `shared/` and must not know the export.
 *
 * @param {Record<string, any>} [registry] - defaults to the process-wide
 *   registry, core plus file-JS fork types
 * @returns {Array<{ type: string, claim: string }>}
 */
export function unbackedFidelityClaims(registry = SLIDE_TYPES) {
  const out = [];
  for (const [type, def] of Object.entries(registry || {})) {
    if (
      needsNativeComposition(def, 'pptx') &&
      !NATIVE_PPTX_HANDLERS[type] &&
      !layerZeroCovers(type, def)
    ) {
      out.push({ type, claim: exportFidelity(def, 'pptx') });
    }
  }
  return out;
}

/**
 * Report every unbacked claim in the registry to the server log. Returns the
 * claims so a boot sequence can count them.
 *
 * @param {Record<string, any>} [registry]
 * @returns {Array<{ type: string, claim: string }>}
 */
export function warnUnbackedFidelityClaims(registry = SLIDE_TYPES) {
  const claims = unbackedFidelityClaims(registry);
  for (const { type, claim } of claims) {
    log.warn(
      `slide type ${type} declares PPTX fidelity '${claim}', but this build ` +
        `has no composition of its own for it and layer 0 finds no text in ` +
        `its example — its slides come out empty in the editable PPTX. ` +
        `Declare 'raster' or add a mapper to NATIVE_PPTX_HANDLERS in ` +
        `server/export/pptx.js.`,
    );
  }
  return claims;
}

/** PPTX's wide layout, in inches. */
const SLIDE_W_IN = 13.333;
const SLIDE_H_IN = 7.5;

/**
 * The values `compose` takes on the editable export. `fidelity` is the export
 * itself: each slide as its type declares (D141). `generic` routes every slide
 * through layer 0, whatever it declares — not a user choice, but the
 * comparison gate A2.8 is judged on (D141 (c)).
 *
 * @type {ReadonlyArray<string>}
 */
export const PPTX_EDITABLE_COMPOSE = Object.freeze(['fidelity', 'generic']);

/**
 * The pixel-perfect PPTX: every slide as the image the PNG export makes, bar
 * the types with a native composition of their own (D141's "PowerPoint").
 *
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
  { scale = 2, theme = null, slideTypes = null } = {},
) {
  const { buffer, warnings } = await buildDeckPptx(repoRoot, pres, {
    scale,
    theme,
    slideTypes,
    editable: null,
  });
  return { buffer, warnings };
}

/**
 * The editable PPTX (D141's "PowerPoint, editable"): every slide on the
 * theme's layouts as text and pictures PowerPoint can edit, as far as its type
 * allows (B290).
 *
 * Which slide goes which way is the type's `fidelity.pptx`: a type with a
 * native composition of its own uses it, a type that declares `native` or
 * `mixed` without one goes through layer 0 (`pptx-generic.js`), and a `raster`
 * type travels as its image, as in the pixel-perfect export. The image slides
 * are reported by number, because "editable" that is partly pictures has to
 * say where.
 *
 * @param {string} repoRoot
 * @param {object} pres
 * @param {{ scale?: number, theme?: object|null, slideTypes?: object|null,
 *   compose?: 'fidelity'|'generic' }} [options] - `compose: 'generic'` sends
 *   every slide through layer 0 ({@link PPTX_EDITABLE_COMPOSE})
 * @returns {Promise<{ buffer: Buffer, warnings: string[], imageSlides: number[] }>}
 *   `imageSlides` are the 1-based numbers of the slides written as an image
 */
export async function buildEditablePptxBuffer(
  repoRoot,
  pres,
  { scale = 2, theme = null, slideTypes = null, compose = 'fidelity' } = {},
) {
  if (!PPTX_EDITABLE_COMPOSE.includes(compose)) {
    throw new TypeError(`unknown PPTX compose '${compose}'`);
  }
  return buildDeckPptx(repoRoot, pres, {
    scale,
    theme,
    slideTypes,
    editable: { compose },
  });
}

/**
 * The headers an editable PPTX response carries for its image slides
 * ({@link IMAGE_SLIDES_HEADER}).
 *
 * @param {number[]} imageSlides - from {@link buildEditablePptxBuffer}
 * @returns {Record<string, string>}
 */
export function imageSlidesHeaders(imageSlides) {
  return imageSlides.length
    ? { [IMAGE_SLIDES_HEADER]: imageSlides.join(',') }
    : {};
}

/**
 * The one loop behind both PPTX intents. `editable` is null for the
 * pixel-perfect file and `{ compose }` for the editable one; the two differ
 * only in which composer a slide gets and in the theme's layouts being in the
 * file.
 *
 * @returns {Promise<{ buffer: Buffer, warnings: string[], imageSlides: number[] }>}
 */
async function buildDeckPptx(
  repoRoot,
  pres,
  { scale, theme, slideTypes, editable },
) {
  const warnings = [];
  const imageSlides = [];

  const pptx = await createWidePptx();
  pptx.author = getAppName();
  pptx.company = '';
  pptx.subject = String(pres?.title || 'Presentation');
  pptx.title = String(pres?.title || 'Presentation');
  const spec = editable
    ? await applyThemeToPptx(pptx, theme, { repoRoot })
    : null;

  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  // The registry this deck's types resolve against — the caller's when it has
  // one, because a database-backed custom type exists only there. Same
  // precedence as renderSlideHtml(), and the reason the fidelity lookup takes a
  // definition rather than a name.
  const registry =
    slideTypes && typeof slideTypes === 'object' ? slideTypes : SLIDE_TYPES;
  const s = safeScale(scale);
  const deckLang = resolveDeckLang(pres);
  const docLang = resolveDocLangFromPresentation(pres);
  const slideIds = slides.map((slide) => String(slide?.id || ''));

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const slideNum = i + 1;
    const def = registry[slide?.type];

    // Which branch a slide takes is the type's own declaration, not a name this
    // module recognises: `fidelity.pptx`. A claim to an editable slide takes
    // the type's own handler when it has one, and layer 0 otherwise (D306).
    // The pixel-perfect file only runs the handlers that declare it; any other
    // claim is an image there by design, not a shortfall, so it says nothing
    // (D307).
    const claimsNative = needsNativeComposition(def, 'pptx');
    const handler = claimsNative ? NATIVE_PPTX_HANDLERS[slide?.type] : null;
    const composeNative =
      handler && (editable || handler.pixelPerfect) ? handler.compose : null;
    const generic =
      editable &&
      (editable.compose === 'generic' || (claimsNative && !composeNative));

    let pptxSlide;
    if (generic) {
      const result = await composeGenericSlide(pptx, slide, def, {
        repoRoot,
        spec,
        slideNum,
        lang: docLang,
        slideIds,
      });
      pptxSlide = result.pptxSlide;
      warnings.push(...result.warnings);
    } else if (composeNative) {
      const result = await composeNative(pptx, slide, {
        repoRoot,
        spec,
        theme,
        def,
        slideNum,
        docLang,
        slideIds,
        slideWidth: SLIDE_W_IN,
        slideHeight: SLIDE_H_IN,
      });
      pptxSlide = result.pptxSlide;
      warnings.push(...result.warnings);
    } else {
      // Regular slide: render as PNG
      pptxSlide = pptx.addSlide();
      const pngBuf = await renderSlideToPngBuffer(repoRoot, slide, {
        scale: s,
        theme,
        slideTypes,
        lang: deckLang,
        docLang,
      });

      pptxSlide.addImage({
        data: `data:image/png;base64,${pngBuf.toString('base64')}`,
        x: 0,
        y: 0,
        w: SLIDE_W_IN,
        h: SLIDE_H_IN,
        // A picture of a whole slide is named by the slide's heading, the
        // name the reader gives it, so a screen reader in PowerPoint reads
        // more than "Image 1".
        altText: slideHeading(slide, def, { index: i, lang: docLang }).text,
      });
      imageSlides.push(slideNum);
    }

    addSpeakerNotes(pptxSlide, slide);
  }

  if (editable && imageSlides.length) {
    warnings.push(
      `Slides ${imageSlides.join(', ')} exported as an image: their type ` +
        `declares PPTX fidelity 'raster'.`,
    );
  }

  let out = await pptx.write('nodebuffer');
  if (editable) out = await finishEditablePackage(out);
  // The warnings are logged here because a .pptx has no channel for a
  // message. The one finding a user acts on, which slides became pictures,
  // also travels as `imageSlides` ({@link imageSlidesHeaders}).
  for (const w of warnings) {
    log.warn(`${String(pres?.title || 'Presentation')}: ${w}`);
  }
  return { buffer: out, warnings, imageSlides };
}

/**
 * Attach a slide's speaker notes as PowerPoint notes.
 *
 * The single place where notes reach the file, for every slide the export can
 * produce. `slides[].notes` is one markdown string per slide, already resolved
 * to the exported language version (the language projection swaps the whole
 * `slides` array), so there is no second path for a translated deck.
 *
 * An empty or absent string writes nothing: pptxgenjs emits a notes part for
 * every slide regardless, but without an `addNotes` call it stays textless, so
 * PowerPoint shows an empty notes pane rather than a stray blank note.
 *
 * @param {object} pptxSlide - The pptxgenjs slide to annotate.
 * @param {object} slide - The stored slide (`{ id, type, content, notes? }`).
 */
function addSpeakerNotes(pptxSlide, slide) {
  const notes = typeof slide?.notes === 'string' ? slide.notes.trim() : '';
  if (!notes) return;
  pptxSlide.addNotes(notes);
}

/**
 * Handle a video slide for PPTX export.
 * For Bunny videos: attempts to embed the MP4 directly.
 * For YouTube/Vimeo: creates a placeholder with instructions.
 *
 * Adds its own slide, on the handler contract every composition shares
 * ({@link NATIVE_PPTX_HANDLERS}); the caller annotates it.
 *
 * Two audiences, two languages, and the split is deliberate (B358). What lands
 * *on the slide* is copy the reader of the deck sees, so it comes from the
 * deck's own language (`docLang`) through the slide-copy table — the same
 * source the PDF placeholder and every interactive type read. The `warning`
 * this returns is not copy: it goes to the server log (a .pptx has no channel
 * for a message), where the rest of this module already writes English.
 *
 * @param {object} pptx - The pptxgenjs instance.
 * @param {object} slide - The stored video slide.
 * @param {object} ctx
 * @param {number} ctx.slideNum - 1-based slide number, for the log line.
 * @param {number} ctx.slideWidth - Slide width in inches.
 * @param {number} ctx.slideHeight - Slide height in inches.
 * @param {string} [ctx.docLang] - The deck's document language.
 * @returns {Promise<{ pptxSlide: object, warnings: string[] }>}
 */
async function handleVideoSlide(pptx, slide, ctx) {
  const pptxSlide = pptx.addSlide();
  const { warning } = await composeVideo(pptxSlide, slide, ctx);
  return { pptxSlide, warnings: warning ? [warning] : [] };
}

/** The video slide's content, onto `pptxSlide`; a log line when it falls short. */
async function composeVideo(
  pptxSlide,
  slide,
  { slideNum, slideWidth, slideHeight, docLang = '' },
) {
  const content = slide?.content || {};
  const source = String(content.source || '').trim();
  const title = String(content.title || '').trim();
  const bunnyLibraryId = resolveBunnyLibraryId(content);
  const background = content.background === 'lime' ? 'DBFF00' : 'E8F0F0'; // lime or mist
  const copy = getSlideCopy(docLang);

  const parsed = parseVideoSource(source, bunnyLibraryId);

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
        message: copy.videoPptxBunnyNotEmbedded,
        detail: copy.videoPptxBunnyUnconfigured,
        instruction: copy.videoPptxAskAdmin,
        videoUrl: `https://iframe.mediadelivery.net/embed/${parsed.libraryId}/${parsed.videoId}`,
      });
      return {
        warning: `Slide ${slideNum}: Bunny video not embedded — BUNNY_PULLZONE is not configured`,
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
          message: copy.videoPptxNotEmbedded,
          // The thrown message is diagnostic data, not copy: it comes from
          // pptxgenjs in English whatever the deck says. Only the stand-in for
          // a throw without one is a sentence, so only that is translated.
          detail: err.message || copy.videoPptxEmbedFailed,
          instruction: copy.videoPptxAddManually,
          videoUrl: mp4Url,
        });
        return {
          warning: `Slide ${slideNum}: video not embedded — ${err.message}`,
        };
      }
    } else {
      // Failed to fetch - create placeholder with error
      addVideoPlaceholder(pptxSlide, {
        title,
        slideWidth,
        slideHeight,
        message: copy.videoPptxBunnyNotDownloaded,
        // As above: the fetch error is data; the hint that replaces it is copy.
        detail: fetchResult.error || copy.videoPptxBunnyFallbackHint,
        instruction: copy.videoPptxDownloadManually,
        videoUrl: mp4Url,
      });
      return {
        warning: `Slide ${slideNum}: Bunny video not embedded — ${fetchResult.error}`,
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
      message: fillCopy(copy.videoPptxProviderVideo, { provider: 'YouTube' }),
      detail: fillCopy(copy.videoPptxProviderOffline, { provider: 'YouTube' }),
      // YouTube gets its own instruction rather than the shared
      // download-from-provider one: PowerPoint's "Insert Online Video" takes a
      // YouTube URL, so there is a second route worth naming. Vimeo has none.
      instruction: copy.videoPptxYouTubeInstruction,
      videoUrl: youtubeUrl,
    });
    return {
      warning: `Slide ${slideNum}: YouTube video not embedded — download it or insert it as an online video`,
    };
  }

  // For Vimeo videos - create placeholder
  if (parsed.provider === 'vimeo' && parsed.videoId) {
    const vimeoUrl = `https://vimeo.com/${parsed.videoId}`;
    addVideoPlaceholder(pptxSlide, {
      title,
      slideWidth,
      slideHeight,
      message: fillCopy(copy.videoPptxProviderVideo, { provider: 'Vimeo' }),
      detail: fillCopy(copy.videoPptxProviderOffline, { provider: 'Vimeo' }),
      instruction: fillCopy(copy.videoPptxDownloadFromProvider, {
        provider: 'Vimeo',
      }),
      videoUrl: vimeoUrl,
    });
    return {
      warning: `Slide ${slideNum}: Vimeo video not embedded — download it manually`,
    };
  }

  // Unknown provider or empty source
  addVideoPlaceholder(pptxSlide, {
    title,
    slideWidth,
    slideHeight,
    message: copy.videoPptxSourceUnknown,
    // The unrecognised source itself is the useful detail; only its absence
    // needs a sentence.
    detail: source || copy.videoPptxNoSource,
    instruction: copy.videoPptxAddManually,
    videoUrl: source,
  });
  return {
    warning: `Slide ${slideNum}: video source not recognised`,
  };
}

/**
 * Add a video placeholder slide with instructions.
 */
function addVideoPlaceholder(
  pptxSlide,
  { title, slideWidth, slideHeight, message, detail, instruction, videoUrl },
) {
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
    pptxSlide.addText(
      [
        {
          text: videoUrl,
          options: {
            hyperlink: { url: videoUrl },
            color: '0066cc',
            fontSize: 10,
          },
        },
      ],
      {
        x: 0.5,
        y: yPos,
        w: slideWidth - 1,
        h: 0.3,
      },
    );
  }
}
