import { buildStandaloneHtml } from '../../export/html.js';
import { buildPrintHtml } from '../../export/print.js';
import { buildSlidesPdfHtml } from '../../export/pdf-slides.js';
import { buildSlidesPngExportHtml } from '../../export/png-slides.js';
import { buildSlidesPngZipBuffer } from '../../export/png-zip.js';
import { buildPptxBuffer } from '../../export/pptx.js';
import { buildHandoffZipBuffer } from '../../export/handoff-zip.js';
import { buildDeckBundle } from '../../export/deck-bundle.js';
import { buildNotesDocxBuffer, buildNotesMarkdown } from '../../export/notes.js';
import { renderSlideToPngBuffer } from '../../render/png.js';
import { renderSlidesToPdfBuffer } from '../../render/pdf.js';
import { presentationToDeck } from '../../../shared/slide-types.js';
import { badRequest } from '../../utils/http.js';
import {
  createExportRoute,
  createHtmlPreviewRoute,
  createAsyncExportRoute,
  prepareExportContext,
  parseScaleParam,
  sendExportResponse,
  handleExportError,
  getLangSuffix,
} from '../../export/pipeline.js';

// Define export routes using the pipeline factory
const exportRoutes = [
  // JSON export
  createExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/json$/,
    contentType: 'application/json; charset=utf-8',
    extension: '.json',
    stripLiveOnly: false,
    buildContent: (ctx) => {
      const deck = presentationToDeck(ctx.pres);
      return JSON.stringify(deck, null, 2);
    },
  }),

  // .deck bundle: self-contained portable deck (deck.json + content-addressed
  // assets + manifest inventory). Renders/round-trips without the server.
  createExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/deck\.zip$/,
    contentType: 'application/vnd.slidecreator.deck',
    extension: '.deck',
    stripLiveOnly: false,
    buildContent: async (ctx, { repoRoot }) => buildDeckBundle(repoRoot, ctx.pres),
  }),

  // HTML export (download)
  createExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/html$/,
    contentType: 'text/html; charset=utf-8',
    extension: '.html',
    buildContent: async (ctx, { repoRoot }) =>
      buildStandaloneHtml(repoRoot, ctx.filteredPres, { theme: ctx.theme, slideTypes: ctx.slideTypes }),
  }),

  // PDF preview (browser render, then print-to-PDF)
  createHtmlPreviewRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/pdf$/,
    buildHtml: async (ctx, { repoRoot }) =>
      buildPrintHtml(repoRoot, ctx.filteredPres, { theme: ctx.theme, slideTypes: ctx.slideTypes }),
  }),

  // PDF slides preview
  createHtmlPreviewRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/pdf-slides$/,
    buildHtml: async (ctx, { repoRoot }) =>
      buildSlidesPdfHtml(repoRoot, ctx.filteredPres, { theme: ctx.theme, slideTypes: ctx.slideTypes }),
  }),

  // Server-rendered PDF download (deterministic across browsers/OS).
  // Pattern does not clash with the pdf-slides$ preview route thanks to the $ anchors.
  createAsyncExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/pdf-slides\.pdf$/,
    contentType: 'application/pdf',
    extension: '.pdf',
    exportType: 'pdf-slides',
    buildContent: async (ctx, { repoRoot }) =>
      renderSlidesToPdfBuffer(repoRoot, ctx.filteredPres, {
        theme: ctx.theme,
        slideTypes: ctx.slideTypes,
      }),
  }),

  // PNG slides preview
  createHtmlPreviewRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/png$/,
    buildHtml: async (ctx, { repoRoot }) =>
      buildSlidesPngExportHtml(repoRoot, ctx.filteredPres, { theme: ctx.theme, slideTypes: ctx.slideTypes }),
  }),

  // PNG slides bundled as a single ZIP ("Download all PNGs")
  createExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/png\.zip$/,
    contentType: 'application/zip',
    extension: '-png.zip',
    buildContent: async (ctx, { repoRoot, url }) => {
      const scale = parseScaleParam(url);
      return buildSlidesPngZipBuffer(repoRoot, ctx.filteredPres, {
        scale,
        theme: ctx.theme,
        slideTypes: ctx.slideTypes,
      });
    },
  }),

  // PPTX export (supports async via queue)
  createAsyncExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/pptx$/,
    contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    extension: '.pptx',
    exportType: 'pptx',
    buildContent: async (ctx, { repoRoot, url }) => {
      const scale = parseScaleParam(url);
      const result = await buildPptxBuffer(repoRoot, ctx.filteredPres, { scale, theme: ctx.theme, slideTypes: ctx.slideTypes });
      // Store warnings on context for potential logging/debugging
      ctx.pptxWarnings = result.warnings;
      return result.buffer;
    },
  }),

  // Handoff ZIP export (supports async via queue)
  createAsyncExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/handoff\.zip$/,
    contentType: 'application/zip',
    extension: '-handoff.zip',
    exportType: 'handoff-zip',
    buildContent: async (ctx, { repoRoot, url }) => {
      const scale = parseScaleParam(url);
      return buildHandoffZipBuffer(repoRoot, ctx.filteredPres, {
        scale,
        theme: ctx.theme,
        lang: ctx.exportLang || '',
        slideTypes: ctx.slideTypes,
      });
    },
  }),

  // Notes Markdown export
  createExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/notes\.md$/,
    contentType: 'text/markdown; charset=utf-8',
    extension: '-notes.md',
    buildContent: (ctx) => buildNotesMarkdown(ctx.filteredPres, { includeEmpty: true }),
  }),

  // Notes DOCX export
  createExportRoute({
    pattern: /^\/api\/presentations\/([^/]+)\/export\/notes\.docx$/,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    extension: '-notes.docx',
    buildContent: async (ctx) => {
      const md = buildNotesMarkdown(ctx.filteredPres, { includeEmpty: true });
      return buildNotesDocxBuffer(md);
    },
  }),
];

// Special handler for individual PNG slide (has extra URL param)
async function handlePngSlideExport({ repoRoot, req, res, url, authedUser }) {
  const match = url.pathname.match(/^\/api\/presentations\/([^/]+)\/export\/png\/(\d+)\.png$/);
  if (!match || req.method !== 'GET') return false;

  const presentationId = match[1];
  const slideNum = Number(match[2] || 0) || 0; // 1-based

  const ctx = await prepareExportContext({
    repoRoot,
    res,
    url,
    authedUser,
    presentationId,
    stripLiveOnly: true,
  });

  if (!ctx) return true;

  const slides = Array.isArray(ctx.filteredPres?.slides) ? ctx.filteredPres.slides : [];
  if (slideNum < 1 || slideNum > slides.length) {
    badRequest(res, 'Unknown slide');
    return true;
  }

  const scale = parseScaleParam(url);

  try {
    const buf = await renderSlideToPngBuffer(repoRoot, slides[slideNum - 1], {
      scale,
      theme: ctx.theme,
      slideTypes: ctx.slideTypes,
    });

    sendExportResponse(res, {
      contentType: 'image/png',
      filename: `${ctx.title}-slide-${String(slideNum).padStart(2, '0')}`,
      langSuffix: ctx.langSuffix,
      extension: '.png',
      data: buf,
    });
    return true;
  } catch (e) {
    handleExportError(res, e);
    return true;
  }
}

export async function handleExports(context) {
  // Try PNG slide export first (more specific pattern)
  if (await handlePngSlideExport(context)) return true;

  // Try each registered export route
  for (const handler of exportRoutes) {
    if (await handler(context)) return true;
  }

  return false;
}