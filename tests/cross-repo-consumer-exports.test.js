import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * The exports `deckyard-website` reads out of this repo.
 *
 * Its `scripts/generate-slide-types.js` imports these to generate
 * `src/data/slide-types.json`, which is what `/spec/slide-types/` and the
 * built-in slide-type count on deckyard.eu are rendered from. None of them has
 * an in-repo importer, so every dead-export sweep sees a module-local const and
 * every JSDoc note asking it not to is advisory. This test is the part that is
 * not advisory.
 *
 * It exists because the advisory version failed twice in one day: the
 * hand-verified sweep #536 demoted `SLIDE_STRUCTURES`, the generator crashed on
 * it (#558 put it back), and the very next line of that generator crashed on
 * `SLIDE_RUNTIMES` and `LIVE_INTERACTIONS`. A grep bounded by this repo cannot
 * see any of that; a failing test can.
 *
 * The list is deliberately a flat literal rather than anything derived — it is
 * a statement about a *consumer*, and the only honest source for it is that
 * consumer. Removing an entry is allowed; it means coordinating with
 * `deckyard-website` first (a `_meta` briefing), which is exactly the step the
 * two crashes skipped.
 */
const WEBSITE_GENERATOR_IMPORTS = {
  'shared/slide-types/registry.js': [
    'SLIDE_TYPES',
    'CORE_SLIDE_TYPE_NAMES',
    'SLIDE_TYPE_IDS',
    'GLOBAL_SLIDE_FIELD_KEYS',
  ],
  'shared/slide-types/structure.js': [
    'SLIDE_STRUCTURES',
    'SLIDE_STRUCTURE_NAMES',
    'slideStructure',
  ],
  'shared/slide-types/runtime.js': [
    'SLIDE_RUNTIMES',
    'SLIDE_RUNTIME_NAMES',
    'LIVE_INTERACTIONS',
    'LIVE_INTERACTION_NAMES',
    'slideRuntime',
    'slideLiveInteraction',
  ],
  'shared/slide-types/tiers.js': [
    'SLIDE_TIERS',
    'CORE_PROFILE',
    'slideTypeTier',
    'slideFallback',
  ],
  'client/views/editor/slide-type-schematics.js': ['SLIDE_TYPE_SCHEMATIC'],
  'client/views/editor/slide-type-picker/data.js': [
    'PICKER_GROUP_ORDER',
    'PICKER_GROUP_KEYS',
  ],
  'shared/slide-types/authoring-companions.js': ['SLIDE_TYPE_DESCRIPTION'],
  'server/utils/ai/slide-catalog/definitions.js': ['getCoreSlideCatalog'],
  'shared/slide-types/deck.js': ['presentationToDeck'],
  'server/export/deck-bundle.js': ['DECK_MIMETYPE', 'DECK_BUNDLE_VERSION'],
  'shared/slide-types/json-schema.js': [
    'SCHEMA_BASE_URI',
    'deckJsonSchema',
    'slideTypeContentSchema',
  ],
  'shared/slide-types/schema-version.js': ['CURRENT_SCHEMA_VERSION'],
};

test('every export deckyard-website generates from is still exported', async () => {
  const missing = [];

  for (const [file, names] of Object.entries(WEBSITE_GENERATOR_IMPORTS)) {
    const module = await import(`../${file}`);
    for (const name of names) {
      if (module[name] === undefined) missing.push(`${file} → ${name}`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `deckyard-website imports these and would crash without them:\n  ${missing.join('\n  ')}\n` +
      'Removing one is a cross-repo change: brief deckyard-website first.',
  );
});
