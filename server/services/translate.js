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
 * top-level fields to the active version before every write.
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
} from '../../shared/i18n-progress.js';
import {
  AppError,
  NotFoundError,
  throwStorageFailure,
} from '../utils/errors.js';
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
  const active = normalizeLang(pres.i18n?.active) || storedDominant(pres);
  const buffer = pickVersion(pres, active);
  pres.title = buffer.title;
  pres.slides = buffer.slides;

  const updated = await updatePresentation(scope, pres.id, pres, {
    actorEmail: actor?.email || null,
    user: actor || null,
  });
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
  const translated = await translatePresentationStrings(src, {
    from: pair.from,
    to: pair.to,
    existingTarget,
    fillMissing: pair.fillMissing && !pair.overwrite,
    vendor,
  });

  pres.i18n.versions[pair.to] = {
    title: translated.title,
    slides: translated.slides,
  };
  markTranslation(pres.i18n, pair.to, { status: 'done', from: pair.from });

  const presentation = await writeTranslatedDeck(scope, identity.actor, pres);
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
    { sourcePresentation: source, targetPresentation: target, missing },
    { from, to, vendor },
  );

  const fresh = await getPresentation(scope, pres.id);
  if (!fresh) throw new NotFoundError('Presentation not found');
  ensureI18n(fresh);
  fresh.i18n.versions[to] = { title: filled.title, slides: filled.slides };
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
