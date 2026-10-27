/**
 * Translation freshness: every present translation is bound to the English it
 * was reviewed against, and the unreviewed debt can only shrink pair by pair.
 *
 * Presence, placeholder parity and terminology each have a gate of their own;
 * none of them noticed that `imageLibrary.title` went from "Library" to "Media
 * Library" while German and French kept their word for "Library". The contract
 * lives in `scripts/lib/i18n-source-state.js`; this file pins it from five
 * sides: the fingerprint and the sidecar's strict form, drift in every locale
 * (`nl` included), the burndown against a base, the reviewed import, and the
 * repository as it stands.
 *
 * Run with: node --test tests/i18n-source-state.test.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './helpers/walk-files.js';

import {
  SOURCE_STATE_PATH,
  SOURCE_STATE_REL,
  classifyFreshness,
  collectFreshness,
  compareWithBase,
  dropSourceRecords,
  emptySourceState,
  hashText,
  loadTranslationInput,
  parseSourceState,
  readSourceState,
  serializeSourceState,
} from '../scripts/lib/i18n-source-state.js';
import { translationValueProblems } from '../scripts/lib/i18n-values.js';
import {
  ReviewPackageError,
  applyReviewPackage,
  reviewReportFor,
} from '../scripts/i18n-fill.js';
import { planSync } from '../scripts/i18n-sync.js';
import {
  defaultBase,
  runBurndown,
  stateAtCommit,
} from '../scripts/i18n-burndown.js';
import {
  LOCALE_IDS,
  MODULES,
  REFERENCE_LOCALE,
  TIER_2,
} from '../scripts/lib/i18n-locales.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const i18nDir = path.join(repoRoot, 'client', 'i18n');
const TRANSLATED = LOCALE_IDS.filter((id) => id !== REFERENCE_LOCALE);

/** @param {string} status @param {string} english @param {string} value */
const record = (status, english, value) => ({
  status,
  sourceHash: hashText(english),
  translationHash: hashText(value),
});

/** A sidecar built from dictionaries, every pair with the given status. */
function stateFor(reference, translations, status = 'unreviewed') {
  const state = emptySourceState();
  for (const [locale, dict] of Object.entries(translations)) {
    state.entries[locale] = {};
    for (const [key, value] of Object.entries(dict))
      state.entries[locale][key] = record(status, reference[key], value);
  }
  return state;
}

/** sha256 of every file under a directory, to prove "nothing was written". */
function fingerprint(dir) {
  return Object.fromEntries(
    walkFiles(dir).map((file) => [
      path.relative(dir, file),
      crypto
        .createHash('sha256')
        .update(fsSync.readFileSync(file))
        .digest('hex'),
    ]),
  );
}

describe('the fingerprint', () => {
  it('is sha256 over the UTF-8 of the decoded value, lowercase hex', () => {
    assert.equal(
      hashText('Café {count}'),
      'sha256:23e7c1f8c4e8566ce01afb641df49b48656f853e69b48895de5e3ceabd558a7e',
    );
    assert.equal(
      hashText(''),
      'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    assert.throws(() => hashText(undefined), TypeError);
  });

  it('ignores JSON spelling: indentation and \\u escapes', () => {
    const escaped = JSON.parse('{"a":"Caf\\u00e9 {count}"}').a;
    const pretty = JSON.parse('{\n    "a":   "Café {count}"\n}').a;
    assert.equal(hashText(escaped), hashText(pretty));
  });

  it('sees every visible change in the value', () => {
    const base = hashText('Save {name}.');
    for (const variant of [
      'Save {name}. ', // inner whitespace is content
      'save {name}.', // case
      'Save {title}.', // placeholder
      'Save {name}!', // punctuation
      'Save {name}․', // a lookalike character
    ])
      assert.notEqual(hashText(variant), base, JSON.stringify(variant));
    // No Unicode normalisation: NFC and NFD é are different text to hash.
    assert.notEqual(hashText('Café {count}'), hashText('Café {count}'));
  });

  it('an empty translation is refused by the value rules, not hashed into approval', () => {
    assert.deepEqual(translationValueProblems('de', '', 'Save'), [
      'value is empty',
    ]);
    assert.deepEqual(translationValueProblems('de', '  ', 'Save'), [
      'value is empty',
    ]);
  });
});

describe('the sidecar form', () => {
  const sample = () => {
    const state = emptySourceState();
    state.entries.de = { 'a.save': record('reviewed', 'Save', 'Speichern') };
    state.entries.nl = { 'a.save': record('unreviewed', 'Save', 'Opslaan') };
    return state;
  };

  it('round-trips through its one canonical text', () => {
    const text = serializeSourceState(sample());
    assert.deepEqual(parseSourceState(text), sample());
    assert.equal(serializeSourceState(parseSourceState(text)), text);
  });

  const refuses = (text, pattern) =>
    assert.throws(() => parseSourceState(text), pattern);

  it('refuses malformed JSON instead of reading it as empty', () => {
    refuses('{"schema": 1,', /not valid JSON/);
  });

  it('refuses a duplicate record that JSON.parse would collapse', () => {
    const text = serializeSourceState(sample());
    const line = text.split('\n').find((l) => l.includes('"a.save"'));
    const doubled = text.replace(line, `${line.replace(/,?$/, ',')}\n${line}`);
    refuses(doubled, /duplicate record\(s\): de a\.save/);
  });

  it('refuses unknown statuses, locales, fields and hashes', () => {
    const mutate = (fn) => {
      const s = sample();
      fn(s);
      return serializeSourceState(s);
    };
    refuses(
      mutate((s) => (s.entries.de['a.save'].status = 'approved')),
      /unknown status "approved"/,
    );
    refuses(
      mutate((s) => (s.entries.xx = { k: record('reviewed', 'a', 'b') })),
      /"xx" is not a translated locale/,
    );
    refuses(
      mutate(
        (s) =>
          (s.entries[REFERENCE_LOCALE] = { k: record('reviewed', 'a', 'b') }),
      ),
      /is not a translated locale/,
    );
    refuses(
      mutate((s) => (s.entries.de['a.save'].sourceHash = 'md5:abc')),
      /sourceHash is not a sha256: fingerprint/,
    );
    const extraField = JSON.parse(serializeSourceState(sample()));
    extraField.entries.de['a.save'].reviewedAt = '2026-10-27';
    refuses(JSON.stringify(extraField), /must have exactly status/);
    refuses(
      serializeSourceState({ ...sample(), schema: 2 }),
      /"schema" is 2, expected 1/,
    );
  });

  it('refuses hand formatting, so the parser is the only way in', () => {
    refuses(`${JSON.stringify(sample(), null, 2)}\n`, /not in canonical form/);
  });

  it('a missing sidecar is an error, never an empty inventory', async () => {
    await assert.rejects(
      readSourceState(path.join(os.tmpdir(), 'no-such-i18n-source-state.json')),
      /is missing/,
    );
  });
});

describe('drift in every translated locale', () => {
  // One reviewed and one unreviewed translation in each of the eleven
  // translated locales; then only English changes.
  const reference = { 'a.title': 'Library', 'b.open': 'Open' };
  const translations = Object.fromEntries(
    TRANSLATED.map((locale) => [
      locale,
      { 'a.title': `Library (${locale})`, 'b.open': `Open (${locale})` },
    ]),
  );
  const state = emptySourceState();
  for (const locale of TRANSLATED)
    state.entries[locale] = {
      'a.title': record('reviewed', 'Library', translations[locale]['a.title']),
      'b.open': record('unreviewed', 'Open', translations[locale]['b.open']),
    };

  it('the untouched fixture is current or tolerated debt, nothing failing', () => {
    const result = classifyFreshness({ reference, translations, state });
    assert.equal(result.failed, false);
    assert.equal(result.totals.reviewedCurrent, TRANSLATED.length);
    assert.equal(result.totals.unreviewed, TRANSLATED.length);
  });

  it('an English edit fails both pairs in all eleven locales, nl included', () => {
    const edited = { 'a.title': 'Media Library', 'b.open': 'Unresolved' };
    const result = classifyFreshness({
      reference: edited,
      translations,
      state,
    });
    assert.equal(result.failed, true);
    assert.equal(TRANSLATED.length, 11);
    assert.ok(TRANSLATED.includes('nl'));
    for (const locale of TRANSLATED) {
      const kinds = result.findings
        .filter((f) => f.locale === locale)
        .map((f) => `${f.key} ${f.kind} ${f.status}`);
      assert.deepEqual(
        kinds,
        ['a.title source-changed reviewed', 'b.open source-changed unreviewed'],
        locale,
      );
      assert.equal(result.locales[locale].sourceChanged, 2);
      assert.equal(result.locales[locale].reviewedCurrent, 0);
    }
    const f = result.findings[0];
    assert.equal(f.expectedSourceHash, hashText('Library'));
    assert.equal(f.actualSourceHash, hashText('Media Library'));
  });

  it('a missing Tier-2 translation is missing, not a stale one', () => {
    const tier2 = TIER_2[0];
    const partial = structuredClone(translations);
    delete partial[tier2]['b.open'];
    const trimmed = structuredClone(state);
    delete trimmed.entries[tier2]['b.open'];
    const result = classifyFreshness({
      reference,
      translations: partial,
      state: trimmed,
    });
    assert.equal(result.failed, false);
    assert.equal(result.locales[tier2].missing, 1);
    assert.equal(result.locales[tier2].sourceChanged, 0);
  });

  it('names every other structural fault in its own kind', () => {
    const t = structuredClone(translations);
    const s = structuredClone(state);
    t.de['a.title'] = 'Mediathek'; // edited outside the reviewed import
    t.fr['c.new'] = 'Nouveau'; // no record, and no English source either
    t.it['b.open'] = undefined; // record left behind
    delete t.it['b.open'];
    t.es['a.extra'] = 'Extra (es)';
    const ref = { ...reference, 'a.extra': 'Extra' }; // untracked translation
    const result = classifyFreshness({
      reference: ref,
      translations: t,
      state: s,
    });
    const rows = result.findings.map((f) => `${f.locale} ${f.key} ${f.kind}`);
    assert.deepEqual(rows, [
      'de a.title translation-changed',
      'es a.extra untracked',
      'fr c.new source-missing',
      'it b.open dangling',
    ]);
  });

  it('identity is (locale, key): moving a key between modules changes nothing', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-move-'));
    try {
      const write = async (locale, mod, data) => {
        await fs.mkdir(path.join(dir, locale), { recursive: true });
        await fs.writeFile(
          path.join(dir, locale, `${mod}.json`),
          JSON.stringify(data),
        );
      };
      await write('en', 'common', reference);
      await write('de', 'common', translations.de);
      const input = await loadTranslationInput(dir);
      const s = stateFor(input.reference, { de: input.translations.de });
      const before = classifyFreshness({ ...input, state: s });

      await fs.rm(path.join(dir, 'de', 'common.json'));
      await write('de', 'editor', { 'a.title': translations.de['a.title'] });
      await write('de', 'list', { 'b.open': translations.de['b.open'] });
      const moved = await loadTranslationInput(dir);
      const after = classifyFreshness({ ...moved, state: s });
      assert.deepEqual(after.locales.de, before.locales.de);
      assert.equal(after.failed, false);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the burndown against a base', () => {
  const reference = { a: 'One', b: 'Two', c: 'Three' };
  const translations = { de: { a: 'Eins', b: 'Zwei', c: 'Drei' } };
  const base = stateFor(reference, translations);

  const promote = (state, locale, key, english, value) => {
    const next = structuredClone(state);
    next.entries[locale][key] = record('reviewed', english, value);
    return next;
  };

  it('a reviewed pair leaves the debt, and only that pair moves', () => {
    const head = promote(base, 'de', 'a', 'One', 'Eins');
    const r = compareWithBase({ base, head });
    assert.deepEqual(r.violations, []);
    assert.equal(r.baseUnreviewed, 3);
    assert.equal(r.headUnreviewed, 2);
    assert.equal(r.promoted, 1);
    assert.equal(r.removed, 0);
  });

  it('a deleted translation leaves the debt as removed, not as reviewed', () => {
    const head = structuredClone(base);
    delete head.entries.de.c;
    const r = compareWithBase({ base, head });
    assert.deepEqual(r.violations, []);
    assert.equal(r.promoted, 0);
    assert.equal(r.removed, 1);
  });

  it('swapping debt at an equal total is refused', () => {
    // One pair reviewed, one new unknown translation in its place.
    const head = promote(base, 'de', 'a', 'One', 'Eins');
    head.entries.nl = { a: record('unreviewed', 'One', 'Een') };
    const r = compareWithBase({ base, head });
    assert.equal(r.headUnreviewed, r.baseUnreviewed);
    assert.deepEqual(
      r.violations.map((v) => `${v.locale} ${v.key} ${v.kind}`),
      ['nl a new-unreviewed'],
    );
  });

  it('a rehash under unreviewed is refused — source or translation', () => {
    const head = structuredClone(base);
    head.entries.de.a = record('unreviewed', 'One!', 'Eins');
    head.entries.de.b = record('unreviewed', 'Two', 'Zwei!');
    const r = compareWithBase({ base, head });
    assert.deepEqual(
      r.violations.map((v) => `${v.key} ${v.kind}`),
      ['a rehashed', 'b rehashed'],
    );
  });

  it('a reviewed pair cannot fall back to unreviewed', () => {
    const reviewedBase = promote(base, 'de', 'a', 'One', 'Eins');
    const r = compareWithBase({ base: reviewedBase, head: base });
    assert.deepEqual(
      r.violations.map((v) => `${v.key} ${v.kind}`),
      ['a downgraded'],
    );
  });

  it('a bootstrap must fingerprint the base text, not this PR’s', () => {
    const baseInput = { reference, translations };
    const honest = promote(base, 'de', 'a', 'One', 'Eins');
    assert.deepEqual(
      compareWithBase({ base: null, head: honest, baseInput }).violations,
      [],
    );
    const laundered = structuredClone(base);
    laundered.entries.de.b = record('unreviewed', 'Two', 'Zwo'); // edited here
    laundered.entries.de.x = record('unreviewed', 'New', 'Neu'); // not at base
    assert.deepEqual(
      compareWithBase({
        base: null,
        head: laundered,
        baseInput,
      }).violations.map((v) => `${v.key} ${v.kind}`),
      ['b rehashed', 'x not-at-base'],
    );
    assert.throws(
      () => compareWithBase({ base: null, head: base }),
      /bootstrap/,
    );
  });

  describe('reading the base from git', () => {
    let repo;
    const git = (...args) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    before(async () => {
      repo = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-burndown-'));
      git('init', '-q');
      git('config', 'user.email', 'test@example.invalid');
      git('config', 'user.name', 'test');
      await fs.mkdir(path.join(repo, 'scripts'));
      await fs.writeFile(path.join(repo, 'README'), 'x\n');
      git('add', '.');
      git('commit', '-qm', 'no sidecar');
    });
    after(() => fs.rm(repo, { recursive: true, force: true }));

    it('a base without the file is provably absent: bootstrap', () => {
      assert.equal(stateAtCommit(git('rev-parse', 'HEAD'), repo), null);
    });

    it('a base whose file does not parse is an error, not a bootstrap', async () => {
      await fs.writeFile(path.join(repo, SOURCE_STATE_REL), '{"schema": 1,');
      git('add', '.');
      git('commit', '-qm', 'broken sidecar');
      assert.throws(
        () => stateAtCommit(git('rev-parse', 'HEAD'), repo),
        /not valid JSON/,
      );
    });

    it('a base with a valid file is read as it is there', async () => {
      await fs.writeFile(
        path.join(repo, SOURCE_STATE_REL),
        serializeSourceState(base),
      );
      git('add', '.');
      git('commit', '-qm', 'sidecar');
      assert.deepEqual(stateAtCommit(git('rev-parse', 'HEAD'), repo), base);
    });
  });
});

describe('the reviewed import', () => {
  let dir;
  let statePath;
  const en = {
    common: { 'common.save': 'Save {name}', 'common.open': 'Open' },
    list: { 'list.title': 'Media Library', 'list.new': 'New' },
  };
  const de = {
    common: { 'common.save': 'Speichern {name}', 'common.open': 'Offen' },
    list: { 'list.title': 'Bibliothek' },
  };

  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'i18n-review-'));
    statePath = path.join(dir, 'state.json');
  });
  after(() => fs.rm(dir, { recursive: true, force: true }));

  /** A fresh fixture: en + de files, every de pair unreviewed. */
  async function reset() {
    await fs.rm(path.join(dir, 'i18n'), { recursive: true, force: true });
    for (const [locale, mods] of [
      ['en', en],
      ['de', de],
    ])
      for (const [mod, data] of Object.entries(mods)) {
        await fs.mkdir(path.join(dir, 'i18n', locale), { recursive: true });
        await fs.writeFile(
          path.join(dir, 'i18n', locale, `${mod}.json`),
          `${JSON.stringify(data, null, 2)}\n`,
        );
      }
    const flatEn = { ...en.common, ...en.list };
    const flatDe = { ...de.common, ...de.list };
    await fs.writeFile(
      statePath,
      serializeSourceState(stateFor(flatEn, { de: flatDe })),
    );
  }
  const opts = () => ({ dir: path.join(dir, 'i18n'), statePath, locale: 'de' });
  const exported = async () => reviewReportFor('de', opts());
  const pkgOf = (report, keys, values = {}) => ({
    schema: 1,
    locale: 'de',
    entries: Object.fromEntries(
      keys.map((k) => [
        k,
        { ...report.entries[k], ...(k in values ? { value: values[k] } : {}) },
      ]),
    ),
  });
  const assertUntouched = async (snapshot, run) => {
    await assert.rejects(run, ReviewPackageError);
    assert.deepEqual(fingerprint(dir), snapshot);
  };

  it('the review report lists unreviewed pairs and stamps nothing', async () => {
    await reset();
    const snapshot = fingerprint(dir);
    const report = await exported();
    assert.deepEqual(Object.keys(report.entries), [
      'common.open',
      'common.save',
      'list.title',
    ]);
    assert.deepEqual(report.entries['list.title'], {
      status: 'unreviewed',
      source: 'Media Library',
      sourceHash: hashText('Media Library'),
      previousTranslationHash: hashText('Bibliothek'),
      value: 'Bibliothek',
    });
    assert.deepEqual(fingerprint(dir), snapshot);
  });

  it('confirms a correct translation and corrects another, recording only those', async () => {
    await reset();
    const report = await exported();
    const before = parseSourceState(await fs.readFile(statePath, 'utf8'));
    const done = await applyReviewPackage(
      pkgOf(report, ['common.open', 'list.title'], {
        'list.title': 'Mediathek',
      }),
      opts(),
    );
    assert.deepEqual(done.keys, ['common.open', 'list.title']);
    const after = parseSourceState(await fs.readFile(statePath, 'utf8'));
    assert.deepEqual(
      after.entries.de['common.open'],
      record('reviewed', 'Open', 'Offen'),
    );
    assert.deepEqual(
      after.entries.de['list.title'],
      record('reviewed', 'Media Library', 'Mediathek'),
    );
    assert.deepEqual(
      after.entries.de['common.save'],
      before.entries.de['common.save'],
    );
    const list = JSON.parse(
      await fs.readFile(path.join(dir, 'i18n', 'de', 'list.json'), 'utf8'),
    );
    assert.equal(list['list.title'], 'Mediathek');
    // The report no longer offers what was just reviewed.
    assert.deepEqual(Object.keys((await exported()).entries), ['common.save']);
  });

  it('a new translation binds to the English and lands where en/ files it', async () => {
    await reset();
    await applyReviewPackage(
      {
        schema: 1,
        locale: 'de',
        entries: {
          'list.new': {
            sourceHash: hashText('New'),
            previousTranslationHash: null,
            value: 'Neu',
          },
        },
      },
      opts(),
    );
    const list = JSON.parse(
      await fs.readFile(path.join(dir, 'i18n', 'de', 'list.json'), 'utf8'),
    );
    assert.equal(list['list.new'], 'Neu');
    const state = parseSourceState(await fs.readFile(statePath, 'utf8'));
    assert.equal(state.entries.de['list.new'].status, 'reviewed');
  });

  it('a package exported before an English edit is refused whole, across modules', async () => {
    await reset();
    const report = await exported();
    const enCommon = path.join(dir, 'i18n', 'en', 'common.json');
    await fs.writeFile(
      enCommon,
      JSON.stringify({ ...en.common, 'common.open': 'Unresolved' }),
    );
    const snapshot = fingerprint(dir);
    await assertUntouched(snapshot, () =>
      applyReviewPackage(
        pkgOf(report, ['common.open', 'list.title'], {
          'list.title': 'Mediathek',
        }),
        opts(),
      ),
    );
  });

  it('a package exported before a translation edit is refused whole', async () => {
    await reset();
    const report = await exported();
    await fs.writeFile(
      path.join(dir, 'i18n', 'de', 'list.json'),
      JSON.stringify({ 'list.title': 'Medienbibliothek' }),
    );
    const snapshot = fingerprint(dir);
    await assertUntouched(snapshot, () =>
      applyReviewPackage(
        pkgOf(report, ['common.open', 'list.title'], {
          'list.title': 'Mediathek',
        }),
        opts(),
      ),
    );
  });

  it('refuses bad packages without writing anything', async () => {
    await reset();
    const report = await exported();
    const snapshot = fingerprint(dir);
    const good = () => pkgOf(report, ['common.save']);
    const cases = [
      // the retired flat import
      { 'common.save': 'Speichern {name}' },
      { ...good(), schema: 2 },
      { ...good(), locale: 'xx' },
      { ...good(), locale: REFERENCE_LOCALE },
      { ...good(), locale: 'fr' }, // CLI asked for de
      { ...good(), entries: {} },
      {
        ...good(),
        entries: {
          'common.unknown': {
            sourceHash: hashText('x'),
            previousTranslationHash: null,
            value: 'x',
          },
        },
      },
      pkgOf(report, ['common.save'], { 'common.save': 'Speichern' }), // {name} dropped
      pkgOf(report, ['common.save'], { 'common.save': '' }),
      pkgOf(report, ['common.save'], { 'common.save': 'Save {name}' }), // carbon copy
      {
        ...good(),
        entries: {
          'common.save': { ...good().entries['common.save'], approvedBy: 'me' },
        },
      },
      {
        ...good(),
        entries: {
          'common.save': { ...good().entries['common.save'], source: 'Save' },
        },
      },
    ];
    for (const pkg of cases)
      await assertUntouched(snapshot, () => applyReviewPackage(pkg, opts()));
  });
});

describe('the repository as it stands', () => {
  it('every present translation has a record, and none drifted', async () => {
    const result = await collectFreshness();
    assert.deepEqual(
      result.findings.map(
        (f) =>
          `${f.locale}  ${f.key}  ${f.kind}${f.status ? ` (${f.status})` : ''}`,
      ),
      [],
      `${result.findings.length} translation(s) drifted from the English they were ` +
        'recorded with. Review them: node scripts/i18n-fill.js <locale> --review --json, ' +
        'then --apply <locale> <file.json>. See docs/developer/i18n.md.',
    );
  });

  it('covers the whole manifest matrix, deck modules and nl included', async () => {
    const state = await readSourceState();
    assert.deepEqual(Object.keys(state.entries).sort(), [...TRANSLATED].sort());
    assert.ok(MODULES.includes('follow'));
    const followRecords = Object.keys(state.entries.nl).filter((k) =>
      k.startsWith('follow.'),
    );
    assert.ok(followRecords.length > 0, 'nl follow.json pairs are recorded');
  });

  it('runtime locale files stay flat string maps without metadata', async () => {
    for (const locale of LOCALE_IDS) {
      for (const name of await fs.readdir(path.join(i18nDir, locale))) {
        if (!name.endsWith('.json')) continue;
        const data = JSON.parse(
          await fs.readFile(path.join(i18nDir, locale, name), 'utf8'),
        );
        for (const [key, value] of Object.entries(data))
          assert.equal(typeof value, 'string', `${locale}/${name} ${key}`);
      }
    }
  });

  it('a sync plan retires records only with their translations', async () => {
    const plan = await planSync();
    const state = await readSourceState();
    const deleted = plan.edits
      .filter((e) => e.locale !== REFERENCE_LOCALE)
      .flatMap((e) => [...e.pruned, ...e.stripped]);
    assert.equal(plan.sourceState.removed.length <= deleted.length, true);
    const { state: expected } = dropSourceRecords(
      state,
      plan.edits.flatMap((e) =>
        [...e.pruned, ...e.stripped].map((key) => ({ locale: e.locale, key })),
      ),
    );
    assert.deepEqual(plan.sourceState.data, expected);
  });

  it('dropping records leaves every other record exactly as it was', () => {
    const state = stateFor(
      { a: 'A', b: 'B' },
      { de: { a: 'Ä', b: 'Bé' }, fr: { a: 'À' } },
    );
    state.entries.de.b.status = 'reviewed';
    const { state: next, removed } = dropSourceRecords(state, [
      { locale: 'de', key: 'a' },
      { locale: 'fr', key: 'missing' },
    ]);
    assert.deepEqual(removed, [
      { locale: 'de', key: 'a', status: 'unreviewed' },
    ]);
    assert.deepEqual(next.entries.de, { b: state.entries.de.b });
    assert.deepEqual(next.entries.fr, state.entries.fr);
    assert.ok(state.entries.de.a, 'the input is not mutated');
  });

  it('reading reports writes nothing', () => {
    const before = {
      i18n: fingerprint(i18nDir),
      state: fsSync.readFileSync(SOURCE_STATE_PATH, 'utf8'),
    };
    for (const args of [
      ['scripts/i18n-fill.js', 'de', '--review'],
      ['scripts/i18n-fill.js', 'nl', '--review', '--json'],
      ['scripts/i18n-sync.js'],
    ]) {
      const r = spawnSync(process.execPath, args, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024, // the full nl report is several MB
      });
      assert.equal(r.status, 0, `${args.join(' ')}: ${r.stderr}`);
    }
    assert.deepEqual(
      {
        i18n: fingerprint(i18nDir),
        state: fsSync.readFileSync(SOURCE_STATE_PATH, 'utf8'),
      },
      before,
    );
  });

  it('the unreviewed debt only shrank against this branch’s base', async (t) => {
    // Local runs compare with the merge base of HEAD and origin/main; CI runs
    // scripts/i18n-burndown.js against the real PR base in its own step,
    // because its depth-1 checkout has no origin/main to find here.
    let base;
    try {
      base = defaultBase();
    } catch {
      t.skip('no origin/main in this clone; CI checks the PR base separately');
      return;
    }
    const result = await runBurndown(base);
    assert.deepEqual(
      result.violations.map(
        (v) => `${v.locale} ${v.key} ${v.kind}: ${v.detail}`,
      ),
      [],
    );
  });
});
