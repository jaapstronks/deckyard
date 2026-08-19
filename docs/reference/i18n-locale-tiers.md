# UI locale tiers

Deckyard ships its interface in twelve languages, but it does not promise the
same thing about all twelve. This is the canonical statement of what each tier
means; the UI language picker, the test gate and the developer guide all point
here.

## The two tiers

| Tier                | Locales                                                    | Promise                                                                                                                                                                                                                                             |
| ------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 — supported**   | `nl`, `en`                                                 | Complete and **gated**. Every key the code uses exists in both, and `npm test` fails if one drifts. No release ships with a Tier-1 gap.                                                                                                             |
| **2 — best effort** | `de`, `fr`, `es`, `pt`, `it`, `pl`, `fi`, `da`, `sv`, `no` | Present and useful, **not gated**. A missing key falls back to the inline English string in the `t(key, fallback)` call, so an incomplete Tier-2 locale degrades to English rather than breaking. Tooling reports the gap; it does not block on it. |

`nl` is the default UI locale; `en` is the reference — the fallback baked into
every `t()` call is the English string, so English is what a Tier-2 gap shows.

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
  `client/i18n/manifest.json`. `scripts/i18n-tiers.js` reads it and exports
  `TIER_1` / `TIER_2` / `tierOf(id)` for Node-side tooling; the browser reads the
  same field straight off the fetched manifest.
- **The gate:** `tests/i18n-coverage.test.js` derives its required-locales list
  from `TIER_1`, so it blocks on `nl` + `en` only. `tests/i18n-tiers.test.js`
  keeps the manifest, this document and the picker from disagreeing.
- **Missing fallbacks:** the one way Tier-2's graceful degradation can break is a
  `t()` call written without its English fallback argument — then a missing key
  renders the raw key string, not English. An ESLint rule
  (`no-restricted-syntax` on `t(key)` with no second argument, scoped to
  `client/`) fails the lint on that.
- **The picker:** `client/views/settings/tabs/preferences-tab.js` groups the
  selector by tier so the label is honest about what "best effort" means.

## Adding or promoting a locale

Change the `tier` field in `client/i18n/manifest.json` and update the table
above. Promoting a locale to Tier 1 means committing to keep it complete — the
coverage gate will start failing the moment it has a gap, which is the point.

## Slide-type descriptions are Tier 1 too

The picker's per-type description is a Tier-1 surface: every insertable core
slide type must carry both the English `description` (in its `authoring.js`) and
the Dutch `editor.slideTypeDesc.<type>` (in `client/i18n/nl/editor.json`). The
other ten locales fall back to English like any Tier-2 string. The
`picker-description` and `picker-description-nl` companions in
`tests/helpers/slide-type-companions.js` gate the pair — see
`docs/reference/slide-type-companions.md`.
