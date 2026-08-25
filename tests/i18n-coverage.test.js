/**
 * i18n drift guard.
 *
 * Deckyard ships Dutch as the *default* UI locale and English as the reference,
 * so both must be complete: a key missing from nl/ silently renders the English
 * fallback baked into the t() call, which looks like working software while
 * being untranslated. This test fails the build when that drift reappears.
 *
 * The checks:
 *  1. every static t() key used in client/ exists in both nl/ and en/
 *  2. {var} placeholders match between en/ and every other locale for shared
 *     keys, and no locale ships an empty value
 *  3. follow.* keys are not reachable through the global t() (see below)
 *  4. descriptor pairs use the one surviving spelling, `<x>Key` / `<x>`
 *  5. every fallback spells the en/ value for its key — one key, one English
 *     string, wherever it is written down
 *  6. an ellipsis is the single glyph `…`, in code and in every locale
 *  7. en/ holds every key any other locale holds — the reference is a superset
 *  8. every key the slide-type registry *declares* exists in nl/ and en/ too —
 *     the keys check 1 cannot see, because they are written down in
 *     `shared/slide-types/` rather than at a `t()` call site
 *
 * Run with: node --test tests/i18n-coverage.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  extractUsedKeys,
  isDynamicKey,
  findLegacyDescriptorPairs,
  collectFallbackSites,
} from '../scripts/lib/i18n-keys.js';
import { loadLocale } from '../scripts/lib/i18n-fs.js';
import {
  LOCALE_IDS,
  REFERENCE_LOCALE,
  TIER_1,
} from '../scripts/lib/i18n-locales.js';
import { CORE_SLIDE_TYPE_DEFS } from '../shared/slide-types/registry.js';
import { addUiI18nKeysToSlideType } from '../shared/ui-i18n-keys.js';
import { slideTypeUiKeys } from '../scripts/lib/slide-type-i18n-keys.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const clientDir = path.join(repoRoot, 'client');
const i18nDir = path.join(clientDir, 'i18n');

/**
 * Locales that must be *complete*: Tier 1. Tier-2 locales fall back to the
 * inline English `t()` string for a key they lack, so a missing key degrades to
 * English instead of breaking — see docs/reference/i18n-locale-tiers.md. Read
 * from the manifest so this list has one source, not two.
 *
 * Completeness is the only thing the tier governs. The two checks below —
 * no empty values, placeholders matching the reference — are about the strings
 * a locale *does* ship, and a Tier-2 locale ships those to real users the
 * moment they pick it in the language menu. An empty value renders nothing at
 * all (worse than the English fallback, which at least says something), and a
 * dropped `{var}` renders a literal placeholder or silently loses the number.
 * Neither degrades gracefully, so both run over every shipped locale.
 */
const REQUIRED_LOCALES = TIER_1;

/**
 * The burndown for check 8: `"<locale>  <key>"` rows the gate tolerates today.
 *
 * Same shape as `tests/slide-type-shared-copy-burndown.json` and
 * `eslint-suppressions.json` (A7.20): it may only ever *shrink*, and a stale
 * row fails just as loudly as a new gap, so the list cannot quietly become a
 * permanent exemption. It is seeded with the `slideType.*` keys `nl/` has never
 * translated — pre-existing debt this gate made visible, not something it
 * introduced. The shared `editor.slideField.*` namespace enters at zero.
 */
const REGISTRY_BURNDOWN_PATH = path.join(
  repoRoot,
  'tests',
  'i18n-registry-key-burndown.json',
);

const used = await extractUsedKeys(clientDir);
const staticKeys = [...used.keys()].filter((k) => !isDynamicKey(k));

/**
 * Every (locale, key) pair a Tier-1 locale is missing, for keys the slide-type
 * registry declares.
 *
 * Pure so the negative self-tests below can drive it with a hand-built registry
 * and hand-built dictionaries — the gate is only worth having if it demonstrably
 * catches the thing it was written for.
 *
 * @param {Iterable<string>} keys - registry-declared keys (`slideTypeUiKeys`)
 * @param {Record<string, Record<string, unknown>>} dicts - locale id -> dictionary
 * @returns {string[]} sorted `"<locale>  <key>"` rows
 */
export function detectUntranslatedRegistryKeys(keys, dicts) {
  const rows = [];
  for (const [locale, dict] of Object.entries(dicts)) {
    for (const key of keys) {
      if (typeof dict[key] !== 'string') rows.push(`${locale}  ${key}`);
    }
  }
  return rows.sort();
}

/** @param {string} s @returns {string[]} sorted {var} names in a string */
function placeholders(s) {
  return [...String(s).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((m) => m[1])
    .sort();
}

describe('i18n coverage', () => {
  for (const locale of REQUIRED_LOCALES) {
    it(`${locale}/ defines every t() key used in client/`, async () => {
      const dict = await loadLocale(i18nDir, locale);
      const missing = staticKeys.filter((k) => typeof dict[k] !== 'string');
      assert.deepStrictEqual(
        missing.sort(),
        [],
        `${missing.length} key(s) used in code but missing from client/i18n/${locale}/.\n` +
          `Add them (see scripts/lib/i18n-keys.js). First few:\n` +
          missing
            .slice(0, 20)
            .map(
              (k) =>
                `  ${k}  <- ${used.get(k).file.replace(repoRoot + '/', '')}`,
            )
            .join('\n'),
      );
    });
  }

  for (const locale of LOCALE_IDS) {
    it(`${locale}/ has no empty values`, async () => {
      const dict = await loadLocale(i18nDir, locale);
      const empty = Object.keys(dict).filter((k) => !String(dict[k]).trim());
      assert.deepStrictEqual(
        empty.sort(),
        [],
        `${empty.length} empty translation value(s) in client/i18n/${locale}/.\n` +
          'An empty string is not "untranslated" — it renders nothing, where a\n' +
          'missing key would have fallen back to the English t() string. Delete\n' +
          'the key or translate it:\n' +
          empty
            .slice(0, 20)
            .map((k) => `  ${k}`)
            .join('\n'),
      );
    });
  }

  for (const locale of LOCALE_IDS.filter((id) => id !== REFERENCE_LOCALE)) {
    it(`${locale}/ agrees with ${REFERENCE_LOCALE}/ on {var} placeholders`, async () => {
      const reference = await loadLocale(i18nDir, REFERENCE_LOCALE);
      const dict = await loadLocale(i18nDir, locale);
      const mismatched = [];
      for (const key of Object.keys(reference)) {
        if (typeof dict[key] !== 'string') continue;
        const a = placeholders(reference[key]);
        const b = placeholders(dict[key]);
        if (a.join(',') !== b.join(',')) {
          mismatched.push(
            `${key}: ${REFERENCE_LOCALE}{${a.join(',')}} vs ${locale}{${b.join(',')}}`,
          );
        }
      }
      assert.deepStrictEqual(
        mismatched.sort(),
        [],
        `${mismatched.length} key(s) in client/i18n/${locale}/ carry different\n` +
          `{var} placeholders than client/i18n/${REFERENCE_LOCALE}/. A dropped one\n` +
          'renders a literal `{name}` or silently loses the value; an invented one\n' +
          'never gets substituted:\n' +
          mismatched.join('\n'),
      );
    });
  }

  it('follow.* keys are not used through the global t()', async () => {
    // client/i18n/<locale>/follow.json is loaded by the scoped loader in
    // client/views/follow/i18n.js, keyed on the *deck* language, and is
    // deliberately absent from I18N_COMPONENTS in client/lib/ui-i18n.js.
    // A follow.* key passed to the global t() therefore never resolves and is
    // permanently stuck on its English fallback. Route it through the follow
    // `copy` object instead.
    const offenders = staticKeys.filter((k) => k.startsWith('follow.'));
    assert.deepStrictEqual(
      offenders.sort(),
      [],
      'follow.* keys must come from createFollowCopy(), not the global t():\n' +
        offenders
          .map(
            (k) => `  ${k}  <- ${used.get(k).file.replace(repoRoot + '/', '')}`,
          )
          .join('\n'),
    );
  });

  it('nl/ and en/ follow.json define every key createFollowCopy() uses', async () => {
    // The follow chrome resolves its own dictionary per *deck* language, which
    // deckLangToLocale() narrows to exactly 'nl' or 'en'. A key added to
    // createFollowCopy() without a matching follow.json entry silently keeps
    // its inline English fallback in both languages.
    const src = await fs.readFile(
      path.join(clientDir, 'views/follow/i18n.js'),
      'utf8',
    );
    const keys = [...src.matchAll(/\btr\(\s*'(follow\.[\w.]+)'/g)].map(
      (m) => m[1],
    );
    assert.ok(
      keys.length > 0,
      'no follow keys found — did createFollowCopy move?',
    );
    for (const locale of ['nl', 'en']) {
      const dict = JSON.parse(
        await fs.readFile(path.join(i18nDir, locale, 'follow.json'), 'utf8'),
      );
      const missing = keys.filter((k) => typeof dict[k] !== 'string');
      assert.deepStrictEqual(
        missing.sort(),
        [],
        `missing from client/i18n/${locale}/follow.json`,
      );
    }
  });

  it('descriptor pairs use one spelling (no <x>Default beside <x>Key)', async () => {
    // B94 folded the `<x>Key` / `<x>Default` spelling into the bare
    // `<x>Key` / `<x>` one and narrowed DESCRIPTOR_PAIR in scripts/lib/i18n-keys.js
    // to match only the survivor. Re-introducing `<x>Default` makes those keys
    // invisible to the coverage check above — which is exactly how six webhook
    // keys went missing before #831 — so it fails here instead.
    // shared/ too: the slide-type registry spells the same pair there, and a
    // `<x>Default` in it would be just as invisible.
    const offenders = [
      ...(await findLegacyDescriptorPairs(clientDir)),
      ...(await findLegacyDescriptorPairs(path.join(repoRoot, 'shared'))),
    ];
    assert.deepStrictEqual(
      offenders.map((o) => o.replace(repoRoot + '/', '')).sort(),
      [],
      'Descriptor pairs are spelled `<x>Key: …, <x>: …` — rename the `<x>Default` half:\n' +
        offenders.map((o) => `  ${o.replace(repoRoot + '/', '')}`).join('\n'),
    );
  });

  it('en/ holds every key any other locale holds', async () => {
    // en/ is the reference: it settles a key's English *and*, since B137, which
    // module file the key lives in. A key a locale translates while en/ has
    // never heard of it is therefore drift in the reference itself — either
    // English is missing a string it owns, or the key is dead and the locale is
    // carrying a translation of nothing. `i18n-fill.js en` closes the first case
    // (it seeds from the registry for the runtime-built families); the second
    // has to be deleted by hand, which is what this failure asks for.
    const locales = (await fs.readdir(i18nDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((name) => name !== 'en');
    const en = await loadLocale(i18nDir, 'en');
    const extra = [];
    for (const locale of locales) {
      for (const key of Object.keys(await loadLocale(i18nDir, locale))) {
        if (!(key in en)) extra.push(`client/i18n/${locale}/  ${key}`);
      }
    }
    assert.deepStrictEqual(
      extra.sort(),
      [],
      `${extra.length} key(s) exist in a locale but not in en/.\n` +
        'Run `node scripts/i18n-fill.js en` to add the ones the code still\n' +
        'uses; delete the rest from the locale — they render nothing:\n' +
        extra.join('\n'),
    );
  });

  it('every locale directory parses as JSON', async () => {
    const locales = (await fs.readdir(i18nDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    assert.ok(locales.length > 0, 'no locale directories found');
    for (const locale of locales) {
      await assert.doesNotReject(
        () => loadLocale(i18nDir, locale),
        `client/i18n/${locale}/ contains invalid JSON`,
      );
    }
  });
});

describe('i18n registry-declared keys', () => {
  // Check 8. `extractUsedKeys` scans client/ for `t()` call sites and descriptor
  // pairs; a slide-type field that points at a shared key writes that key down
  // in shared/slide-types/ instead, where nothing was looking. That is how
  // eighteen `editor.slideField.*` keys ended up declared in code, carrying an
  // English `label` fallback, and present in *no* locale — while
  // `i18n-fill.js en` reported "missing 0 key(s)" and this file stayed green
  // (B166/B168).
  //
  // The registry walk in scripts/lib/slide-type-i18n-keys.js already answers
  // "which keys does a type own?" for the prune and the fill. Reading it here
  // too means there is one canonical list of declared keys, not a second one
  // kept by hand.
  //
  // **Core only** — `CORE_SLIDE_TYPE_DEFS`, not the merged registry: a fork type
  // in custom/slide-types/ must not be able to fail this repo's CI, the same
  // rule i18n-fill.js and the generated reference docs follow.
  const declared = slideTypeUiKeys(CORE_SLIDE_TYPE_DEFS);

  /** @returns {Promise<string[]>} */
  const found = async () => {
    /** @type {Record<string, Record<string, unknown>>} */
    const dicts = {};
    for (const locale of REQUIRED_LOCALES)
      dicts[locale] = await loadLocale(i18nDir, locale);
    return detectUntranslatedRegistryKeys(declared, dicts);
  };

  it('every key the slide-type registry declares exists in nl/ and en/', async () => {
    const burndown = new Set(
      JSON.parse(await fs.readFile(REGISTRY_BURNDOWN_PATH, 'utf8')),
    );
    const gaps = (await found()).filter((row) => !burndown.has(row));
    assert.deepStrictEqual(
      gaps,
      [],
      `${gaps.length} key(s) declared in shared/slide-types/ have no value in a\n` +
        'Tier-1 locale. `node scripts/i18n-fill.js --apply en` writes the English\n' +
        'ones from the declaration; the rest need a translation. Do not add a\n' +
        'line to tests/i18n-registry-key-burndown.json — it only shrinks:\n' +
        gaps
          .slice(0, 20)
          .map((row) => `  ${row}`)
          .join('\n'),
    );
  });

  it('the burndown only shrinks: every row is still a live gap', async () => {
    const burndown = JSON.parse(
      await fs.readFile(REGISTRY_BURNDOWN_PATH, 'utf8'),
    );
    const present = new Set(await found());
    const stale = burndown.filter((row) => !present.has(row));
    assert.deepStrictEqual(
      stale,
      [],
      `${stale.length} row(s) in tests/i18n-registry-key-burndown.json are no\n` +
        'longer gaps — delete them so the list keeps burning down:\n' +
        stale.map((row) => `  ${row}`).join('\n'),
    );
  });

  it('the burndown is sorted and free of duplicates', async () => {
    const burndown = JSON.parse(
      await fs.readFile(REGISTRY_BURNDOWN_PATH, 'utf8'),
    );
    assert.deepStrictEqual([...burndown].sort(), burndown, 'keep it sorted');
    assert.strictEqual(
      new Set(burndown).size,
      burndown.length,
      'no duplicate rows',
    );
  });

  it('detector flags a shared field key no locale defines', () => {
    // The B166 shape exactly: a field pointing at an `editor.slideField.*` key
    // that lives only in the declaration.
    const declaredHere = slideTypeUiKeys({
      ghost: addUiI18nKeysToSlideType('ghost', {
        fields: [
          {
            key: 'title',
            type: 'string',
            label: 'Title',
            labelKey: 'editor.slideField.ghost.label',
          },
        ],
      }),
    });
    assert.deepStrictEqual(
      detectUntranslatedRegistryKeys(declaredHere, {
        en: { 'slideType.ghost.label': 'Ghost' },
        nl: { 'slideType.ghost.label': 'Spook' },
      }),
      [
        'en  editor.slideField.ghost.label',
        'nl  editor.slideField.ghost.label',
      ],
    );
  });

  it('detector passes a key both Tier-1 locales define', () => {
    const declaredHere = slideTypeUiKeys({
      ghost: addUiI18nKeysToSlideType('ghost', {
        label: 'Ghost',
        labelKey: 'slideType.ghost.label',
        fields: [],
      }),
    });
    assert.deepStrictEqual(
      detectUntranslatedRegistryKeys(declaredHere, {
        en: { 'slideType.ghost.label': 'Ghost' },
        nl: { 'slideType.ghost.label': 'Spook' },
      }),
      [],
    );
  });
});

describe('i18n fallback consistency', () => {
  // The fallback in `t(key, 'English')` is not decoration: it is what renders
  // the moment a locale lacks the key, so a key written down twice with two
  // different English strings *is* two strings for one meaning. Before this
  // gate, 25 keys carried more than one — `common.loading` carried three, one
  // of which said "Generating…", a different concept wearing the same key.
  //
  // The rule is the strict one: a fallback must be the en/ value verbatim, so
  // there is exactly one English spelling per key and it lives in one place.
  // That subsumes "one fallback per key" — two call sites cannot both equal the
  // en/ value and differ from each other — and it also catches the softer drift
  // where the JSON was reworded and the call site kept the old copy.
  it('every fallback spells the en/ value for its key', async () => {
    const en = await loadLocale(i18nDir, 'en');
    const sites = await collectFallbackSites(clientDir);
    assert.ok(sites.length > 0, 'no fallbacks found — did the extractor move?');
    const drifted = sites
      .filter((s) => typeof en[s.key] === 'string' && s.fallback !== en[s.key])
      .map(
        (s) =>
          `${s.file.replace(repoRoot + '/', '')}:${s.line}  ${s.key}\n` +
          `      call site: ${JSON.stringify(s.fallback)}\n` +
          `      en/:       ${JSON.stringify(en[s.key])}`,
      );
    assert.deepStrictEqual(
      drifted,
      [],
      `${drifted.length} fallback(s) disagree with client/i18n/en/.\n` +
        'Copy the en/ value to the call site — or, if the call site means a\n' +
        'different thing, give it its own key in en/ and nl/ rather than a\n' +
        'second English string under the shared one:\n' +
        drifted.join('\n'),
    );
  });

  it('an ellipsis is the single glyph …, never three dots', async () => {
    // `…` and `...` were split almost evenly across ~340 strings with no rule.
    // One glyph: it is one character to a screen reader, one to a line-breaker,
    // and one thing for a translator to copy.
    const offenders = [];
    for (const s of await collectFallbackSites(clientDir)) {
      if (s.fallback.includes('...')) {
        offenders.push(
          `${s.file.replace(repoRoot + '/', '')}:${s.line}  ${JSON.stringify(s.fallback)}`,
        );
      }
    }
    const locales = (await fs.readdir(i18nDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
    for (const locale of locales) {
      const dict = await loadLocale(i18nDir, locale);
      for (const [key, value] of Object.entries(dict)) {
        if (String(value).includes('...')) {
          offenders.push(
            `client/i18n/${locale}/  ${key}: ${JSON.stringify(value)}`,
          );
        }
      }
    }
    assert.deepStrictEqual(
      offenders.sort(),
      [],
      `${offenders.length} string(s) spell an ellipsis as three dots — use …:\n` +
        offenders.join('\n'),
    );
  });
});
