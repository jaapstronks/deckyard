/**
 * Translate a deck — the one way a language version is made from another,
 * decided and done in one place (A7.4, B610).
 *
 * Four writers carried the same forty lines and decided on their own: the
 * editor's `POST /api/presentations/:id/translate`, its `/translate/missing`
 * (gaps only, with a `running` marker before the model call and a reload
 * after it), the public `POST /api/v1/presentations/:id/translate` and the
 * translate queue worker. Each seeded the source version, resolved the pair,
 * called the model and wrote the deck back; where they differed, they
 * differed silently: the editor and the worker fell back to "the other
 * language of the nl/en-GB pair" when `to` was absent and replaced an unknown
 * `from` with the deck's active language, the worker threw bare `Error`s
 * where v1 answered 400 and skipped the size limit, only v1 wrote the
 * `i18n.translation` marker. Now every contract parses and answers, and what
 * a translation means happens here:
 *
 *   - the deck is loaded once with {@link loadPresentationForActor} at
 *     `access: 'write'` (404 absent, 403 not writable; D255);
 *   - the pair is refused before the model call (lesson 2), with 400
 *     `invalid` + `details.field`: a missing or unknown `to`, an unknown
 *     `from` or one naming a version the deck does not carry, `from` equal to
 *     `to`, an existing target without `overwrite` or `fillMissing`, and a
 *     non-boolean flag (lesson 3: no silent fallback on any contract);
 *   - the model translates; the version and the `i18n.translation[to]`
 *     marker are written on every contract;
 *   - the store's result goes through {@link throwStorageFailure} (D254), the
 *     size limit included: a translation is a save like any other.
 *
 * The written body is made consistent with the write seam first: the seam
 * takes top-level `title`/`slides` as the buffer of `i18n.active`
 * (`normalizeI18n`), while a loaded deck carries the dominant version there.
 * Writing a loaded deck back with `active` pointing elsewhere would overwrite
 * that version with the dominant text; {@link writeTranslatedDeck} aligns the
 * top-level fields to the active version before every write
 * (`alignToActiveVersion`, B620).
 *
 * @module server/services/translate
 */

import {
  getPresentation,
  updatePresentation,
} from '../storage/presentations/index.js';
import {
  translatePresentationStrings,
  translatePresentationStringsFillMissing,
} from '../utils/openai/translate.js';
import {
  DEFAULT_DECK_LANG,
  normalizeLang,
  TRANSLATION_LANGS,
} from '../../shared/i18n-utils.js';
import {
  buildBlankTargetFromSource,
  computeMissingTranslation,
  pickVersion,
  slideTextRows,
} from '../../shared/i18n-progress.js';
import { valueAtPath } from '../../shared/slide-types/text-fields.js';
import {
  AppError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
import {
  recordTranslatedVersion,
  recordTranslationSource,
  translationSource,
  translationFieldKey,
} from '../../shared/translation-provenance.js';
import { alignToActiveVersion } from './deck-versions.js';
import { loadPresentationForActor } from './presentations.js';

/**
 * @typedef {import('./actor.js').Actor} Actor
 * @typedef {import('../storage/scope.js').StorageScope} StorageScope
 */

/**
 * @param {string} field
 * @param {string} message
 * @returns {AppError} 400 `invalid` naming the field.
 */
function invalidTranslation(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

const isObject = (value) => !!value && typeof value === 'object';

/** The deck's `i18n` block and its `versions` map, present and objects. */
function ensureI18n(pres) {
  pres.i18n = isObject(pres.i18n) ? pres.i18n : {};
  pres.i18n.versions = isObject(pres.i18n.versions) ? pres.i18n.versions : {};
  return pres.i18n;
}

/**
 * The language the deck is written in, as stored: `dominant`, or the deck's
 * active language on a deck that never named one (a legacy deck, whose
 * top-level fields are its only version).
 */
function storedDominant(pres) {
  const i18n = isObject(pres.i18n) ? pres.i18n : {};
  return (
    normalizeLang(i18n.dominant) ||
    normalizeLang(i18n.active) ||
    DEFAULT_DECK_LANG
  );
}

/**
 * The source a caller that names none translates from: the active version
 * when the deck carries it, else the dominant one.
 */
function defaultSource(pres) {
  const i18n = isObject(pres.i18n) ? pres.i18n : {};
  const versions = isObject(i18n.versions) ? i18n.versions : {};
  const active = normalizeLang(i18n.active);
  if (active && versions[active]) return active;
  return storedDominant(pres);
}

/**
 * A boolean flag of the input: absent is the default, a boolean is itself,
 * anything else is refused (a string `"false"` is not a no).
 */
function flag(input, key, defaultValue) {
  const value = input[key];
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== 'boolean') {
    throw invalidTranslation(key, `${key} must be a boolean`);
  }
  return value;
}

/**
 * Resolve and refuse the translation request before any work (lesson 2).
 * Exported so an adapter that pays for the model call can ask first.
 *
 * @param {Object} pres - The deck as loaded.
 * @param {Object} input
 * @param {*} [input.from] - Source language; absent, the active version
 *   when the deck carries it, else the dominant one.
 * @param {*} input.to - Target language, required.
 * @param {*} [input.overwrite=false] - Replace an existing target version.
 * @param {*} [input.fillMissing=true] - Keep what the target already has and
 *   translate only its gaps.
 * @returns {{ from: string, to: string, overwrite: boolean, fillMissing: boolean }}
 * @throws {AppError} 400 `invalid`, `details.field` naming the refused field.
 */
export function assertTranslatableInput(pres, input = {}) {
  const { from, to } = input;
  if (to === undefined || to === null || to === '') {
    throw invalidTranslation('to', 'A target language ("to") is required.');
  }
  const target = normalizeLang(to);
  if (!target) {
    throw invalidTranslation(
      'to',
      `Unknown target language ${JSON.stringify(to)}. Supported languages: ${TRANSLATION_LANGS.join(', ')}`,
    );
  }

  let source;
  if (from === undefined || from === null || from === '') {
    source = defaultSource(pres);
  } else {
    source = normalizeLang(from);
    if (!source) {
      throw invalidTranslation(
        'from',
        `Unknown source language ${JSON.stringify(from)}. Supported languages: ${TRANSLATION_LANGS.join(', ')}`,
      );
    }
    const versions = isObject(pres.i18n?.versions) ? pres.i18n.versions : {};
    if (source !== storedDominant(pres) && !versions[source]) {
      throw invalidTranslation(
        'from',
        `This presentation has no ${source} version to translate from.`,
      );
    }
  }

  if (source === target) {
    throw invalidTranslation(
      'to',
      'Source and target languages must be different.',
    );
  }

  const overwrite = flag(input, 'overwrite', false);
  const fillMissing = flag(input, 'fillMissing', true);
  const versions = isObject(pres.i18n?.versions) ? pres.i18n.versions : {};
  if (versions[target] && !overwrite && !fillMissing) {
    throw invalidTranslation(
      'to',
      `Target language version already exists (${target}). Pass overwrite: true to replace it.`,
    );
  }

  return { from: source, to: target, overwrite, fillMissing };
}

/**
 * Make sure the deck carries the source as a version. A deck that never
 * named a dominant language has its only version in the top-level fields;
 * that becomes `versions[dominant]`. The translation's source is recorded as
 * the active language, as every writer did.
 */
function seedSourceVersion(pres, from) {
  const i18n = ensureI18n(pres);
  const dominant = storedDominant(pres);
  i18n.dominant = dominant;
  i18n.active = from;
  const topLevel = () => ({ title: pres.title, slides: pres.slides });
  if (!i18n.versions[dominant]) i18n.versions[dominant] = topLevel();
  if (!i18n.versions[from]) i18n.versions[from] = topLevel();
}

/**
 * The `i18n.translation[to]` marker: the status of the target version and
 * which version it was made from.
 */
function markTranslation(i18n, to, { status, from, missingCount }) {
  i18n.translation = isObject(i18n.translation) ? i18n.translation : {};
  const marker = { status, from, updatedAt: new Date().toISOString() };
  if (typeof missingCount === 'number') marker.missingCount = missingCount;
  i18n.translation[to] = marker;
}

/** Bound both slide count and prompt size before asking for translated JSON. */
function translationBatches(slides) {
  const batches = [];
  let batch = [];
  let size = 0;
  for (const slide of slides) {
    const slideSize = JSON.stringify(slide).length;
    if (batch.length && (batch.length === 4 || size + slideSize > 6000)) {
      batches.push(batch);
      batch = [];
      size = 0;
    }
    batch.push(slide);
    size += slideSize;
  }
  if (batch.length || !batches.length) batches.push(batch);
  return batches;
}

/** Tell each caller that the persisted target is incomplete and can be retried. */
function partialTranslationError(completed, total) {
  return new AppError(
    `Translation is incomplete after ${completed} of ${total} batches. Earlier translations were saved; retry with fillMissing: true.`,
    502,
    { completedBatches: completed, totalBatches: total, retryable: true },
    'translation_partial',
  );
}

/** Apply model answers only where the planned gap has not changed meanwhile. */
function applyMissingAnswers(
  freshTarget,
  plannedTarget,
  filled,
  missing,
  { allowEmpty = false, accepted = null } = {},
) {
  const result = structuredClone(freshTarget);
  const byId = (version, id) =>
    version.slides?.find((slide) => slide?.id === id);
  for (const gap of missing) {
    if (gap.kind === 'deck') {
      if (
        result.title === plannedTarget.title &&
        (allowEmpty || filled.title?.trim())
      ) {
        result.title = filled.title;
        accepted?.push(gap);
      }
      continue;
    }
    const current = byId(result, gap.slideId);
    const fresh = byId(freshTarget, gap.slideId);
    const planned = byId(plannedTarget, gap.slideId);
    const answer = byId(filled, gap.slideId);
    if (!current || !fresh || !planned || !answer) continue;
    const path = gap.path;
    const before = valueAtPath(planned.content, path);
    if (valueAtPath(fresh.content, path) !== before) continue;
    // Item paths are positional. A change anywhere in an ancestor array can
    // shift the answer to a different item, even if this field is still empty.
    let plannedNode = planned.content;
    let currentNode = fresh.content;
    let sameStructure = true;
    for (const step of path) {
      if (
        Array.isArray(plannedNode) &&
        JSON.stringify(plannedNode) !== JSON.stringify(currentNode)
      ) {
        sameStructure = false;
        break;
      }
      plannedNode = plannedNode?.[step];
      currentNode = currentNode?.[step];
    }
    if (!sameStructure) continue;
    const translated = valueAtPath(answer.content, path);
    if (typeof translated !== 'string' || (!allowEmpty && !translated.trim()))
      continue;
    let node = current.content;
    for (let i = 0; i < path.length - 1; i += 1) {
      if (!node || typeof node !== 'object') break;
      const step = path[i];
      node[step] ??= typeof path[i + 1] === 'number' ? [] : {};
      node = node[step];
    }
    if (!node || typeof node !== 'object') continue;
    node[path.at(-1)] = translated;
    accepted?.push(gap);
  }
  return result;
}

/**
 * Write a deck whose `i18n` block was changed. The top-level fields are
 * aligned to the active version first (see the module comment); the store's
 * refusal is thrown as the service's error (D254).
 *
 * @param {StorageScope} scope
 * @param {Actor} actor
 * @param {Object} pres - The deck to write, `i18n` included.
 * @returns {Promise<Object>} The deck as stored.
 */
async function writeTranslatedDeck(scope, actor, pres) {
  const updated = await updatePresentation(
    scope,
    pres.id,
    alignToActiveVersion(pres),
    {
      actorEmail: actor?.email || null,
      user: actor || null,
      expectedRevision: pres.revision,
    },
  );
  if (!updated) throw new NotFoundError('Presentation not found');
  if (updated.ok === false) {
    throwStorageFailure(
      updated,
      updated.errors
        ?.map((error) => error.message)
        .filter(Boolean)
        .join('; ') || undefined,
    );
  }
  return updated;
}

/**
 * Translate a deck into another language, on every contract.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The translating actor (D253).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {*} [input.from] - Source language (see {@link assertTranslatableInput}).
 * @param {*} input.to - Target language, required.
 * @param {*} [input.overwrite=false] - Replace an existing target version.
 * @param {*} [input.fillMissing=true] - Keep what the target already has.
 * @param {string|null} [input.vendor] - The LLM vendor, when the caller names one.
 * @returns {Promise<{ from: string, to: string, presentation: Object }>} The
 *   pair as resolved and the deck as stored after the write.
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid` naming a refused field; a storage refusal
 *   (409 `limit_exceeded` over the size limit); the model's own error.
 */
export async function translatePresentation(
  scope,
  identity,
  { presentationId, from, to, overwrite, fillMissing, vendor = null },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const pair = assertTranslatableInput(pres, {
    from,
    to,
    overwrite,
    fillMissing,
  });
  seedSourceVersion(pres, pair.from);

  const src = pickVersion(pres, pair.from);
  const existingTarget =
    !pair.overwrite && isObject(pres.i18n.versions[pair.to])
      ? pres.i18n.versions[pair.to]
      : null;
  const batches = translationBatches(src.slides || []);
  const blank = buildBlankTargetFromSource(src);
  const existingById = new Map(
    (existingTarget?.slides || []).map((slide) => [slide.id, slide]),
  );
  let target = existingTarget
    ? {
        ...blank,
        title: existingTarget.title || '',
        slides: blank.slides.map((slide) =>
          structuredClone(existingById.get(slide.id) || slide),
        ),
        ...(existingTarget.translationSources
          ? {
              translationSources: structuredClone(
                existingTarget.translationSources,
              ),
            }
          : {}),
      }
    : blank;
  // Compare every answer to the target as planned, including overwrite requests.
  // A later batch must never adopt concurrent edits as permission to replace them.
  const knownTargetIds = new Set(
    (pres.i18n.versions[pair.to]?.slides || []).map((slide) => slide.id),
  );
  // Only slots absent when this request started may be created. A target
  // slide removed while the model runs must remain removed.
  const addPlannedSlots = (version, source) => {
    const currentIds = new Set((version.slides || []).map((slide) => slide.id));
    const sourceIds = new Set((source.slides || []).map((slide) => slide.id));
    return {
      ...version,
      slides: [
        ...(version.slides || []),
        ...blank.slides
          .filter(
            (slide) =>
              !knownTargetIds.has(slide.id) &&
              !currentIds.has(slide.id) &&
              sourceIds.has(slide.id),
          )
          .map((slide) => structuredClone(slide)),
      ],
    };
  };
  let plannedTarget = addPlannedSlots(
    structuredClone(pres.i18n.versions[pair.to] || target),
    src,
  );
  let targetExisted = !!pres.i18n.versions[pair.to];
  let presentation;
  let completed = 0;
  let titleAccepted = false;
  let overwritePrepared = false;
  const reload = async () => {
    const fresh = await getPresentation(scope, presentationId);
    if (!fresh) throw new NotFoundError('Presentation not found');
    ensureI18n(fresh);
    return fresh;
  };
  const persist = async (fresh, status) => {
    const remaining = computeMissingTranslation({
      source: pickVersion(fresh, pair.from),
      target: fresh.i18n.versions[pair.to],
    });
    markTranslation(fresh.i18n, pair.to, {
      status: status || (remaining.missingCount ? 'partial' : 'done'),
      from: pair.from,
      missingCount: remaining.missingCount,
    });
    presentation = await writeTranslatedDeck(scope, identity.actor, fresh);
    for (const slide of presentation.i18n.versions[pair.to]?.slides || []) {
      knownTargetIds.add(slide.id);
    }
    return remaining;
  };
  for (const slides of batches) {
    const sourceBatch = { title: src.title, slides };
    const targetBatch = {
      title: target.title,
      slides: slides.map((slide) =>
        target.slides.find((candidate) => candidate.id === slide.id),
      ),
    };
    if (
      pair.fillMissing &&
      !pair.overwrite &&
      computeMissingTranslation({ source: sourceBatch, target: targetBatch })
        .missingCount === 0
    ) {
      completed += 1;
      continue;
    }
    let translated;
    try {
      translated = await translatePresentationStrings(sourceBatch, {
        from: pair.from,
        to: pair.to,
        existingTarget: targetBatch,
        fillMissing: pair.fillMissing && !pair.overwrite,
        vendor,
        organizationId: scope.organizationId,
      });
    } catch (error) {
      if (!completed) throw error;
      const fresh = await reload();
      if (fresh.i18n.versions[pair.to]) await persist(fresh, 'partial');
      throw partialTranslationError(completed, batches.length);
    }
    const fresh = await reload();
    if (targetExisted && !fresh.i18n.versions[pair.to]) {
      delete fresh.i18n.translation?.[pair.to];
      presentation = await writeTranslatedDeck(scope, identity.actor, fresh);
      return { from: pair.from, to: pair.to, presentation };
    }
    let freshTarget = fresh.i18n.versions[pair.to];
    if (!freshTarget) {
      const freshIds = new Set(
        (pickVersion(fresh, pair.from).slides || []).map((slide) => slide.id),
      );
      freshTarget = {
        ...target,
        slides: target.slides.filter((slide) => freshIds.has(slide.id)),
      };
    }
    freshTarget = addPlannedSlots(freshTarget, pickVersion(fresh, pair.from));
    if (pair.overwrite && !overwritePrepared) {
      // Make the unfinished replacement retryable. Clear only text still equal
      // to the original plan; edits made while the first batch ran survive.
      const fields = slideTextRows(src, plannedTarget).filter((row) =>
        row.source.trim(),
      );
      const cleared = applyMissingAnswers(
        freshTarget,
        plannedTarget,
        blank,
        fields,
        { allowEmpty: true },
      );
      for (const row of slideTextRows(src, cleared)) {
        if (!row.target.trim()) {
          delete cleared.translationSources?.[
            translationFieldKey(row.slideId, row.path)
          ];
        }
      }
      plannedTarget = applyMissingAnswers(
        plannedTarget,
        plannedTarget,
        blank,
        fields,
        { allowEmpty: true },
      );
      freshTarget = cleared;
      overwritePrepared = true;
    }
    const plannedBatch = {
      title: plannedTarget.title,
      slides: slides.map((slide) =>
        plannedTarget.slides.find((candidate) => candidate.id === slide.id),
      ),
    };
    const fields = slideTextRows(sourceBatch, plannedBatch).filter(
      (row) =>
        row.source.trim() &&
        (pair.overwrite || !row.target.trim()) &&
        (row.kind !== 'deck' || !titleAccepted),
    );
    const accepted = [];
    const merged = applyMissingAnswers(
      freshTarget,
      plannedBatch,
      translated,
      fields,
      { accepted },
    );
    const acceptedKeys = new Set(
      accepted.map((row) => translationFieldKey(row.slideId, row.path)),
    );
    for (const row of slideTextRows(sourceBatch, merged)) {
      if (
        !acceptedKeys.has(translationFieldKey(row.slideId, row.path)) ||
        !row.target.trim()
      )
        continue;
      recordTranslationSource(
        merged,
        row.slideId,
        row.path,
        translationSource(pair.from, row.source),
      );
      if (row.kind === 'deck') titleAccepted = true;
    }
    fresh.i18n.versions[pair.to] = merged;
    targetExisted = true;
    target = merged;
    await persist(fresh, completed + 1 === batches.length ? null : 'partial');
    completed += 1;
  }
  const fresh = await reload();
  if (!fresh.i18n.versions[pair.to]) {
    return { from: pair.from, to: pair.to, presentation: fresh };
  }
  const remaining = computeMissingTranslation({
    source: pickVersion(fresh, pair.from),
    target: fresh.i18n.versions[pair.to],
  });
  const marker = fresh.i18n.translation?.[pair.to];
  const status = remaining.missingCount ? 'partial' : 'done';
  if (
    marker?.from !== pair.from ||
    marker?.status !== status ||
    marker?.missingCount !== remaining.missingCount
  ) {
    await persist(fresh);
  } else {
    presentation = fresh;
  }
  if (remaining.missingCount > 0) {
    throw partialTranslationError(completed, batches.length);
  }
  return { from: pair.from, to: pair.to, presentation };
}

/**
 * What a fill of a language version's gaps would do, decided before any work:
 * the deck loaded for writing, the pair refused or resolved, the source
 * version seeded, and the gaps counted. {@link runMissingTranslation} carries
 * it out; {@link fillMissingTranslation} is the two in one call. The split
 * exists for the one contract that answers before the work (the editor's
 * `mode: 'background'`): it plans, answers with the count, and runs the plan
 * after the response, without loading the deck twice (D316 (3)).
 *
 * @typedef {Object} MissingTranslationPlan
 * @property {Object} pres - The deck as loaded, source version seeded.
 * @property {string} from
 * @property {string} to
 * @property {{ title: string, slides: any[] }} source
 * @property {{ title: string, slides: any[] }} target - The target version,
 *   or a blank copy of the source when the deck has none yet.
 * @property {any[]} missing - The gaps, as `computeMissingTranslation` lists them.
 * @property {number} missingCount - `0` means there is nothing to do.
 */

/**
 * Plan a fill of a language version's gaps (see {@link MissingTranslationPlan}).
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The translating actor (D253).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {*} [input.from] - Source language (see {@link assertTranslatableInput}).
 * @param {*} input.to - Target language, required.
 * @returns {Promise<MissingTranslationPlan>}
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid` naming a refused field.
 */
export async function planMissingTranslation(
  scope,
  identity,
  { presentationId, from, to },
) {
  const pres = await loadPresentationForActor(scope, identity, presentationId, {
    access: 'write',
  });
  const pair = assertTranslatableInput(pres, { from, to });
  seedSourceVersion(pres, pair.from);

  const source = pickVersion(pres, pair.from);
  const target = pres.i18n.versions[pair.to]
    ? pickVersion(pres, pair.to)
    : buildBlankTargetFromSource(source);
  const missingInfo = computeMissingTranslation({ source, target });
  return {
    pres,
    from: pair.from,
    to: pair.to,
    source,
    target,
    missing: Array.isArray(missingInfo?.missing) ? missingInfo.missing : [],
    missingCount: Number(missingInfo?.missingCount || 0) || 0,
  };
}

/**
 * Carry out a {@link MissingTranslationPlan} with gaps: the target is marked
 * `running` (persisted) before the model call and `done` after it, and the
 * deck is reloaded in between so an edit made meanwhile is kept. A plan
 * without gaps is not run (nothing to write, nothing to ask the model).
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The translating actor (D253).
 * @param {MissingTranslationPlan} plan
 * @param {Object} [options]
 * @param {string|null} [options.vendor] - The LLM vendor, when the caller names one.
 * @returns {Promise<{ from: string, to: string, missingCount: number, updated: boolean, presentation: Object }>}
 *   The count that was filled and the deck as stored; `updated: false` with
 *   the deck as loaded for a plan without gaps.
 * @throws {NotFoundError} The deck went away between the marker and the result.
 * @throws {AppError} A storage refusal; the model's own error.
 */
export async function runMissingTranslation(
  scope,
  identity,
  plan,
  { vendor = null } = {},
) {
  const { pres, from, to, source, target, missing, missingCount } = plan;
  if (!missingCount) {
    return { from, to, missingCount: 0, updated: false, presentation: pres };
  }

  markTranslation(pres.i18n, to, { status: 'running', from, missingCount });
  await writeTranslatedDeck(scope, identity.actor, pres);

  const filled = await translatePresentationStringsFillMissing(
    { sourcePresentation: source, targetPresentation: target },
    { from, to, vendor, organizationId: scope.organizationId },
  );

  const fresh = await getPresentation(scope, pres.id);
  if (!fresh) throw new NotFoundError('Presentation not found');
  ensureI18n(fresh);
  if (pres.i18n.versions[to] && !fresh.i18n.versions[to]) {
    delete fresh.i18n.translation?.[to];
    const presentation = await writeTranslatedDeck(
      scope,
      identity.actor,
      fresh,
    );
    return { from, to, missingCount, updated: false, presentation };
  }
  const freshTarget =
    fresh.i18n.versions[to] || buildBlankTargetFromSource(source);
  fresh.i18n.versions[to] = recordTranslatedVersion(
    source,
    applyMissingAnswers(freshTarget, target, filled, missing),
    from,
    { previous: freshTarget },
  );
  const after = computeMissingTranslation({
    source: pickVersion(fresh, from),
    target: pickVersion(fresh, to),
  });
  markTranslation(fresh.i18n, to, {
    status: 'done',
    from,
    missingCount: Number(after?.missingCount || 0) || 0,
  });

  const presentation = await writeTranslatedDeck(scope, identity.actor, fresh);
  return { from, to, missingCount, updated: true, presentation };
}

/**
 * Fill the gaps of a language version from another, in one call: only the
 * strings the target lacks are translated, what it already has stays.
 * {@link planMissingTranslation} then {@link runMissingTranslation}.
 *
 * @param {StorageScope} scope - The caller's storage scope.
 * @param {{ actor: Actor }} identity - The translating actor (D253).
 * @param {Object} input
 * @param {string} input.presentationId
 * @param {*} [input.from] - Source language (see {@link assertTranslatableInput}).
 * @param {*} input.to - Target language, required.
 * @param {string|null} [input.vendor] - The LLM vendor, when the caller names one.
 * @returns {Promise<{ from: string, to: string, missingCount: number, updated: boolean, presentation: Object }>}
 * @throws {NotFoundError} No deck with this id in this scope.
 * @throws {import('../utils/errors.js').ForbiddenError} The actor may not write the deck.
 * @throws {AppError} 400 `invalid` naming a refused field; a storage refusal;
 *   the model's own error.
 */
export async function fillMissingTranslation(
  scope,
  identity,
  { presentationId, from, to, vendor = null },
) {
  const plan = await planMissingTranslation(scope, identity, {
    presentationId,
    from,
    to,
  });
  return runMissingTranslation(scope, identity, plan, { vendor });
}
