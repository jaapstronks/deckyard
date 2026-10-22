/**
 * The library lists on the list-page contract (B822, D358): the slide-library
 * shelves (and their trash), the slide collections and the image library.
 * The internal API and v1 read them through here, so a filter means the same
 * on both and every page comes out of one query.
 *
 * Each list has one order: `(created desc, id desc)`, and in the slide
 * library's trash `(trashed desc, id desc)`. The filters ride along in the
 * cursor's fingerprint together with the list's name, so a cursor of one list,
 * or made under other filters, is refused (`server/services/list-page.js`).
 * An unknown filter value is refused as a 400 `invalid` naming its field,
 * never read as "no filter".
 *
 * @module server/services/library-lists
 */

import { AppError } from '../utils/errors.js';
import { listPageResult, parseListPage } from './list-page.js';
import {
  getLibraryShelfFacets,
  listLibraryShelf,
} from '../storage/slide-library.js';
import {
  listOrganizationCollections,
  listPersonalCollections,
} from '../storage/collections.js';
import {
  IMAGE_LIST_SECTIONS,
  listImageLibrary,
} from '../storage/image-library.js';
import { normalizeLang, TRANSLATION_LANGS } from '../../shared/i18n-utils.js';

/** @typedef {import('../storage/scope.js').StorageScope} StorageScope */

/** The two shelves of the slide library and of the collections. */
export const LIBRARY_SHELVES = Object.freeze(['personal', 'organization']);

/** What a slide-library list shows: the shelf, or the shelf's trash. */
const LIBRARY_VIEWS = Object.freeze(['library', 'trash']);

/** The most tags one list may filter on. */
const MAX_TAGS = 20;

/** The longest search text and the longest single-value filter. */
const MAX_TEXT = 200;

/**
 * @param {string} field
 * @param {string} message
 * @returns {AppError}
 */
function invalid(field, message) {
  return new AppError(message, 400, { field }, 'invalid');
}

/**
 * One optional short text filter: absent or empty → undefined, a string up to
 * `MAX_TEXT` characters → trimmed, anything else refused.
 * @param {*} value
 * @param {string} field
 * @returns {string|undefined}
 */
function optionalText(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT) {
    throw invalid(
      field,
      `Invalid ${field} (text up to ${MAX_TEXT} characters)`,
    );
  }
  return value.trim() || undefined;
}

/**
 * @param {*} value
 * @param {readonly string[]} allowed
 * @param {string} field
 * @param {string} fallback
 * @returns {string}
 */
function oneOf(value, allowed, field, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) {
    throw invalid(field, `Invalid ${field} (${allowed.join('|')})`);
  }
  return value;
}

/**
 * @param {*} tags
 * @returns {string[]|undefined}
 */
function tagList(tags) {
  if (tags === undefined) return undefined;
  const valid =
    Array.isArray(tags) &&
    tags.length <= MAX_TAGS &&
    tags.every(
      (tag) =>
        typeof tag === 'string' && tag.trim() !== '' && tag.length <= MAX_TEXT,
    );
  if (!valid) {
    throw invalid('tags', `Invalid tags (up to ${MAX_TAGS} tag names)`);
  }
  const names = [...new Set(tags.map((tag) => tag.trim()))].sort();
  return names.length ? names : undefined;
}

/**
 * A deck language in its canonical spelling (`en` → `en-GB`), or refused.
 * @param {*} lang
 * @returns {string|undefined}
 */
function deckLang(lang) {
  if (lang === undefined || lang === null || lang === '') return undefined;
  const value = typeof lang === 'string' ? normalizeLang(lang.trim()) : null;
  if (!value) {
    throw invalid('lang', `Invalid lang (${TRANSLATION_LANGS.join('|')})`);
  }
  return value;
}

/**
 * The query parameters of a library list as the internal API spells them:
 * `view`, `theme`, `type`, `tag` (one per tag name; the image library takes
 * one), `lang`, `q`, `section`, and the page (`limit`, `cursor`; `offset` is
 * passed on to be refused). Each service reads the keys it knows.
 *
 * @param {URLSearchParams} params
 * @returns {Object}
 */
export function libraryListInput(params) {
  const read = (key) => params.get(key) ?? undefined;
  return {
    view: read('view'),
    theme: read('theme'),
    type: read('type'),
    tags: params.has('tag') ? params.getAll('tag') : undefined,
    tag: read('tag'),
    lang: read('lang'),
    q: read('q'),
    section: read('section'),
    limit: read('limit'),
    cursor: read('cursor'),
    ...(params.has('offset') ? { offset: params.get('offset') } : {}),
  };
}

/**
 * The slide-library filter a list or its facets read, checked.
 * @param {Object} input
 * @returns {{trashed: boolean, themeId?: string, slideType?: string, tags?: string[], lang?: string, q?: string}}
 */
function libraryFilter(input = {}) {
  return {
    trashed: oneOf(input.view, LIBRARY_VIEWS, 'view', 'library') === 'trash',
    themeId: optionalText(input.theme, 'theme'),
    slideType: optionalText(input.type, 'type'),
    tags: tagList(input.tags),
    lang: deckLang(input.lang),
    q: optionalText(input.q, 'q'),
  };
}

/**
 * One page of a slide-library shelf, or of its trash (`view: 'trash'`), as
 * the reader sees it: `{ items, nextCursor }`. On the personal shelf the
 * reader's own items only.
 *
 * @param {StorageScope} scope
 * @param {{shelf: 'personal'|'organization', readerEmail?: string|null}} who
 * @param {Object} [input] - `view`, `theme`, `type`, `tags`, `lang`, `q`,
 *   `limit`, `cursor` (see {@link libraryListInput}).
 * @returns {Promise<{items: Object[], nextCursor: string|null}>}
 * @throws {AppError} 400 `invalid` naming the field.
 */
export async function listLibraryPage(
  scope,
  { shelf, readerEmail },
  input = {},
) {
  const filter = libraryFilter(input);
  const page = parseListPage(input, {
    sortKey: filter.trashed ? 'trashed_desc' : 'created_desc',
    filters: { list: 'slide-library', shelf, ...filter },
  });
  const result = await listLibraryShelf(
    scope,
    { shelf, readerEmail, ...filter },
    { limit: page.limit, after: page.after },
  );
  return listPageResult('items', result, page);
}

/**
 * The filter chips of a shelf: counts per slide type and per tag over its
 * untrashed items, in the language scope when `lang` is named. Their own
 * query, so a count never depends on the page the reader holds.
 *
 * @param {StorageScope} scope
 * @param {{shelf: 'personal'|'organization', readerEmail?: string|null}} who
 * @param {Object} [input] - `theme`, `lang`.
 * @returns {Promise<{total: number, types: Array<{slideType: string, count: number}>, tags: Array<{name: string, count: number}>}>}
 */
export async function listLibraryFacets(
  scope,
  { shelf, readerEmail },
  input = {},
) {
  return getLibraryShelfFacets(scope, {
    shelf,
    readerEmail,
    themeId: optionalText(input.theme, 'theme'),
    lang: deckLang(input.lang),
  });
}

/**
 * One page of a collection shelf: `{ items, nextCursor }`, newest first. On
 * the personal shelf the reader's own collections only.
 *
 * @param {StorageScope} scope
 * @param {{shelf: 'personal'|'organization', readerEmail?: string|null}} who
 * @param {Object} [input] - `limit`, `cursor`.
 * @returns {Promise<{items: Object[], nextCursor: string|null}>}
 */
export async function listCollectionPage(
  scope,
  { shelf, readerEmail },
  input = {},
) {
  const page = parseListPage(input, {
    sortKey: 'created_desc',
    filters: { list: 'slide-collections', shelf },
  });
  const range = { limit: page.limit, after: page.after };
  const result =
    shelf === 'organization'
      ? await listOrganizationCollections(
          scope,
          { userEmail: readerEmail },
          range,
        )
      : await listPersonalCollections(scope, readerEmail, range);
  return listPageResult('items', result, page);
}

/**
 * One page of the image library: `{ <collection>: [...], nextCursor }`,
 * newest first, narrowed by `section` (`all`, the reader's uploads `mine`,
 * the reader's stars `favorites`, `logos`, `icons`), one `tag` and `q`.
 *
 * @param {StorageScope} scope
 * @param {{readerEmail?: string|null}} who
 * @param {Object} [input] - `section`, `tag`, `q`, `limit`, `cursor`.
 * @param {Object} [options]
 * @param {string} [options.collection='items'] - The name of the list in the
 *   answer (`images` on v1).
 * @returns {Promise<Object>}
 */
export async function listImagePage(
  scope,
  { readerEmail },
  input = {},
  { collection = 'items' } = {},
) {
  const filter = {
    section: oneOf(input.section, IMAGE_LIST_SECTIONS, 'section', 'all'),
    tag: optionalText(input.tag, 'tag'),
    q: optionalText(input.q, 'q'),
  };
  const page = parseListPage(input, {
    sortKey: 'created_desc',
    filters: { list: 'image-library', ...filter },
  });
  const result = await listImageLibrary(
    scope,
    { ...filter, viewerEmail: readerEmail || null },
    { limit: page.limit, after: page.after },
  );
  return listPageResult(collection, result, page);
}
