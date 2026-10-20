/**
 * Export job worker.
 * Processes presentation export jobs (PDF, PPTX, PNG, etc.)
 *
 * Job types:
 * - pptx: Export to PowerPoint
 * - pdf: Export to PDF (print layout)
 * - pdf-slides: Export to PDF (slide layout)
 * - png: Export slides to PNG images
 * - handoff-zip: Export handoff package
 * - notes-docx: Export notes to Word document
 * - notes-md: Export notes to Markdown
 */

import { registerWorker, QUEUE_NAMES } from '../connection.js';
import {
  buildEditablePptxBuffer,
  buildPptxBuffer,
} from '../../../export/pptx.js';
import { buildHandoffZipBuffer } from '../../../export/handoff-zip.js';
import { renderSlidesToPdfBuffer } from '../../../render/pdf.js';
import {
  buildNotesDocxBuffer,
  buildNotesMarkdown,
} from '../../../export/notes.js';
import { buildStandaloneHtml } from '../../../export/html.js';
import { prepareQueuedExportContext } from '../../../services/exports.js';
import { jobScope } from '../../../storage/scope.js';
import { createLogger } from '../../../utils/logger.js';
import { storeExportResult } from '../../../export/result-store.js';

const log = createLogger('export-worker');

/**
 * Process an export job.
 * @param {Object} job - BullMQ job
 * @returns {Promise<Object>} Result with download info
 */
export async function processExportJob(job) {
  // The enqueue site (export/pipeline.js) passes the export type as the BullMQ
  // job *name*: `addJob(QUEUE_NAMES.EXPORT, exportType, data)`. The name is the
  // type's only carrier — `job.data` carries no `type` field.
  const type = job.name;
  const { scale = 1 } = job.data;

  log.info(`Processing ${type} export for job ${job.id}`);

  // Update progress
  await job.updateProgress(10);

  // The request admitted and counted this export when it queued it; the
  // worker rechecks current rights within the enqueue audience.
  const { presentationId, format, lang, stripLiveOnly, exportAccess } =
    job.data;
  const ctx = await prepareQueuedExportContext(
    jobScope(job.data, 'export job'),
    { presentationId, format, lang, stripLiveOnly, exportAccess },
  );
  await job.updateProgress(30);

  let buffer;
  let contentType;
  let extension;

  switch (type) {
    case 'pptx': {
      const result = await buildPptxBuffer(job.data.repoRoot, ctx.pres, {
        scale,
        theme: ctx.theme,
        slideTypes: ctx.slideTypes,
      });
      buffer = result.buffer;
      contentType =
        'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      extension = '.pptx';
      break;
    }

    case 'pptx-editable': {
      const result = await buildEditablePptxBuffer(
        job.data.repoRoot,
        ctx.pres,
        {
          scale,
          theme: ctx.theme,
          slideTypes: ctx.slideTypes,
          compose: job.data.options?.compose,
        },
      );
      buffer = result.buffer;
      contentType =
        'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      extension = '-editable.pptx';
      break;
    }

    case 'handoff-zip': {
      buffer = await buildHandoffZipBuffer(job.data.repoRoot, ctx.pres, {
        scale,
        theme: ctx.theme,
        lang: ctx.exportLang || '',
        slideTypes: ctx.slideTypes,
      });
      contentType = 'application/zip';
      extension = '-handoff.zip';
      break;
    }

    case 'pdf-slides': {
      buffer = await renderSlidesToPdfBuffer(
        job.data.repoRoot,
        ctx.filteredPres,
        {
          theme: ctx.theme,
          slideTypes: ctx.slideTypes,
        },
      );
      contentType = 'application/pdf';
      extension = '.pdf';
      break;
    }

    case 'notes-docx': {
      const md = buildNotesMarkdown(ctx.filteredPres, {
        includeEmpty: true,
        slideTypes: ctx.slideTypes,
      });
      buffer = await buildNotesDocxBuffer(md);
      contentType =
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      extension = '-notes.docx';
      break;
    }

    case 'notes-md': {
      buffer = Buffer.from(
        buildNotesMarkdown(ctx.filteredPres, {
          includeEmpty: true,
          slideTypes: ctx.slideTypes,
        }),
      );
      contentType = 'text/markdown; charset=utf-8';
      extension = '-notes.md';
      break;
    }

    case 'html': {
      const html = await buildStandaloneHtml(
        job.data.repoRoot,
        ctx.filteredPres,
        {
          theme: ctx.theme,
          slideTypes: ctx.slideTypes,
        },
      );
      buffer = Buffer.from(html);
      contentType = 'text/html; charset=utf-8';
      extension = '.html';
      break;
    }

    default:
      throw new Error(`Unknown export type: ${type}`);
  }

  await job.updateProgress(90);

  // Store result for download. `ownerEmail` gates the download/status routes
  // against enumeration of other users' exports (security-audit H3).
  const result = {
    buffer,
    contentType,
    extension,
    filename: ctx.filteredPres.title || 'presentation',
    langSuffix: ctx.langSuffix,
    ownerEmail: job.data.ownerEmail || null,
    exportAccess: ctx.exportAccess,
  };

  storeExportResult(String(job.id), result);
  await job.updateProgress(100);

  return {
    ready: true,
    contentType,
    extension,
    size: buffer.length,
  };
}

/**
 * Initialize the export worker.
 * @returns {Promise<Object|null>} Worker instance
 */
export async function initializeExportWorker() {
  return registerWorker(QUEUE_NAMES.EXPORT, processExportJob, {
    concurrency: 2, // Max 2 concurrent exports
  });
}
