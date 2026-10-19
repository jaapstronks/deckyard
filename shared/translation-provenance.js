/** Per-field translation provenance, shared by every translation writer. */
import { slideTextRows } from './i18n-progress.js';

/** Unambiguous address: deck title uses null, slide paths address content. */
export const translationFieldKey = (slideId, path) =>
  JSON.stringify([slideId || null, path]);

/** FNV-1a 64-bit over exact UTF-16 code units; a change detector, not a signature. */
export function translationSourceHash(text) {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

/** The sole producer of a source record. No source text or review workflow stored. */
export function translationSource(lang, text) {
  return { lang, hash: translationSourceHash(text) };
}

/** Record one accepted translation in its target version. */
export function recordTranslationSource(version, slideId, path, source) {
  version.translationSources ||= {};
  version.translationSources[translationFieldKey(slideId, path)] = source;
}

/**
 * Stamp only fields this operation actually translated. Filling gaps preserves
 * the provenance (or lack of it) of existing target text.
 */
export function recordTranslatedVersion(
  source,
  target,
  lang,
  { previous = null, slideTypes } = {},
) {
  if (previous?.translationSources)
    target.translationSources = structuredClone(previous.translationSources);
  const previousRows = previous
    ? new Map(
        slideTextRows(source, previous, { slideTypes }).map((r) => [
          translationFieldKey(r.slideId, r.path),
          r.target,
        ]),
      )
    : null;
  for (const row of slideTextRows(source, target, { slideTypes })) {
    if (!row.source.trim() || !row.target.trim()) continue;
    const before = previousRows?.get(
      translationFieldKey(row.slideId, row.path),
    );
    if (typeof before === 'string' && before.trim()) continue;
    recordTranslationSource(
      target,
      row.slideId,
      row.path,
      translationSource(lang, row.source),
    );
  }
  return target;
}

/** Derive status against the chosen source language; old decks stay neutral. */
export function translationFieldStatus(row, sourceLang, record) {
  if (row.source.trim() && !row.target.trim()) return 'empty';
  if (row.source.trim() && row.source === row.target) return 'same';
  if (!record || record.lang !== sourceLang) return 'untracked';
  return record.hash === translationSourceHash(row.source)
    ? 'current'
    : 'changed';
}
