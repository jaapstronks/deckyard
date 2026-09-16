/**
 * The slide types a `.deck` bundle carries (D91) — both directions.
 *
 * A type built in Settings > Slide Types is an organization record: slug,
 * label, fields, defaults, a template in the restricted template language and
 * some CSS (server/storage/custom-slide-types.js). A slide stores it under
 * `custom-<slug>`, and that slug names nothing on another instance, so the
 * bundle carries each type the deck uses as `slide-types/<slug>.json`: the
 * fields a type is created from, without ids, organization, publication state,
 * order or authorship.
 *
 * A file-JS type (core, or a fork's `custom/slide-types/`) is code, not a
 * record: it ships with the install and travels by the type id already on the
 * slide. The same fork resolves it; any other install imports the placeholder.
 *
 * On the receiving side a carried type is recognised by its content, not its
 * slug — the same {@link definitionContentHash} a carried theme uses, over the
 * organization's published types, which are the ones a slide can resolve to.
 */

import {
  createCustomSlideType,
  listPublishedCustomSlideTypes,
} from '../storage/custom-slide-types.js';
import { customSlideTypeKey } from '../../shared/slide-types/custom-type-runtime.js';
import {
  definitionContentHash,
  installUnderFreeSlug,
  withBundleRefs,
} from './deck-install.js';

/** The archive folder the carried types live in. */
const SLIDE_TYPES_DIR = 'slide-types';

/**
 * Where one carried type lives inside the archive. The one spelling a reader
 * accepts for a manifest entry, so the entry and the file cannot disagree.
 * @param {string} slug
 * @returns {string}
 */
export function slideTypeEntryRef(slug) {
  return `${SLIDE_TYPES_DIR}/${slug}.json`;
}

/**
 * The installable form of a custom slide type record: exactly the fields
 * `createCustomSlideType` takes, nothing that belongs to the instance.
 *
 * @param {Object} record - a formatted record (storage/custom-slide-types.js)
 * @returns {{slug: string, label: string, baseType: string|null, fields: Object[], defaults: Object, defaultsByLang: Object|null, template: string|null, css: string|null, usage: string|null}}
 */
export function portableSlideTypeRecord(record) {
  return {
    slug: String(record?.slug || ''),
    label: String(record?.label || ''),
    baseType: record?.baseType || null,
    fields: Array.isArray(record?.fields) ? record.fields : [],
    defaults: record?.defaults || {},
    defaultsByLang: record?.defaultsByLang || null,
    template: record?.template || null,
    css: record?.css || null,
    usage: record?.usage || null,
  };
}

/**
 * The organization's published custom types a portable deck uses, in the order
 * the deck first uses them.
 *
 * The organization id comes from the presentation being exported, which the
 * route already authorized.
 * @param {string|null|undefined} organizationId - the deck's organization
 * @param {{slides?: Array<{type?: string}>}} deck - the portable deck
 * @returns {Promise<Object[]>} the records
 */
export async function loadBundleableSlideTypes(organizationId, deck) {
  const used = [];
  for (const slide of Array.isArray(deck?.slides) ? deck.slides : []) {
    const type = typeof slide?.type === 'string' ? slide.type : '';
    if (type.startsWith('custom-') && !used.includes(type)) used.push(type);
  }
  if (!used.length || !organizationId) return [];
  const byKey = new Map(
    (await listPublishedCustomSlideTypes({ organizationId })).map((ct) => [
      customSlideTypeKey(ct),
      ct,
    ]),
  );
  return used.map((key) => byKey.get(key)).filter(Boolean);
}

/**
 * Decide what each carried type becomes on this instance (D91), before any
 * bytes are written. The same three outcomes as a carried theme:
 *
 * - **existing** — this organization already has a published type with exactly
 *   this content, whatever its slug: the deck's slides resolve to it. Nothing is
 *   installed, so nothing is asked of the importer.
 * - **install** — the importer may manage slide types and asked for it
 *   (`install=slideTypes`): the type is created, never over an existing one.
 * - **not-installed** — otherwise; the deck's slides of this type import as the
 *   placeholder, which says the definition is in the bundle.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {import('../storage/scope.js').StorageScope} opts.scope
 * @param {Object[]} opts.slideTypes - the bundle's carried types
 * @param {boolean} opts.install - `install=slideTypes` was asked
 * @param {boolean} opts.permitted - the importer may manage slide types
 * @returns {Promise<Array<{definition: Object, status: 'existing', record: Object} | {definition: Object, status: 'install'} | {definition: Object, status: 'not-installed', reason: 'install-not-requested'|'not-permitted'}>>}
 *   one entry per carried type, in bundle order
 */
export async function settleBundledSlideTypes({
  repoRoot,
  scope,
  slideTypes,
  install,
  permitted,
}) {
  if (!slideTypes.length) return [];
  const own = [];
  for (const record of await listPublishedCustomSlideTypes(scope)) {
    const hashable = await withBundleRefs(
      repoRoot,
      portableSlideTypeRecord(record),
    );
    own.push({ record, hash: definitionContentHash(hashable) });
  }

  return slideTypes.map((carried) => {
    const definition = portableSlideTypeRecord(carried);
    const hash = definitionContentHash(definition);
    const match = own.find((o) => o.hash === hash);
    if (match) return { definition, status: 'existing', record: match.record };
    if (install && permitted) return { definition, status: 'install' };
    return {
      definition,
      status: 'not-installed',
      reason: install ? 'not-permitted' : 'install-not-requested',
    };
  });
}

/**
 * Create a carried type, published, under the first free slug: its own, then
 * `-2`, `-3`, … An existing type is never overwritten.
 *
 * Published because the deck that carried it already uses it: a draft would
 * install a type its own slides cannot resolve to.
 *
 * @param {import('../storage/scope.js').StorageScope} scope
 * @param {Object} definition - the portable type, uploads already upload refs
 * @returns {Promise<{ok: true, customSlideType: Object} | {ok: false, reason: string, field?: string}>}
 *   the storage result of the last attempt
 */
export async function installBundledSlideType(scope, definition) {
  return installUnderFreeSlug(definition.slug, 'slide-type', (slug) =>
    createCustomSlideType(scope, { ...definition, slug }, { published: true }),
  );
}
