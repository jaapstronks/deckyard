/**
 * The instance-health census: what this install holds right now (A7.3, D245).
 *
 * The counters in `instance-health.js` record a *flow* — a key seen on a day.
 * A *stock* — how many decks carry `matrix-slide` today, which custom types
 * exist, which settings an admin changed — is a question to the state, so it
 * is answered here, at the moment the admin view opens (B516), and never kept
 * in a table that could drift from what it counts.
 *
 * **Every answer is an aggregate.** The census names slide types, custom-type
 * keys and settings keys with a number beside them; never a deck, a person,
 * an organization or a setting's value (a webhook URL or a signing secret is a
 * setting too). That is what lets it read across organizations: the reads take
 * a cross-organization scope (`docs/reference/storage-scope.md` § _When a scope
 * may be cross-organization_, category 4), because an instance's census is the
 * whole instance, the same unit the counters count in.
 *
 * Like the counters, the census leaves out sandbox decks (D248: demos built
 * from the examples) and decks in the trash.
 *
 * @module server/storage/instance-census
 */

import { sql } from 'kysely';
import { toStorageContext } from './scope.js';
import { withDbGuard } from './utils/index.js';
import { defaultAppSettings, getAppSettings } from './settings.js';
import { customSlideTypeKey } from '../../shared/slide-types/custom-type-runtime.js';

/**
 * One slide type as the decks of this instance carry it.
 *
 * @typedef {object} SlideTypeCensusRow
 * @property {string} key - The slide type (`matrix-slide`, `custom-<slug>`).
 * @property {number} decks - Decks carrying it in any language version.
 * @property {number} slides - Its slides across those decks; a slide present
 *   in several language versions (same id) counts once.
 */

/**
 * One custom slide type key as the organizations of this instance define it.
 *
 * @typedef {object} CustomTypeCensusRow
 * @property {string} key - The registry key, `custom-<slug>`.
 * @property {number} definitions - How many organizations define this key.
 * @property {number} published - How many of those definitions are published.
 */

/**
 * The slide types the live decks carry: per type, how many decks and how many
 * slides. Every language version is read, the way the `slide_type.authored`
 * counter reads a deck, and a slide shared by several versions counts once,
 * the way `deleteCustomSlideType` counts usage (B414).
 *
 * @param {import('./scope.js').StorageScope} scope - Cross-organization.
 * @returns {Promise<SlideTypeCensusRow[]>} By key; `[]` without a database.
 */
export async function readSlideTypeCensus(scope) {
  toStorageContext(
    scope,
    'readSlideTypeCensus',
    {},
    { allowCrossOrganization: true },
  );
  return withDbGuard([], async (db) => {
    const { rows } = await sql`
      select type, count(*) as decks, sum(n) as slides
      from (
        select p.id, s->>'type' as type,
          count(distinct coalesce(s->>'id', s::text)) as n
        from presentations p
        cross join lateral (
          select jsonb_path_query(p.slides, '$[*]')
          union all
          select jsonb_path_query(p.i18n, '$.versions.*.slides[*]')
        ) as used(s)
        where p.trashed_at is null
          and coalesce(p.sandbox->>'enabled', 'false') <> 'true'
        group by p.id, s->>'type'
      ) as per_deck
      where type is not null and type <> ''
      group by type
      order by type
    `.execute(db);
    return rows.map((row) => ({
      key: row.type,
      decks: Number(row.decks) || 0,
      slides: Number(row.slides) || 0,
    }));
  });
}

/**
 * The custom slide types the organizations define, folded per registry key:
 * two organizations that both define `custom-hero` are one row with
 * `definitions: 2`. Which organization defines what is not in the answer.
 *
 * @param {import('./scope.js').StorageScope} scope - Cross-organization.
 * @returns {Promise<CustomTypeCensusRow[]>} By key; `[]` without a database.
 */
export async function readCustomTypeCensus(scope) {
  toStorageContext(
    scope,
    'readCustomTypeCensus',
    {},
    { allowCrossOrganization: true },
  );
  return withDbGuard([], async (db) => {
    const rows = await db
      .selectFrom('custom_slide_types')
      .select(['slug', 'is_published'])
      .execute();
    /** @type {Map<string, CustomTypeCensusRow>} */
    const byKey = new Map();
    for (const row of rows) {
      const key = customSlideTypeKey(row);
      const entry = byKey.get(key) || { key, definitions: 0, published: 0 };
      entry.definitions += 1;
      if (row.is_published) entry.published += 1;
      byKey.set(key, entry);
    }
    return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
  });
}

/**
 * The settings keys whose value differs from the default, as dotted paths
 * (`analytics.enabled`, `webhooks.signingSecret`). Only the names: the values
 * stay where they are.
 *
 * `app_settings` is per instance, so this is the instance's own deviation, read
 * the way every caller reads it: through `getAppSettings`, normalized and merged
 * with the defaults, then compared leaf by leaf. An array is one leaf.
 *
 * @param {import('./scope.js').StorageScope} scope - Cross-organization.
 * @returns {Promise<string[]>} Sorted.
 */
export async function readChangedSettingsKeys(scope) {
  toStorageContext(
    scope,
    'readChangedSettingsKeys',
    {},
    { allowCrossOrganization: true },
  );
  return changedKeys(await getAppSettings(scope), defaultAppSettings()).sort();
}

/**
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The dotted leaf paths at which `actual` and `defaults` disagree.
 *
 * @param {*} actual
 * @param {*} defaults
 * @param {string} [prefix]
 * @returns {string[]}
 */
export function changedKeys(actual, defaults, prefix = '') {
  if (isPlainObject(actual) && isPlainObject(defaults)) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(defaults)]);
    return [...keys].flatMap((key) =>
      changedKeys(
        actual[key],
        defaults[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  }
  return JSON.stringify(actual) === JSON.stringify(defaults) ? [] : [prefix];
}
