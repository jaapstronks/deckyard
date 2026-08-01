import { serveJson } from '../../utils/http.js';
import { SLIDE_TYPES } from '../../../shared/slide-types.js';
import { slideStructure } from '../../../shared/slide-types/structure.js';
import {
  slideLiveInteraction,
  slideRuntime,
} from '../../../shared/slide-types/runtime.js';
import { slideTypeGroup } from '../../../shared/slide-types/authoring-groups.js';
import {
  SLIDE_TIER,
  slideFallback,
  slideTypeTier,
} from '../../../shared/slide-types/tiers.js';
import {
  slideTypeAliases,
  slideTypeDescription,
  slideTypeSample,
  slideTypeSchematic,
} from '../../../shared/slide-types/authoring-companions.js';
import { slideTypeInspectorKeeps } from '../../../shared/slide-types/inline-edit-companions.js';
import { listPublishedCustomSlideTypes } from '../../storage/custom-slide-types.js';
import { createRouteContext } from '../../utils/context.js';

export async function handleSlideTypes({ req, res, url, authedUser }) {
  // Slide type metadata (for editor UI). Keeps client/server in sync.
  // Merges registered types (core + file-based) with published custom types.
  // NB: the `tier` key below is the spec ladder from shared/slide-types/tiers.js
  // (core profile / Deckyard set / extension), not this merge order.
  if (url.pathname === '/api/slide-types' && req.method === 'GET') {
    const meta = {};

    // Registered types: core, plus whatever a fork put in custom/slide-types/.
    for (const [key, def] of Object.entries(SLIDE_TYPES)) {
      meta[key] = {
        label: def.label,
        fields: def.fields,
        defaults: def.defaults,
        // Deprecated types stay renderable (existing slides) but the editor's
        // insertion policy hides them from the picker + AI. The client needs
        // the flag to enforce that, so it travels in the metadata.
        deprecated: def.deprecated === true ? true : undefined,
        // The `structure` facet: what shape this type's content has
        // (singleton / collection / tabular / …). Spec-level and additive —
        // consumers that do not know the key ignore it, and the ones that do
        // (picker groups, settings categories, conversion) stop needing a
        // hand-written table. See shared/slide-types/structure.js.
        structure: slideStructure(def) || undefined,
        // The `runtime` facet: what the presenting session has to do for this
        // type beyond serving it (static / timed / live). Additive in the same
        // way, and the answer nine modules used to hard-code as a list of four
        // type names. `interaction` is the sub-contract `live` implies — which
        // kind of answer the audience sends — and is absent on everything else.
        // See shared/slide-types/runtime.js.
        runtime: slideRuntime(def) || undefined,
        interaction: slideLiveInteraction(def) || undefined,
        // The tier ladder and the `fallback` facet. `tier` is derived from the
        // name (1 = core profile, 2 = Deckyard set, 3 = extension), so a fork
        // type under a new name reads as 3 here without declaring anything.
        // `fallback` is the tier-1 contract a reader that implements only the
        // core profile should use for this type — on the wire for the same seam
        // reason the authoring companions are: a fork type declaring its own
        // fallback is only heard if the value travels. See
        // shared/slide-types/tiers.js.
        tier: slideTypeTier(key),
        fallback: slideFallback(def) || undefined,
        themeId:
          typeof def.themeId === 'string' && def.themeId.trim()
            ? def.themeId.trim()
            : undefined,
        defaultsByLang:
          def.defaultsByLang && typeof def.defaultsByLang === 'object'
            ? def.defaultsByLang
            : undefined,
        // Inline-edit descriptor declared on the definition itself: the
        // extension seam for custom slide types (custom/slide-types/*.js).
        // The client's descriptor registry falls back to this when it has no
        // core entry for the type. JSON-only (no function-valued options).
        inline:
          def.inline && typeof def.inline === 'object'
            ? def.inline
            : undefined,
        // The descriptor's counterpart: which fields the settings inspector
        // keeps rendering once the canvas covers the rest. Resolved, and on the
        // wire for the same reason `schematic` is — the editor holds this
        // response, not the registry, so a fork type declaring its own
        // `inspectorKeeps` would otherwise never be heard. Absent (rather than
        // `[]`) when nobody narrows the type: the inspector's conservative
        // fallback depends on telling those two apart.
        inspectorKeeps: slideTypeInspectorKeeps(key, def) || undefined,
        // Layout catalogue for the editor's layout switcher. Declared on the
        // definition (JSON-safe) so forks that override a type by name bring
        // their own variant set; absent = no switcher chip.
        layoutVariants: Array.isArray(def.layoutVariants)
          ? def.layoutVariants
          : undefined,
        // Which content field names the slide in the slide list. Same seam
        // half as `inspectorKeeps` — the editor holds this response, not the
        // registry, so a fork type declaring its own labelField is only heard
        // if the value travels.
        labelField:
          typeof def.labelField === 'string' && def.labelField.trim()
            ? def.labelField.trim()
            : undefined,
        // The ImageRef config anchor: what an image WITHOUT its own fit/bleed
        // follows. Same seam half as `inspectorKeeps` — the editor holds this
        // response, not the registry, so the `image-fit` widget's derived
        // "Default · …" label can only name the right value if the anchor
        // travels. Until this landed the widget silently assumed `cover`, which
        // was right for every core type and would have been wrong for the first
        // fork type that said otherwise.
        imageDefaults:
          def.imageDefaults && typeof def.imageDefaults === 'object'
            ? def.imageDefaults
            : undefined,
        // Which enum field mirrors the layout (image left/right); drives the
        // switcher's mirror toggle. Same fork story as layoutVariants.
        layoutMirror:
          def.layoutMirror && typeof def.layoutMirror === 'object'
            ? def.layoutMirror
            : undefined,
        // Which enum field sets the text-column count (and for which layout
        // values it applies); drives the switcher's second toggle. Same fork
        // story as layoutMirror.
        layoutTextColumns:
          def.layoutTextColumns && typeof def.layoutTextColumns === 'object'
            ? def.layoutTextColumns
            : undefined,
        // The three authoring companions, resolved. This is the wire half of
        // the aggregator-seam rule: the editor does not hold the registry, it
        // holds this response, so a companion it looks up "on the definition
        // first" can only be found if the definition it holds carries it. Until
        // this landed, a type in custom/slide-types/ could declare `schematic`
        // or `sampleContent` and no browser consumer would ever see it — the
        // fallback branch existed on both sides of a wire that dropped the key.
        //
        // Resolved rather than raw (core's answer comes from the authoring
        // aggregator, which lives beside the type directories) so one response
        // states the whole truth about a type. That costs ~8 KB across all
        // types on a request the editor makes once per deck, which is why the
        // rule needs no core exception.
        group: slideTypeGroup(key, def) || undefined,
        schematic: slideTypeSchematic(key, def) || undefined,
        sampleContent: slideTypeSample(key, def),
        // The picker's tile tooltip and its search haystack. Same seam half as
        // the three above: the editor reads them off this response, so a fork
        // type's copy only reaches it if the resolved value travels here.
        description: slideTypeDescription(key, def) || undefined,
        aliases: slideTypeAliases(key, def) || undefined,
      };
    }

    // Published custom types from the database (per-org). A builder-UI
    // type has no `group` to declare yet (there is no column for it), so it
    // lands on the picker's "Custom" shelf — the fallback for a type that
    // declares nothing, not a rule about where custom types belong.
    try {
      const ctx = createRouteContext(authedUser);
      const customTypes = await listPublishedCustomSlideTypes(ctx);
      for (const ct of customTypes) {
        // Use "custom-<slug>" as the type key to avoid collisions with core types
        const typeKey = `custom-${ct.slug}`;
        meta[typeKey] = {
          label: ct.label,
          fields: ct.fields,
          defaults: ct.defaults,
          defaultsByLang: ct.defaultsByLang || undefined,
          baseType: ct.baseType || undefined,
          isCustom: true,
          customId: ct.id,
          // Always tier 3: an org type is declared by the org, and we promise
          // nothing about it. It carries no `fallback` because there is no
          // column for one yet — the unknown-type render contract covers it.
          tier: SLIDE_TIER.EXTENSION,
          css: ct.css || undefined,
          hasTemplate: Boolean(ct.template),
        };
      }
    } catch {
      // Custom types are additive; if loading fails, core types still work.
    }

    serveJson(res, 200, meta);
    return true;
  }
  return false;
}
