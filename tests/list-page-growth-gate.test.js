/**
 * Growth gate: no new storage list that reads a whole set (B825, D358).
 *
 * Every list that grows per organization is read a page at a time on the
 * list-page contract: `{ limit, after }` in storage, `keysetPage()` in the
 * query (`server/storage/keyset.js`). This gate holds that shut for the lists
 * still to come. An exported `list*` function under `server/storage/` either
 * builds its page with `keysetPage()`, itself or through a function of its
 * own module, or stands on the closed list below with the reason its set
 * cannot grow with the organization: one deck's, one session's or one
 * person's rows, a facet or a vocabulary, a background job or an export that
 * means the whole set.
 *
 * Both directions fail: a new unpaged list that is not on the list, and a
 * line on the list whose function is gone or now pages (the list only
 * shrinks). Next to it, the retired offset parser and the in-memory page cut
 * stay gone from `server/`.
 *
 * Run with: node --test tests/list-page-growth-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const repoRoot = process.cwd();
const STORAGE = join(repoRoot, 'server', 'storage');

/**
 * The storage lists that are bounded by nature, each with why. Closed: a new
 * list pages, or argues its place here in review.
 */
const BOUNDED = {
  'api-keys.js :: listApiKeys': 'the keys of one organization',
  'collaborators.js :: listCollaborators': "one deck's collaborators",
  'custom-slide-types.js :: listCustomSlideTypes':
    "the organization's slide-type vocabulary",
  'custom-slide-types.js :: listPublishedCustomSlideTypes':
    "the organization's slide-type vocabulary",
  'editions.js :: listLegacyPublications':
    'the one-off conversion: the whole old index by definition',
  'editions.js :: listLatestPublicEditions':
    'the feed: top-N under its limit (at most 100)',
  'feedback.js :: listFeedbackEntries': "one slide's feedback, for an export",
  'font-families.js :: listAllFontFamiliesWithVariants':
    "the organization's font families",
  'image-library.js :: listImageLibraryTags': 'a facet: one row per tag',
  'presentations/deck-list.js :: listPresentations':
    'bulk export: the whole set by definition',
  'presentations/index.js :: listPresentationVersions':
    "one deck's versions, pruned",
  'presentations/index.js :: listTrashedPresentationsBefore':
    'the purge job: the whole expired set by definition',
  'presentations/subscriptions.js :: listSubscriptions':
    "one deck's subscription overrides",
  'questions.js :: listQuestions': "one live session's questions",
  'settings.js :: listDigestRecipients':
    'the digest job: everyone due by definition',
  'share-links/crud.js :: listShareLinks': "one deck's share links",
  'share-links/guests.js :: listGuestsForShareLink': "one link's guests",
  'slide-library-links.js :: listDecksBehindLibraryItem':
    "a fan-out job's input: the decks holding one item, read whole to notify each",
  'slide-library-usage.js :: listSlideLibraryUsage':
    "one reader's usage marks, bounded by the library",
  'tags.js :: listTags': "the organization's tag vocabulary",
  'themes.js :: listSeedThemes': 'the seed themes on disk',
  'themes.js :: listThemes': "the organization's themes",
  'user-organizations/memberships.js :: listUserOrganizations':
    "one person's organizations",
};

/** @param {string} dir @returns {string[]} */
function jsFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return jsFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

/**
 * The top-level function declarations of a module with their bodies. Brace
 * matching is enough here: the bodies are ordinary code, and a stray brace in
 * a string would only make a body too long, never hide a `keysetPage(`.
 *
 * @param {string} src
 * @returns {Map<string, {exported: boolean, body: string}>}
 */
function functionBodies(src) {
  const re = /^(export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/gm;
  const out = new Map();
  let match;
  while ((match = re.exec(src))) {
    let i = match.index + match[0].length;
    for (let depth = 1; depth && i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
    }
    while (i < src.length && src[i] !== '{') i++;
    const start = i;
    let depth = 0;
    do {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    } while (depth && i < src.length);
    out.set(match[2], {
      exported: Boolean(match[1]),
      body: src.slice(start, i),
    });
  }
  return out;
}

/**
 * Every exported `list*` storage function, and whether it pages: its body
 * calls `keysetPage(`, or calls a function of the same module that does.
 *
 * @returns {Map<string, boolean>} `file :: name` → pages
 */
function storageLists() {
  const lists = new Map();
  for (const file of jsFiles(STORAGE)) {
    const fns = functionBodies(readFileSync(file, 'utf8'));
    const memo = new Map();
    const pages = (name, seen = new Set()) => {
      if (memo.has(name)) return memo.get(name);
      if (seen.has(name)) return false;
      seen.add(name);
      const { body } = fns.get(name);
      const result =
        body.includes('keysetPage(') ||
        [...fns.keys()].some(
          (other) =>
            other !== name &&
            new RegExp(`\\b${other}\\(`).test(body) &&
            pages(other, seen),
        );
      memo.set(name, result);
      return result;
    };
    for (const [name, { exported }] of fns) {
      if (!exported || !/^list/.test(name)) continue;
      lists.set(`${relative(STORAGE, file)} :: ${name}`, pages(name));
    }
  }
  return lists;
}

test('every storage list pages by keyset or is bounded by nature', () => {
  const unpaged = [...storageLists()]
    .filter(([key, pages]) => !pages && !Object.hasOwn(BOUNDED, key))
    .map(([key]) => key);
  assert.deepEqual(
    unpaged,
    [],
    'a list that reads a whole set: page it with keysetPage() and { limit, after } (docs/reference/storage-layer.md § A list read), or argue it onto BOUNDED',
  );
});

test('the bounded list only shrinks: each line names an unpaged list that exists', () => {
  const lists = storageLists();
  const stale = Object.keys(BOUNDED).filter(
    (key) => !lists.has(key) || lists.get(key) === true,
  );
  assert.deepEqual(stale, [], 'remove the line: the list is gone or pages now');
});

test('the gate sees the paged lists it guards', () => {
  // A detector that found nothing would pass the first test vacuously.
  const lists = storageLists();
  for (const key of [
    'analytics/view-sessions.js :: listViewSessions',
    'analytics/reports.js :: listAnalyticsReports',
    'analytics/dashboard.js :: listDashboardPresentations',
    'user-organizations/memberships.js :: listOrganizationMembers',
    'users.js :: listUsers',
    'presentations/deck-list.js :: listDecks',
    'image-library.js :: listImageLibrary',
  ]) {
    assert.equal(lists.get(key), true, key);
  }
});

test('the offset parser and the in-memory page cut stay gone from server/', () => {
  const hits = [];
  for (const file of jsFiles(join(repoRoot, 'server'))) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, i) => {
        if (/parsePaginationParams|\.slice\(offset/.test(line)) {
          hits.push(`${relative(repoRoot, file)}:${i + 1}`);
        }
      });
  }
  assert.deepEqual(hits, []);
});
