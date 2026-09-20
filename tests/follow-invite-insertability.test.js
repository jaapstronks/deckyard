/**
 * Who puts a slide in a deck, and where that answer is allowed to live.
 *
 * `follow-invite-slide` carried two answers to one question (B368). Its
 * definition claimed "the app inserts and maintains this slide itself, right
 * after the title slide… The editor's picker disables insertion for the same
 * reason", while `isInsertableSlideType()` had no rule against it, the type
 * picker offered it on the Interaction shelf, and the server said the
 * opposite in its own words ("Does NOT auto-insert a slide if missing – users
 * add it manually", server/storage/presentations/i18n.js). The prose was the
 * part that was wrong: nothing places an invite automatically, and a deck
 * without interactive slides can still want one for follow mode and Q&A.
 *
 * Two halves, so it cannot drift back:
 *
 * 1. The contract itself — agent opt-out is not an insertion ban.
 * 2. The claim, wherever it is written. One assertion over one concept: a
 *    slide does not arrive in a deck by itself, and a type definition is not
 *    where an insertion gate is declared. A type that really is uninsertable
 *    declares it in shared/slide-types/policy.js, next to `custom-html-slide`
 *    and `deprecated`; prose beside `ai:` is not a gate and cannot be
 *    executed.
 *
 * Half 2 scans the shipping surfaces rather than one folder, because that is
 * exactly how the claim survived the first attempt: the retired sentence was
 * still four times over in the prompt copy the model reads
 * (server/utils/openai/*, server/utils/ai/prompts/*), which a scan of
 * shared/slide-types/types/ cannot see (D195). History is not a surface:
 * CHANGELOG.md and docs/plans/ quote the retired sentence on purpose, and are
 * not scanned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { isInsertableSlideType } from '../shared/slide-types/policy.js';
import { isAgentOptOut } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { PICKER_GROUP_ORDER } from '../client/views/editor/slide-type-picker/data.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Shipping surfaces: code the app runs, and docs that describe what is. */
const SCANNED = [
  { dir: 'shared', ext: ['.js'] },
  { dir: 'server', ext: ['.js'] },
  { dir: 'client', ext: ['.js'] },
  { dir: 'tests', ext: ['.js'] },
  { dir: 'docs', ext: ['.md'] },
];

/** Not a surface: history, generated output, and this guard's own examples. */
const SKIP = new Set([
  'node_modules',
  'plans', // symlink to the private planning repo; quotes retired wording
  'follow-invite-insertability.test.js',
]);

const TYPES_PREFIX = path.join('shared', 'slide-types', 'types') + path.sep;

test('the follow-along invite is withheld from agents and offered to people', () => {
  const type = 'follow-invite-slide';
  const def = SLIDE_TYPES[type];
  assert.ok(def, 'follow-invite-slide must be registered');

  assert.equal(
    isAgentOptOut(def),
    true,
    'an agent has no live session to invite anyone into',
  );
  assert.equal(
    isInsertableSlideType({ type, def }),
    true,
    'a person inserts the invite themselves; nothing places one automatically',
  );

  const shelved = Object.values(PICKER_GROUP_ORDER).flat().includes(type);
  assert.equal(
    shelved,
    true,
    'the type picker is the only way a deck gets an invite, so it must offer one',
  );
});

test('nothing claims a slide arrives in a deck without a person', () => {
  const offenders = [];
  for (const rel of sourceFiles()) {
    for (const [line, sentence] of claimsAbout(rel)) {
      const claim = claimIn(sentence);
      if (claim) offenders.push(`${rel}:${line} — ${claim}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'a slide type does not place itself and the picker does not refuse one on ' +
      'its own authority — say what is true (the user inserts it; the editor ' +
      'may suggest a position), and declare a real insertion gate in ' +
      'shared/slide-types/policy.js § isInsertableSlideType, where the picker, ' +
      'the slides panel and the theme preview all read it',
  );
});

/**
 * The one false claim, in the spellings it has actually taken.
 *
 * The adverb is not what makes it false: "the app manages this slide" says the
 * same thing as "the app manages that automatically", and the first is how the
 * claim survived a sweep that greppped for `automatic` (D195). So the verb
 * alone counts — bounded by its object, a slide, which keeps true prose about
 * the machinery the app really does manage (sessions, join codes) out.
 */
const ARRIVES_BY_ITSELF = [
  // "the app manages that automatically", "the app manages this slide"
  /\b(app|server|editor|deckyard|system)\b[\s\w'’*`-]{0,40}\b(manages?|inserts?|adds?|places?|maintains?)\b[\s\w'’*`-]{0,60}\b(slide|invite|automatic)/i,
  // The same claim with the slide in front: "a slide the app maintains itself"
  /\b(slide|invite)\b[\s\w'’*`-]{0,40}\b(app|server|editor|deckyard|system)\b[\s\w'’*`-]{0,20}\b(manages?|inserts?|adds?|places?|maintains?)\b/i,
  // "This slide is managed automatically by the server"
  /\b(managed|inserted|added|placed|maintained)\s+automatically\b/i,
  // "the app auto-inserts one if missing"
  /\bauto-?(insert|add|place)\w*/i,
  // "the picker disables insertion for the same reason"
  /\bpicker\b[^,]{0,60}\b(disabl|refus|block|prevent|forbid)\w*\s+(insert|add)/i,
  /\b(disabl|refus|block|prevent|forbid)\w*\s+(insertion|inserting|adding)[^,]{0,60}\bpicker\b/i,
];

/** A sentence that denies the claim is the claim's cure, not the claim. */
const DENIAL = /\b(not|never|nor|no|nothing|none|without)\b|n't\b/i;

/**
 * Clause boundaries: a comma, a dash that separates, a bracket, or a
 * coordinator. Never a bare hyphen — "auto-insert" and "Follow-along" are one
 * word each.
 */
const CLAUSE =
  /\s+[—–]\s+|\s+-\s+|\s*[,:()[\]{}]\s*|\s+\b(?:and|but|so|yet|because|while|though|although)\b\s+/i;

/**
 * The clause that makes the claim, or `null` if this sentence does not.
 *
 * Read per clause, because one sentence can deny one thing while claiming
 * another: "deliberately not offered to agents — the app manages this slide"
 * denies the agent gate, not the placement, and the placement is the lie.
 * Within its clause a denial counts when it stands before or *inside* the
 * claim, because English puts it between subject and verb and the match starts
 * at the subject: "The app does NOT insert a Follow-along invite" denies the
 * placement from within. Past the claim it is spent on something else, so "is
 * managed automatically and can't be saved" is still the claim.
 *
 * @param {string} sentence
 * @returns {string|null}
 */
function claimIn(sentence) {
  for (const clause of sentence.split(CLAUSE)) {
    for (const re of ARRIVES_BY_ITSELF) {
      const m = clause.match(re);
      if (!m) continue;
      if (DENIAL.test(clause.slice(0, m.index + m[0].length))) continue;
      return clause.trim();
    }
  }
  return null;
}

/**
 * Sentences from `rel` that speak about a slide type, as [line, sentence].
 *
 * A file under shared/slide-types/types/ is its type's definition, so all of
 * it counts; anywhere else only the lines that name the invite do, which
 * keeps unrelated prose about other automatic machinery out of the guard.
 * That is why the copy on those lines names its subject rather than saying
 * "this slide": a sentence that says what it is about is both better copy and
 * within reach of the guard, which a multi-line window would only buy with
 * false positives.
 *
 * @param {string} rel - Repo-relative path.
 * @returns {Array<[number, string]>}
 */
function claimsAbout(rel) {
  const src = readFileSync(path.join(ROOT, rel), 'utf8');
  const wholeFile = rel.startsWith(TYPES_PREFIX);
  const out = [];
  src.split('\n').forEach((text, i) => {
    if (!wholeFile && !/follow-invite|follow-along invite/i.test(text)) return;
    for (const sentence of text.split(/[.;]/)) out.push([i + 1, sentence]);
  });
  return out;
}

/**
 * Every scanned source file, repo-relative, symlinks not followed.
 *
 * @returns {string[]}
 */
function sourceFiles() {
  const out = [];
  const walk = (rel, ext) => {
    for (const entry of readdirSync(path.join(ROOT, rel), {
      withFileTypes: true,
    })) {
      if (SKIP.has(entry.name) || entry.isSymbolicLink()) continue;
      const child = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(child, ext);
      else if (ext.includes(path.extname(entry.name))) out.push(child);
    }
  };
  for (const { dir, ext } of SCANNED) walk(dir, ext);
  return out;
}
