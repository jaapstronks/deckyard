# UI locale tiers

Deckyard ships its interface in twelve languages, but it does not promise the
same thing about all twelve. This is the canonical statement of what each tier
means; the UI language picker, the test gate and the developer guide all point
here.

## The two tiers

| Tier                | Locales                                                    | Promise                                                                                                                                                                                                                                                          |
| ------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — supported**   | `nl`, `en`                                                 | Complete and **gated**. Every key the code uses exists in both, and `npm test` fails if one drifts. No release ships with a Tier-1 gap.                                                                                                                          |
| **2 — best effort** | `de`, `fr`, `es`, `pt`, `it`, `pl`, `fi`, `da`, `sv`, `no` | Present and useful, **completeness not gated**. A missing key falls back to the inline English string in the `t(key, fallback)` call, so an incomplete Tier-2 locale degrades to English rather than breaking. Tooling reports the gap; it does not block on it. |

`nl` is the default UI locale; `en` is the reference — the fallback baked into
every `t()` call is the English string, so English is what a Tier-2 gap shows.

**The tier governs completeness, and nothing else.** Whatever a locale _does_
ship is live the moment a user picks it in the language menu, so the checks on
the strings that are there run over all twelve: no empty values, and `{var}`
placeholders matching the reference. Neither of those degrades to English — an
empty value renders nothing at all, and a dropped `{var}` renders a literal
`{name}` or silently loses the value — so "falls back to English" is no
argument for leaving them ungated.

## Why tiering instead of removing locales

Dropping the ten Tier-2 locales was considered and **rejected**: it buys nothing
over tiering and would break any user we don't know about (Deckyard is in beta
with a near-zero installed base, so "we don't know about them" is the honest
default). Tiering removes the _permanent obligation_ — every new string no
longer owes twelve translations — without throwing away the translations that
exist or the users who rely on them. It is a promise problem, not a quality one:
the ten locales stay, we are just honest about what "supported" covers.

## Where this is enforced

- **Machine source of truth:** the `tier` field on each locale in
  `client/i18n/manifest.json`. `scripts/lib/i18n-locales.js` reads it and exports
  `TIER_1` / `TIER_2` / `tierOf(id)` for Node-side tooling; the browser reads the
  same field straight off the fetched manifest.
- **The gates:** `tests/i18n-coverage.test.js` derives its _completeness_ list
  from `TIER_1`, so "every key the code uses exists" blocks on `nl` + `en` only.
  Its empty-value and placeholder-parity checks derive from `LOCALE_IDS` and
  block on all twelve, per the paragraph above. `tests/i18n-locales.test.js`
  keeps the manifest, this document and the picker from disagreeing.
- **Missing fallbacks:** the one way Tier-2's graceful degradation can break is a
  `t()` call written without its English fallback argument — then a missing key
  renders the raw key string, not English. An ESLint rule
  (`no-restricted-syntax` on `t(key)` with no second argument, scoped to
  `client/`) fails the lint on that.
- **The picker:** `client/views/settings/tabs/preferences-tab.js` groups the
  selector by tier so the label is honest about what "best effort" means.

## What else the manifest declares

`tier` is one of three fields the i18n tooling reads out of
`client/i18n/manifest.json`; all three are there so no script keeps a list of
its own (B132 found four hand-kept spellings that had drifted apart).

| Field              | Means                                                                                                                                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `locales[].tier`   | The promise above. Drives the coverage gate and the picker's grouping.                                                                                                                                                         |
| `reference`        | The locale the English source text lives in (`en`). It is what every `t(key, fallback)` fallback says, what `i18n-sync` measures a carbon copy against, and what `tests/i18n-coverage.test.js` compares every other locale to. |
| `modules[].loader` | Which loader reads that module file — see below.                                                                                                                                                                               |

Two loaders exist:

- **`ui`** — merged into the global dictionary by `client/lib/ui-i18n.js`
  (`I18N_COMPONENTS`) for whichever UI locale the user picked. Every locale is
  selectable, so every locale's copy is live.
- **`deck`** — read by a scoped loader keyed on the **deck** language instead of
  the UI locale. Today that is `follow.json` via `client/views/follow/i18n.js`,
  whose `deckLangToLocale()` resolves every deck language to `nl` or `en` — so a
  `deck` module is only ever read in Tier 1.

## An untranslated key is absent

A Tier-2 gap is written down as **absence**, never as a copy of the English.
That is the second half of `i18n-sync`: a **strip** that deletes every Tier-2
value byte-identical to its `en/` one, gated at zero by
`tests/i18n-coverage.test.js` (check 11).

It costs nothing, because absence and an English copy render the same string.
`t(key, fallback)` falls back to the call-site literal, and check 5 of the same
suite pins every fallback on the `en/` value — so the copy was pure duplication.
What it cost was truth: `i18n-sync` used to _write_ those copies (a fill of
~1.8k keys a round), and they lied to two instruments. The anchor gate read a
placeholder as a second spelling of a concept the locale translates elsewhere
(280 findings in one round), and `missingFor()` in `scripts/i18n-fill.js`
counted a filled key as translated, so the translator gap report said zero for a
locale with hundreds of holes. D73 removed the fill rather than teach both
instruments to recognise a placeholder.

Both halves of `i18n-sync` are deletions now, and both sweep **every module** —
a dead `slideType.*` key and a carbon copy are dead weight wherever they sit,
`follow.json` included. Only the locale axis differs: the prune covers every
locale, the strip only Tier 2. `tests/i18n-sync-plan.test.js` asserts that
matrix.

**Tier 1 is out of the strip by policy.** `nl` must stay complete, and a Dutch
value equal to the English can be correct Dutch — "Export", "Status", "Design".
Only a Tier-2 locale may express a gap by absence, and the tier is the whole of
that rule: there is deliberately no per-locale opt-out list. The eight-of-twelve
fill list that preceded it looked like policy — "don't stuff the hand-translated
ones with English" — but all twelve are hand-translated, and the three it
skipped (`it`, `pl`, `fi`) were the _most_ complete Tier-2 locales. It was
drift. If a Tier-2 locale ever does need to sit out, that is a manifest field
with a stated reason.

To actually translate a locale rather than strip it, use
`node scripts/i18n-fill.js <locale> --json` — the translator hand-off, which now
reports the real gap.

## Adding or promoting a locale

Change the `tier` field in `client/i18n/manifest.json` and update the table
above — the manifest is the only place the list lives, so the scripts, the gate
and the picker follow automatically (`tests/i18n-locales.test.js` fails if a
manifest locale has no directory, or a directory holds files the manifest does
not declare). Promoting a locale to Tier 1 means committing to keep it complete — the
coverage gate will start failing the moment it has a gap, which is the point.

## Slide-type descriptions are Tier 1 too

The picker's per-type description is a Tier-1 surface: every insertable core
slide type must carry both the English `description` (in its `authoring.js`) and
the Dutch `editor.slideTypeDesc.<type>` (in `client/i18n/nl/editor.json`). The
other ten locales fall back to English like any Tier-2 string. The
`picker-description` and `picker-description-nl` companions in
`tests/helpers/slide-type-companions.js` gate the pair — see
`docs/reference/slide-type-companions.md`.
