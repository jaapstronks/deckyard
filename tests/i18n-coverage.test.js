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
 *  9. and the English it declares for such a key *is* the en/ value — check 5
 *     for the registry, so a declaration and a locale file cannot spell one
 *     meaning two ways
 * 10. no locale spells one English concept two ways — the anchor invariant the
 *     whole B133-B141 translation series leaned on, graded against
 *     scripts/i18n-anchor-allowlist.json
 * 11. no Tier-2 locale ships a carbon copy of an en/ value — since D73 an
 *     untranslated key is *absent*, not a copy of the English
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
  TIER_2,
} from '../scripts/lib/i18n-locales.js';
import { CORE_SLIDE_TYPE_DEFS } from '../shared/slide-types/registry.js';
import { addUiI18nKeysToSlideType } from '../shared/ui-i18n-keys.js';
import {
  slideTypeUiKeys,
  slideTypeUiStrings,
} from '../scripts/lib/slide-type-i18n-keys.js';
import {
  UNREVIEWED,
  allowlistRows,
  anchorRowKey,
  detectAnchorDrift,
} from '../scripts/lib/i18n-anchors.js';

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
 * permanent exemption. It was seeded with the `slideType.*` keys `nl/` had
 * never translated — pre-existing debt this gate made visible, not something it
 * introduced. The shared `editor.slideField.*` namespace entered at zero, and
 * since B173 the list itself is empty: every declared key has a Tier-1 value.
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

/**
 * Every registry-declared English string that disagrees with the en/ value for
 * its key — check 9.
 *
 * Pure for the same reason as the detector above: the negative self-tests drive
 * it with a hand-built registry, so the gate is shown to catch what it is for.
 *
 * @param {Map<string, string>} declared - key -> declared English (`slideTypeUiStrings`)
 * @param {Record<string, unknown>} en - the en/ dictionary
 * @returns {string[]} sorted report rows, one per drifted key
 */
export function detectRegistryEnglishDrift(declared, en) {
  const rows = [];
  for (const [key, english] of declared) {
    if (typeof en[key] !== 'string' || en[key] === english) continue;
    rows.push(
      `${key}\n      declaration: ${JSON.stringify(english)}\n` +
        `      en/:         ${JSON.stringify(en[key])}`,
    );
  }
  return rows.sort();
}

/**
 * Every (locale, key) pair whose value is byte-identical to the reference's —
 * check 11.
 *
 * Pure for the same reason as the two detectors above: the negative self-tests
 * drive it with hand-built dictionaries, so the gate is shown to catch what it
 * is for.
 *
 * @param {Record<string, unknown>} reference - the en/ dictionary
 * @param {Record<string, Record<string, unknown>>} dicts - locale id -> dictionary
 * @returns {string[]} sorted `"<locale>  <key>"` rows
 */
export function detectCarbonCopies(reference, dicts) {
  const rows = [];
  for (const [locale, dict] of Object.entries(dicts)) {
    for (const [key, value] of Object.entries(dict)) {
      if (value === reference[key]) rows.push(`${locale}  ${key}`);
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

  // Check 9. Check 8 asks whether the key has *a* value; this asks whether the
  // English next to it is *the* value. A field declares `label: 'Centre label'`
  // while en/ says "Center label" and both are shipped English for one key —
  // the same defect check 5 gates at `t()` call sites, one surface further out.
  // B168 measured four of these; the registry was the last place English could
  // be written down a second time without anything noticing.
  //
  // en/ is the reference, so the declaration is what moves when they disagree —
  // unless the *key* is the mistake, in which case the fix is to stop declaring
  // it (the imageRole `ariaLabel` slots repeated their label in all 12 locales
  // and simply went away).
  it('every English the registry declares is the en/ value for its key', async () => {
    const declaredStrings = slideTypeUiStrings(CORE_SLIDE_TYPE_DEFS);
    assert.ok(
      declaredStrings.size > 0,
      'no declared strings — did the registry walk move?',
    );
    const en = await loadLocale(i18nDir, REFERENCE_LOCALE);
    const drifted = detectRegistryEnglishDrift(declaredStrings, en);
    assert.deepStrictEqual(
      drifted,
      [],
      `${drifted.length} registry declaration(s) disagree with client/i18n/en/.\n` +
        'Pick one English and write it in both places — or, if the declaration\n' +
        'means something the label does not, give it its own key rather than a\n' +
        'second English string under the shared one:\n' +
        drifted.join('\n'),
    );
  });

  it('drift detector flags a declaration that disagrees with en/', () => {
    const declaredHere = slideTypeUiStrings({
      ghost: addUiI18nKeysToSlideType('ghost', {
        label: 'Ghost',
        labelKey: 'slideType.ghost.label',
        fields: [{ key: 'centre', type: 'string', label: 'Centre label' }],
      }),
    });
    assert.deepStrictEqual(
      detectRegistryEnglishDrift(declaredHere, {
        'slideType.ghost.label': 'Ghost',
        'slideType.ghost.field.centre.label': 'Center label',
      }),
      [
        'slideType.ghost.field.centre.label\n' +
          '      declaration: "Centre label"\n' +
          '      en/:         "Center label"',
      ],
    );
  });

  it('drift detector passes a declaration en/ spells the same way', () => {
    const declaredHere = slideTypeUiStrings({
      ghost: addUiI18nKeysToSlideType('ghost', {
        label: 'Ghost',
        labelKey: 'slideType.ghost.label',
        fields: [{ key: 'centre', type: 'string', label: 'Center label' }],
      }),
    });
    assert.deepStrictEqual(
      detectRegistryEnglishDrift(declaredHere, {
        'slideType.ghost.label': 'Ghost',
        'slideType.ghost.field.centre.label': 'Center label',
      }),
      [],
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

describe('i18n carbon copies', () => {
  // Check 11. `i18n-sync` used to *fill* a Tier-2 locale's missing keys with
  // their English values as placeholders. That was a lie to two instruments:
  // the anchor gate below read a placeholder as a second spelling of a concept
  // the locale translates elsewhere (280 such findings in one sync round), and
  // `missingFor()` in scripts/i18n-fill.js counted a filled key as translated,
  // so the translator gap report said zero for a locale with hundreds of holes.
  //
  // D73 settled it: an untranslated key is **absent**. Absence costs nothing —
  // `t(key, fallback)` renders the call-site fallback, and check 5 above pins
  // every fallback on the en/ value, so a missing key renders byte-identical to
  // the English copy that is no longer stored. This gate is the ratchet on that
  // one canonical form, and it sits at **zero** rather than on a burndown: the
  // 1.030 pre-existing copies were stripped in the same change that wrote it,
  // so there is no debt for a list to hold.
  //
  // Tier 1 is out of scope by policy, not by oversight. `nl` must be complete,
  // and a Dutch value equal to the English can be correct Dutch — "Export",
  // "Status", "Design". Only Tier 2 may express a gap by absence.
  it('no Tier-2 locale ships a value identical to its en/ one', async () => {
    const reference = await loadLocale(i18nDir, REFERENCE_LOCALE);
    /** @type {Record<string, Record<string, unknown>>} */
    const dicts = {};
    for (const locale of TIER_2)
      dicts[locale] = await loadLocale(i18nDir, locale);

    const copies = detectCarbonCopies(reference, dicts);
    assert.deepStrictEqual(
      copies,
      [],
      `${copies.length} Tier-2 value(s) are a carbon copy of client/i18n/` +
        `${REFERENCE_LOCALE}/. Delete them — the key falls back to the same\n` +
        'English string, and a copy makes an untranslated key look translated\n' +
        'to the anchor gate and to `i18n-fill.js <locale>`. ' +
        '`npm run i18n:sync -- --apply` strips them:\n' +
        copies
          .slice(0, 20)
          .map((row) => `  ${row}`)
          .join('\n'),
    );
  });

  it('detector flags a Tier-2 value copied straight from en/', () => {
    // The shape the fill produced: `de` translated one key and was handed the
    // English for the other.
    assert.deepStrictEqual(
      detectCarbonCopies(
        { 'a.export': 'Export', 'b.save': 'Save' },
        { de: { 'a.export': 'Exportieren', 'b.save': 'Save' } },
      ),
      ['de  b.save'],
    );
  });

  it('detector passes a locale that translates or omits, never copies', () => {
    assert.deepStrictEqual(
      detectCarbonCopies(
        { 'a.export': 'Export', 'b.save': 'Save' },
        { de: { 'a.export': 'Exportieren' } },
      ),
      [],
    );
  });

  it('detector ignores a key the reference has never heard of', () => {
    // Check 7 owns that case ("en/ holds every key any other locale holds").
    // Reading it as a carbon copy would report one defect as two.
    assert.deepStrictEqual(
      detectCarbonCopies({}, { de: { 'a.ghost': 'Ghost' } }),
      [],
    );
  });
});

describe('i18n anchor consistency', () => {
  // Check 10. Checks 5 and 9 pin one *English* string per key. This pins one
  // *translation* per English string: if en/ says the same thing under two
  // keys, the two keys mean the same thing, so a locale that spells them
  // differently has two words for one meaning.
  //
  // That invariant carried the whole B133–B141 translation series and had no
  // mechanical representation at all, which is how nl ended up shipping
  // `Export` beside `Exporteren`, de `Workspace` beside `Arbeitsbereich`, and
  // fi `7 päivää` beside `7 paivaa` — the same word, typed once without its
  // diacritics. 499 such pairs were live when this gate was written (B148).
  //
  // The gate does not pretend the whole 499 is drift. Some of it is grammar
  // (fr `Sombre`/`Sombres` agrees with its noun) and some is English on
  // purpose (`Mist` is a colour-slot name, not an untranslated string). The
  // detector cannot tell those from a mistake — only a translator can — so
  // every live pair sits in scripts/i18n-anchor-allowlist.json with a reason,
  // and the reasons that still say "unreviewed" are the debt this burns down.
  //
  // What the gate buys today is the ratchet: a new key reusing an existing
  // English string must match the form already in use, or someone has to write
  // down why it does not. Without it the next translation round is hand work
  // with the same blind spot.
  const ANCHOR_ALLOWLIST_PATH = path.join(
    repoRoot,
    'scripts',
    'i18n-anchor-allowlist.json',
  );

  /**
   * How many rows were still unjudged when the gate landed (B148, 2026-08-27).
   *
   * The other burndowns in this suite keep themselves honest with a stale-row
   * check alone; this one needs a number too, because its reconcile step
   * (`i18n-anchor-report.js --apply`) can add rows. The ceiling is what stops
   * that from being a way to launder new drift into the list. It moves in one
   * direction: down, as rows are judged or fixed — and the equality check below
   * forces this constant to follow, so paid-down debt never turns into headroom
   * a later `--apply` could spend on new drift.
   */
  const UNREVIEWED_BASELINE = 406;

  /** @returns {Promise<import('../scripts/lib/i18n-anchors.js').AnchorFinding[]>} */
  const found = async () => {
    const reference = await loadLocale(i18nDir, REFERENCE_LOCALE);
    /** @type {Record<string, Record<string, string>>} */
    const dicts = {};
    for (const locale of LOCALE_IDS) {
      if (locale === REFERENCE_LOCALE) continue;
      dicts[locale] = await loadLocale(i18nDir, locale);
    }
    return detectAnchorDrift(reference, dicts);
  };

  /** @returns {Promise<Map<string, {forms: string[], reason: string}>>} */
  const allowed = async () =>
    allowlistRows(JSON.parse(await fs.readFile(ANCHOR_ALLOWLIST_PATH, 'utf8')));

  it('no locale spells one English concept two ways', async () => {
    const rows = await allowed();
    const unlisted = (await found()).filter((f) => {
      const entry = rows.get(anchorRowKey(f));
      return !entry || JSON.stringify(entry.forms) !== JSON.stringify(f.forms);
    });
    assert.deepStrictEqual(
      unlisted.map(anchorRowKey),
      [],
      `${unlisted.length} (locale, concept) pair(s) are spelled more than one\n` +
        'way and are not on the allowlist. Pick the form already in use — or,\n' +
        'if both are right (grammatical agreement, or one of them is English on\n' +
        'purpose), add the row to scripts/i18n-anchor-allowlist.json with the\n' +
        'reason. `node scripts/i18n-anchor-report.js` shows them ranked:\n' +
        unlisted
          .slice(0, 20)
          .map(
            (f) =>
              `  ${f.locale}  ${JSON.stringify(f.concept)}  ->  ` +
              f.forms.map((x) => JSON.stringify(x)).join(' | '),
          )
          .join('\n'),
    );
  });

  it('the allowlist only shrinks: every row is still a live pair', async () => {
    const live = new Map((await found()).map((f) => [anchorRowKey(f), f]));
    const stale = [...(await allowed())]
      .filter(([row, entry]) => {
        const finding = live.get(row);
        if (!finding) return true;
        // The forms are part of the row: allowing "Sombre | Sombres" is not
        // allowing whatever pair replaces it.
        return JSON.stringify(finding.forms) !== JSON.stringify(entry.forms);
      })
      .map(([row]) => row);
    assert.deepStrictEqual(
      stale,
      [],
      `${stale.length} row(s) in scripts/i18n-anchor-allowlist.json no longer\n` +
        'describe live drift — the translation changed, or the concept is\n' +
        'consistent now. Run `node scripts/i18n-anchor-report.js --apply` to\n' +
        'drop them so the list keeps burning down:\n' +
        stale
          .slice(0, 20)
          .map((row) => `  ${row}`)
          .join('\n'),
    );
  });

  it('the unreviewed backlog does not grow', async () => {
    const unreviewed = [...(await allowed()).values()].filter((entry) =>
      entry.reason.startsWith(UNREVIEWED),
    );
    assert.ok(
      unreviewed.length <= UNREVIEWED_BASELINE,
      `${unreviewed.length} unreviewed row(s) in ` +
        `scripts/i18n-anchor-allowlist.json, up from ${UNREVIEWED_BASELINE}.\n` +
        'A new pair needs a decision, not a seat on the backlog: fix the\n' +
        'translation, or state why both forms are correct.',
    );
    assert.strictEqual(
      unreviewed.length,
      UNREVIEWED_BASELINE,
      `${unreviewed.length} unreviewed row(s), below the baseline of ` +
        `${UNREVIEWED_BASELINE}. Good — now lower UNREVIEWED_BASELINE in this\n` +
        'test to match, so the paid-down debt cannot be spent on new drift\n' +
        'later.',
    );
  });

  it('every allowlist row carries a reason', async () => {
    const silent = [...(await allowed())]
      .filter(([, entry]) => !entry.reason.trim())
      .map(([row]) => row);
    assert.deepStrictEqual(
      silent,
      [],
      'A row without a reason is a mute button, not a burndown:\n' +
        silent.map((row) => `  ${row}`).join('\n'),
    );
  });

  it('the allowlist is sorted and free of duplicate forms', async () => {
    const raw = JSON.parse(await fs.readFile(ANCHOR_ALLOWLIST_PATH, 'utf8'));
    const keys = Object.keys(raw.anchors);
    assert.deepStrictEqual([...keys].sort(), keys, 'keep it sorted');
    for (const [row, entry] of Object.entries(raw.anchors)) {
      assert.deepStrictEqual(
        [...entry.forms].sort(),
        entry.forms,
        `${row}: forms must be sorted`,
      );
      assert.strictEqual(
        new Set(entry.forms).size,
        entry.forms.length,
        `${row}: duplicate form`,
      );
      assert.ok(entry.forms.length >= 2, `${row}: needs at least two forms`);
    }
  });

  it('detector flags a locale that spells one concept two ways', () => {
    // The nl `Export`/`Exporteren` shape exactly: one English string under two
    // keys, two Dutch words.
    assert.deepStrictEqual(
      detectAnchorDrift(
        { 'a.export': 'Export', 'b.export': 'Export', 'c.only': 'Only' },
        {
          nl: { 'a.export': 'Export', 'b.export': 'Exporteren', 'c.only': 'X' },
        },
      ),
      [
        {
          locale: 'nl',
          concept: 'Export',
          forms: ['Export', 'Exporteren'],
          keys: ['a.export', 'b.export'],
        },
      ],
    );
  });

  it('detector passes a locale that uses one form throughout', () => {
    assert.deepStrictEqual(
      detectAnchorDrift(
        { 'a.export': 'Export', 'b.export': 'Export' },
        { nl: { 'a.export': 'Exporteren', 'b.export': 'Exporteren' } },
      ),
      [],
    );
  });

  it('detector ignores a key the locale has not translated', () => {
    // A missing key renders the English t() fallback — a coverage gap, which
    // checks 1 and 8 own. Counting it as a second form would report every
    // partially translated concept as drift.
    assert.deepStrictEqual(
      detectAnchorDrift(
        { 'a.export': 'Export', 'b.export': 'Export' },
        { de: { 'a.export': 'Exportieren' } },
      ),
      [],
    );
  });
});
