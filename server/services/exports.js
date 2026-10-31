/**
 * Exports — the one place a deck is made ready to export, on every contract
 * (A7.4, B520).
 *
 * The context an export builds from used to be prepared three times: by the
 * internal export routes (`server/export/pipeline.js`), by the public v1
 * export routes (`server/routes/public-api/v1/exports.js`) and by the queued
 * export worker (`server/jobs/queue/workers/export-worker.js`). The first two
 * were the same function line for line, apart from the answer they gave a
 * refusal; the worker had drifted on its own: another language projection
 * (no `i18n.active`, an empty version list kept), its own spelling of the
 * fields, and its own idea of where the custom slide types come from. Now each
 * caller asks here and keeps only its answer: streaming, headers, rate-limit
 * headers, the envelope (brief `one-service-layer.md`, D252–D256).
 *
 * Three entries, one per kind of caller:
 *
 *   - {@link prepareExportContext} — someone asks for an export. The deck is
 *     loaded with the read right ({@link loadPresentationForActor}, so a
 *     refusal throws `NotFoundError`/`ForbiddenError`, D255), and the export
 *     is counted once on the instance-health `export` axis (D247). This is the
 *     only place that count happens: a refused export was not one, one whose
 *     build then failed or that went to the queue was still asked for.
 *   - {@link prepareQueuedExportContext} — the worker rechecks the requester
 *     against current deck rights, bounded by the audience at enqueue. It
 *     does not count the export again.
 *   - {@link buildExportContext} — describe an already-authorized deck, as MCP
 *     does before returning a download link. No export has been requested yet,
 *     so this neither repeats the access check nor counts an export.
 *
 * Beside them, {@link prepareThemeTemplate} — the one export that is not a
 * deck's. The theme template is an artifact of a theme (B274, D126), so it
 * asks for a theme id and no presentation, but it is still an export: it is
 * counted on the same axis, under the same `pptx-template` key, from the
 * internal route and the v1 route alike.
 *
 * @module server/services/exports
 */

import {
  loadPresentationForActor,
  mayOnPresentation,
} from './presentations.js';
import { countInstanceHealth } from '../storage/instance-health.js';
import { repoRootOf } from '../storage/scope.js';
import { normalizeLang, projectPresentationForLang } from '../utils/i18n.js';
import {
  filterForExport,
  mapDeckSlideLists,
  projectPresentationForAudience,
} from '../utils/public-output.js';
import { pinSlideJumps } from '../../shared/slide-types.js';
import { spellSlideSelection } from '../../shared/slide-selection.js';
import { loadThemeAssets } from '../utils/themes.js';
import { buildThemeTemplateBuffer } from '../export/pptx-theme.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { AppError, ForbiddenError } from '../utils/errors.js';
import { getDeckPublication } from './publish-edition.js';
import { normalizeEmail } from '../../shared/email.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * What every export builds from.
 *
 * @typedef {Object} ExportContext
 * @property {Object} pres - The deck, projected onto `exportLang`, every
 *   slide kept: what the data formats (JSON, the portable `.deck`) carry.
 * @property {Object} filteredPres - What every rendered format builds from:
 *   `pres` through {@link filterForExport} (no live-only, `hideInExport` or
 *   incomplete slide, in any language version; jumps pinned first, so `#N`
 *   still names the stored slide), for the author and a reader alike (B590).
 *   `pres` itself when the export strips nothing (`stripLiveOnly: false`, the
 *   data formats).
 * @property {Object|null} theme - The deck's resolved theme assets.
 * @property {Record<string, Object>} slideTypes - Core plus the deck
 *   organization's published custom slide types.
 * @property {string|null} exportLang - The language projected onto, or `null`
 *   for a format that carries every language version.
 * @property {string} langSuffix - The filename suffix for `exportLang`.
 * @property {string} title - The projected title, for the filename; with a
 *   slide selection, followed by the slides it names.
 * @property {number[]|null} slideSelection - The slides `?slides=` named, as
 *   sorted 1-based positions in the stored deck, or `null` for every slide.
 */

/**
 * The formats that render a slide selection (B871): the slide PDF (its file,
 * stream and browser-print preview share the format id) and the PNG ZIP.
 */
const SLIDE_SELECTION_FORMATS = new Set(['pdf-slides', 'png-zip']);

/** Refuse a `slides` selection as the canonical 400 `invalid`. */
function invalidSelection(message) {
  return new AppError(message, 400, { field: 'slides' }, 'invalid');
}

/**
 * Parse a slide selection: comma-separated slide numbers and ranges, 1-based
 * as the editor numbers its slides (`1,3-5`). The one reader of the spelling,
 * for every export route and the queued worker.
 *
 * @param {string|null|undefined} raw - The `slides` parameter; absent means
 *   the whole deck.
 * @returns {number[]|null} Sorted, de-duplicated slide numbers, or `null`.
 * @throws {AppError} 400 `invalid` with `details.field = 'slides'`.
 */
export function parseSlideSelection(raw) {
  if (raw === null || raw === undefined) return null;
  const numbers = new Set();
  for (const part of String(raw).split(',')) {
    const match = /^\s*(\d{1,4})(?:\s*-\s*(\d{1,4}))?\s*$/.exec(part);
    const from = Number(match?.[1]);
    const to = match?.[2] === undefined ? from : Number(match[2]);
    if (!match || from < 1 || to < from) {
      throw invalidSelection(
        `Unknown slide selection '${raw}': use slide numbers and ranges, such as 1,3-5.`,
      );
    }
    for (let n = from; n <= to; n += 1) numbers.add(n);
  }
  return [...numbers].sort((a, b) => a - b);
}

/**
 * Keep the selected slides of every slide list the deck carries, by the ids
 * at those positions of `slides`. Jumps are pinned against the whole deck
 * first, so `#N` on a kept slide still names the stored slide N.
 *
 * @param {Object} pres - The projected deck.
 * @param {number[]} selection - From {@link parseSlideSelection}.
 * @param {Record<string, Object>} slideTypes
 * @returns {Object}
 * @throws {AppError} 400 `invalid` when a number is past the last slide.
 */
function selectSlides(pres, selection, slideTypes) {
  const slides = Array.isArray(pres?.slides) ? pres.slides : [];
  const last = selection[selection.length - 1];
  if (last > slides.length) {
    throw invalidSelection(
      `Slide ${last} does not exist: this deck has ${slides.length} slides.`,
    );
  }
  const ids = new Set(selection.map((n) => slides[n - 1]?.id));
  return mapDeckSlideLists(pres, (list) =>
    pinSlideJumps(list, slideTypes).filter((slide) => ids.has(slide?.id)),
  );
}

/**
 * The filename part a selection adds: `-slide-03` for one slide (as the
 * single PNG names it), `-slides-1_3-5` for more.
 *
 * @param {number[]} selection
 * @returns {string}
 */
function selectionTitleSuffix(selection) {
  if (selection.length === 1) {
    return `-slide-${String(selection[0]).padStart(2, '0')}`;
  }
  return `-slides-${spellSlideSelection(selection, '_')}`;
}

/**
 * The filename suffix for an export language.
 *
 * @param {string|null} exportLang
 * @returns {string} `-NL`, `-EN` or `''`.
 */
function langSuffixFor(exportLang) {
  return exportLang === 'nl' ? '-NL' : exportLang === 'en-GB' ? '-EN' : '';
}

/**
 * Build the context from a deck the caller may export.
 *
 * The custom slide types are the deck's organization's: the deck is what is
 * rendered, and `presentations.organization_id` is never null.
 *
 * @param {StorageScope} scope
 * @param {Object} pres
 * @param {{ exportLang: string|null, stripLiveOnly: boolean, audience: 'author'|'reader', slideSelection?: number[]|null }} options
 * @returns {Promise<ExportContext>}
 */
export async function buildExportContext(
  scope,
  pres,
  { exportLang, stripLiveOnly, audience, slideSelection = null },
) {
  const [theme, slideTypes, published] = await Promise.all([
    loadThemeAssets(repoRootOf(scope), pres.theme, scope),
    buildMergedSlideTypes({ organizationId: pres.organizationId }),
    // A video slide's "watch online" link points into the newest edition.
    getDeckPublication(scope, pres),
  ]);
  const safe = projectPresentationForAudience(
    { ...pres, published },
    {
      audience,
      channel: 'viewer',
      slideTypes,
    },
  );
  const projected = exportLang
    ? projectPresentationForLang(safe, exportLang)
    : safe;
  const selected = slideSelection
    ? selectSlides(projected, slideSelection, slideTypes)
    : projected;
  const filteredPres = stripLiveOnly
    ? filterForExport(selected, { slideTypes })
    : selected;
  if (slideSelection && !filteredPres.slides?.length) {
    throw invalidSelection(
      'None of the selected slides is exported: they are hidden in exports or live-only.',
    );
  }
  const title = projected.title || 'presentation';
  return {
    pres: projected,
    filteredPres,
    theme,
    slideTypes,
    exportLang,
    langSuffix: langSuffixFor(exportLang),
    title: slideSelection
      ? title + selectionTitleSuffix(slideSelection)
      : title,
    slideSelection,
  };
}

/**
 * Read a request's slide selection for its format: a format that renders
 * the whole deck by nature refuses one rather than ignoring it.
 *
 * @param {string} format
 * @param {string|null|undefined} slides
 * @returns {number[]|null}
 */
function slideSelectionFor(format, slides) {
  const selection = parseSlideSelection(slides);
  if (selection && !SLIDE_SELECTION_FORMATS.has(format)) {
    throw invalidSelection(
      `The ${format} export has no slide selection: it is the whole deck.`,
    );
  }
  return selection;
}

/**
 * Prepare an export someone asks for.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {string} input.format - The export's format id (the `export` axis
 *   vocabulary in `server/storage/instance-health.js`).
 * @param {string|null} [input.lang] - The requested language, normalized
 *   here; unknown or absent means the deck's dominant version.
 * @param {boolean} [input.allLanguages=false] - Skip the projection, for a
 *   format that carries every language version itself (the portable deck,
 *   D89): projecting first is what used to drop the other versions.
 * @param {boolean} [input.stripLiveOnly=true] - Filter `filteredPres` for
 *   export; `false` only for the data formats, which build from `pres`.
 * @param {string|null} [input.slides] - A slide selection
 *   ({@link parseSlideSelection}); absent means every slide.
 * @returns {Promise<ExportContext>}
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {ForbiddenError} The deck is there, the read right is not.
 * @throws {AppError} 400 `invalid` naming `slides`: an unreadable selection,
 *   one on a format without selections, or one that leaves nothing to render.
 */
export async function prepareExportContext(
  scope,
  identity,
  {
    presentationId,
    format,
    lang,
    allLanguages = false,
    stripLiveOnly = true,
    slides = null,
  },
) {
  const slideSelection = slideSelectionFor(format, slides);
  const pres = await loadPresentationForActor(scope, identity, presentationId);
  const audience = await exportAudience(pres, identity, format);
  const actor = identity.actor;
  const exportAccess = {
    version: 1,
    presentationId,
    format,
    audience,
    actor: {
      id: actor.id || null,
      email: actor.email,
      organizationId: actor.organizationId || null,
      ...(actor.unrestricted === true ? { unrestricted: true } : {}),
    },
  };
  const ctx = await buildExportContext(scope, pres, {
    exportLang: allLanguages ? null : normalizeLang(lang),
    stripLiveOnly,
    audience,
    slideSelection,
  });
  // After the context: a selection it refuses was not an export either.
  countInstanceHealth([{ axis: 'export', key: format }]);
  return { ...ctx, exportAccess };
}

/** The current deck right, independent of an API key's action permissions. */
async function exportAudience(pres, identity, format, maximum = 'author') {
  const audience =
    maximum === 'author' && (await mayOnPresentation(pres, identity, 'write'))
      ? 'author'
      : 'reader';
  if (audience === 'reader' && ['notes-md', 'notes-docx'].includes(format)) {
    throw new ForbiddenError('Speaker notes require presentation write access');
  }
  return audience;
}

/** Missing pre-contract jobs/results are unsafe and must be exported again. */
function requireExportAccess(access) {
  if (
    access?.version !== 1 ||
    !access.presentationId ||
    !access.format ||
    !['author', 'reader'].includes(access.audience) ||
    !normalizeEmail(access.actor?.email)
  ) {
    throw new ForbiddenError('Export access context missing; export again');
  }
}

/**
 * Recheck a queued request without promoting its enqueue audience or counting
 * it twice. No fallback to a system/author export for older jobs.
 * @param {StorageScope} scope
 * @param {Object} input
 * @returns {Promise<ExportContext>}
 */
export async function prepareQueuedExportContext(
  scope,
  {
    presentationId,
    format,
    lang,
    stripLiveOnly = true,
    slides = null,
    exportAccess,
  },
) {
  requireExportAccess(exportAccess);
  const slideSelection = slideSelectionFor(format, slides);
  if (
    exportAccess.presentationId !== presentationId ||
    exportAccess.format !== format
  ) {
    throw new ForbiddenError('Export access context does not match the job');
  }
  const identity = { actor: exportAccess.actor };
  const pres = await loadPresentationForActor(scope, identity, presentationId);
  const audience = await exportAudience(
    pres,
    identity,
    format,
    exportAccess.audience,
  );
  return {
    ...(await buildExportContext(scope, pres, {
      exportLang: normalizeLang(lang),
      stripLiveOnly,
      audience,
      slideSelection,
    })),
    exportAccess: { ...exportAccess, audience },
  };
}

/**
 * Check the finished artifact against the current downloader's rights. An
 * author artifact cannot be downgraded after building: refuse and re-export.
 * @param {StorageScope} scope
 * @param {{actor: Actor}} identity
 * @param {Object} exportAccess - Server-stamped context of the built artifact
 * @returns {Promise<void>}
 */
export async function authorizeExportResult(scope, identity, exportAccess) {
  requireExportAccess(exportAccess);
  if (
    normalizeEmail(identity.actor?.email) !==
      normalizeEmail(exportAccess.actor.email) ||
    (identity.actor?.organizationId || null) !==
      exportAccess.actor.organizationId
  ) {
    throw new ForbiddenError('Export belongs to another actor');
  }
  const pres = await loadPresentationForActor(
    scope,
    identity,
    exportAccess.presentationId,
  );
  const audience = await exportAudience(
    pres,
    identity,
    exportAccess.format,
    exportAccess.audience,
  );
  if (audience !== exportAccess.audience) {
    throw new ForbiddenError('Presentation rights changed; export again');
  }
}

/**
 * Prepare the PPTX template of a theme.
 *
 * The artifact belongs to the theme, not to a deck: the same theme hands back
 * the same bytes whichever presentation happens to use it. Until B274 it hung
 * off a deck anyway, because the deck was what named the theme; now the theme
 * is asked for directly and the deck route is gone.
 *
 * Authorization is {@link loadThemeAssets}' own: a session scope sees its
 * organization's themes and the seeds, and an id outside that throws the 404
 * it throws for an unknown theme — the same answer, which is what a caller
 * probing for other organizations' theme ids should get.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {string} themeId - The theme's UUID.
 * @returns {Promise<{ buffer: Buffer, label: string }>} The template and the
 *   theme's label, for the filename.
 * @throws {import('../utils/errors.js').AppError} No such theme in this scope.
 */
export async function prepareThemeTemplate(scope, themeId) {
  const repoRoot = repoRootOf(scope);
  const theme = await loadThemeAssets(repoRoot, themeId, scope);
  countInstanceHealth([{ axis: 'export', key: 'pptx-template' }]);
  return {
    buffer: await buildThemeTemplateBuffer(repoRoot, theme),
    // The same fallback the template titles itself with, so the filename and
    // the document's title cannot disagree.
    label: String(theme?.label || theme?.id || 'Theme'),
  };
}
