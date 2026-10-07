/**
 * Per-field block-level text styling: what a slide type OFFERS, and the
 * `content.textStyles` map that stores the author's choices (B464, D220, D221,
 * D241). The normative description is docs/reference/text-styles.md.
 *
 * ## Nothing by default (D220)
 *
 * A text field offers no style control unless its type declares one. The
 * offer sits where the structure decides the scope, so a type never has to say
 * "not per instance" field by field:
 *
 *   fields: [
 *     // a standalone field: this field, on its own
 *     { key: 'body', type: 'markdown', textStyle: ['align', 'size'] },
 *     // an array: every instance of the item field at once
 *     { key: 'quotes', type: 'items', itemTextStyle: { quote: ['size'] },
 *       itemFields: [{ key: 'quote', type: 'string' }, …] },
 *   ],
 *   // a fixed set of siblings without an array, styled as one
 *   textStyleSets: [
 *     { id: 'column-titles', fields: ['leftTitle', 'rightTitle'],
 *       textStyle: ['align'] },
 *   ],
 *
 * The vocabulary is `align` and `size` (D221 removed `color`, and with it the
 * theme's `textSwatches`). Declaring `size` is a promise the type's CSS keeps:
 * the field's `font-size` reads `--tf-size-scale`.
 *
 * ## Storage: one key per offer
 *
 *   content.textStyles = {
 *     body: { align: 'center', size: 'lg' },   // standalone field
 *     'quotes.*.quote': { size: 'sm' },         // every instance of an item field
 *     'rows.*.blocks.*.title': { … },           // nested: every block of every row
 *     '@column-titles': { align: 'center' },    // a declared sibling set
 *   }
 *
 * A key the type does not offer, a per-instance key (`members.3.name`, or a
 * set member on its own), any `color`, and any property or value outside the
 * offer are refused on the write path ({@link textStyleRefusals}); the schema
 * step folds stored decks into this shape once (schema-version.js, v17 -> v18).
 *
 * ## Rendering
 *
 * A single string post-pass ({@link injectTextStyles}) inside the shared
 * `renderSlideHtml`, so the editor canvas, present mode and exports stay
 * identical. It adds the `tf-*` classes (`03-components/97-text-styles.css`)
 * to every element whose `data-inline-field` the key covers.
 *
 * Text SIZE is not an `em` multiplier (that would replace the px sizes types
 * set with a fraction of the parent's). `tf-size-sm/lg` set `--tf-size-scale`
 * on the element, and each offering field's `font-size` is
 * `calc(<base> * var(--tf-size-scale, 1))`. `md` is the default and emits
 * nothing.
 */

import { fieldAllowedAlignValues, fieldDefaultAlign } from './text-roles.js';
import { resolveFieldDef } from './field-lookup.js';
import { fieldGroupId } from './field-groups.js';

/** The style properties a type may offer (D221: no `color`). */
export const TEXT_STYLE_PROPS = ['align', 'size'];
/** Alignment vocabulary; the field's own default stores nothing. */
export const TEXT_ALIGN_VALUES = ['left', 'center', 'right'];
/** Size vocabulary (relative scale); `md` is the default (no override). */
export const TEXT_SIZE_VALUES = ['sm', 'md', 'lg'];
const DEFAULT_SIZE = 'md';

/** The prefix that marks a sibling-set key: `@<set id>`. */
export const TEXT_STYLE_SET_PREFIX = '@';
/** The segment that stands for every index of an array in a key. */
const EVERY = '*';

/**
 * @typedef {object} TextStyleOffer
 * @property {string} key - the storage key (`body`, `quotes.*.quote`, `@id`)
 * @property {'field'|'items'|'set'} scope
 * @property {string[]} props - the offered properties, in vocabulary order
 * @property {string} sample - a concrete field key standing for the offer,
 *   whose role and default alignment apply to every member (`quotes.0.quote`)
 * @property {string[]} [members] - a set's field keys
 */

/** True for a plain (non-array) object. */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Offered properties in vocabulary order; anything else dropped. */
function offeredProps(list) {
  if (!Array.isArray(list)) return [];
  return TEXT_STYLE_PROPS.filter((p) => list.includes(p));
}

/**
 * Walk a `fields[]` level and collect the field and item offers, descending
 * into nested arrays so `rows.*.blocks.*.title` is reachable.
 * @param {Array<Object>} fields
 * @param {string} prefix - the key prefix of this level (`''`, `rows.*.`)
 * @param {TextStyleOffer[]} out
 */
function collectFieldOffers(fields, prefix, out) {
  if (!Array.isArray(fields)) return;
  for (const field of fields) {
    if (!field || typeof field.key !== 'string' || !field.key) continue;
    const path = `${prefix}${field.key}`;
    // A standalone offer counts only at the top level: an item field is never
    // styled per instance, so its offer lives on the array (`itemTextStyle`).
    const own = prefix ? [] : offeredProps(field.textStyle);
    if (own.length) {
      out.push({ key: path, scope: 'field', props: own, sample: path });
    }
    if (Array.isArray(field.itemFields)) {
      const itemPrefix = `${path}.${EVERY}.`;
      if (isPlainObject(field.itemTextStyle)) {
        for (const [itemKey, list] of Object.entries(field.itemTextStyle)) {
          const props = offeredProps(list);
          if (!props.length) continue;
          const key = `${itemPrefix}${itemKey}`;
          out.push({
            key,
            scope: 'items',
            props,
            sample: key
              .split('.')
              .map((p) => (p === EVERY ? '0' : p))
              .join('.'),
          });
        }
      }
      collectFieldOffers(field.itemFields, itemPrefix, out);
    }
  }
}

const OFFERS_CACHE = new WeakMap();

/**
 * Every text-style offer a slide type declares, keyed by storage key. Cached
 * per definition object; a definition is not mutated after registration.
 * @param {Object|null|undefined} def - a slide type definition
 * @returns {Map<string, TextStyleOffer>}
 */
export function textStyleOffers(def) {
  if (!def || typeof def !== 'object') return new Map();
  const cached = OFFERS_CACHE.get(def);
  if (cached) return cached;
  const list = [];
  collectFieldOffers(def.fields, '', list);
  for (const set of Array.isArray(def.textStyleSets) ? def.textStyleSets : []) {
    const props = offeredProps(set?.textStyle);
    const members = Array.isArray(set?.fields)
      ? set.fields.filter((k) => typeof k === 'string' && k)
      : [];
    if (!set?.id || !props.length || !members.length) continue;
    list.push({
      key: `${TEXT_STYLE_SET_PREFIX}${set.id}`,
      scope: 'set',
      props,
      sample: members[0],
      members,
    });
  }
  const map = new Map(list.map((o) => [o.key, o]));
  OFFERS_CACHE.set(def, map);
  return map;
}

/**
 * `members.3.name` -> `members.*.name`: the key every instance shares.
 * @param {string} fieldKey
 * @returns {string}
 */
function everyInstanceKey(fieldKey) {
  return String(fieldKey)
    .split('.')
    .map((p) => (/^\d+$/.test(p) ? EVERY : p))
    .join('.');
}

/**
 * The offer that covers one rendered field (`data-inline-field`), or null when
 * the field offers nothing. This is what the inspector reads: a click on any
 * of six item titles answers with the one offer that styles all six.
 * @param {Object|null|undefined} def
 * @param {string} fieldKey - e.g. `body`, `quotes.2.quote`, `leftTitle`
 * @returns {TextStyleOffer|null}
 */
export function textStyleOfferFor(def, fieldKey) {
  if (!fieldKey) return null;
  const offers = textStyleOffers(def);
  const direct = offers.get(everyInstanceKey(fieldKey));
  if (direct && direct.scope !== 'set') return direct;
  for (const offer of offers.values()) {
    if (offer.scope === 'set' && offer.members.includes(fieldKey)) return offer;
  }
  return null;
}

/**
 * The alignment values an offer may store, and its default. Empty when the
 * offer has no `align`, or when the field's role or group owns alignment (the
 * definition check refuses that declaration; this keeps the renderer safe for
 * a definition that skipped it).
 * @param {Object} def
 * @param {TextStyleOffer} offer
 * @returns {{values: string[], defaultAlign: string}}
 */
export function offerAlign(def, offer) {
  const defaultAlign = fieldDefaultAlign(def, offer.sample);
  if (!offer.props.includes('align')) return { values: [], defaultAlign };
  return { values: fieldAllowedAlignValues(def, offer.sample), defaultAlign };
}

/**
 * Normalize a raw `textStyles` map against what the type offers: keep only
 * offered keys, offered properties and known values, and drop defaults, so
 * stored JSON never carries a no-op (a click-in-click-out leaves the deck
 * unchanged). The fold for content that predates the model is the schema
 * step's job; this is the reader every render and the editor share.
 * Returns a fresh object; input is not mutated.
 * @param {unknown} raw
 * @param {Object|null} def - the slide type definition
 * @returns {Record<string, {align?: string, size?: string}>}
 */
export function normalizeTextStyles(raw, def) {
  if (!isPlainObject(raw)) return {};
  const offers = textStyleOffers(def);
  const out = {};
  for (const [key, style] of Object.entries(raw)) {
    const offer = offers.get(key);
    if (!offer || !isPlainObject(style)) continue;
    const clean = {};
    const align = offerAlign(def, offer);
    if (
      align.values.includes(style.align) &&
      style.align !== align.defaultAlign
    ) {
      clean.align = style.align;
    }
    if (
      offer.props.includes('size') &&
      TEXT_SIZE_VALUES.includes(style.size) &&
      style.size !== DEFAULT_SIZE
    ) {
      clean.size = style.size;
    }
    if (Object.keys(clean).length) out[key] = clean;
  }
  return out;
}

/**
 * @typedef {object} TextStyleRefusal
 * @property {string} key - the stored key the refusal is about (`''` for the
 *   map itself)
 * @property {string} reason - a snake_case sub-code:
 *   `text_style_malformed`, `text_style_per_instance`,
 *   `text_style_not_offered`, `text_style_property_not_offered`,
 *   `text_style_value_not_offered`
 * @property {string} message - the English sentence, naming the key and why
 */

/**
 * Why a key is not one this type offers: per instance (a concrete index, or
 * one member of a set) or simply not offered.
 * @param {Object} def
 * @param {string} key
 * @returns {TextStyleRefusal}
 */
function refuseKey(def, key) {
  const offer = textStyleOfferFor(def, key);
  if (offer && offer.key !== key) {
    return {
      key,
      reason: 'text_style_per_instance',
      message:
        `textStyles key ${JSON.stringify(key)} styles one instance of a field ` +
        `that has siblings; style them together under ` +
        `${JSON.stringify(offer.key)}`,
    };
  }
  return {
    key,
    reason: 'text_style_not_offered',
    message:
      `textStyles key ${JSON.stringify(key)} is not offered by this slide ` +
      `type; it offers ${describeKeys(def)}`,
  };
}

/** The offered keys as a phrase, for a refusal message. */
function describeKeys(def) {
  const keys = [...textStyleOffers(def).keys()];
  return keys.length
    ? keys.map((k) => JSON.stringify(k)).join(', ')
    : 'no text styling';
}

/**
 * Everything wrong with a stored `textStyles` map, measured against what the
 * type offers. Empty for a valid map, and for an absent one. The write path
 * turns the first refusal into a 400 (`server/storage/presentations/slides.js`).
 *
 * A default value (`size: 'md'`, the field's own alignment) is valid: it is a
 * no-op the normaliser drops, not a request for something not offered.
 * @param {unknown} raw - `content.textStyles`
 * @param {Object} def - the slide type definition
 * @returns {TextStyleRefusal[]}
 */
export function textStyleRefusals(raw, def) {
  if (raw === undefined || raw === null) return [];
  if (!isPlainObject(raw)) {
    return [
      {
        key: '',
        reason: 'text_style_malformed',
        message: 'textStyles must be an object keyed by an offered style key',
      },
    ];
  }
  const offers = textStyleOffers(def);
  const out = [];
  for (const [key, style] of Object.entries(raw)) {
    const offer = offers.get(key);
    if (!offer) {
      out.push(refuseKey(def, key));
      continue;
    }
    if (!isPlainObject(style)) {
      out.push({
        key,
        reason: 'text_style_malformed',
        message: `textStyles ${JSON.stringify(key)} must be an object`,
      });
      continue;
    }
    for (const [prop, value] of Object.entries(style)) {
      if (!offer.props.includes(prop)) {
        out.push({
          key,
          reason: 'text_style_property_not_offered',
          message:
            prop === 'color'
              ? `textStyles ${JSON.stringify(key)}: per-field text colour ` +
                `was removed; the slide background decides text colour`
              : `textStyles ${JSON.stringify(key)} does not offer ` +
                `${JSON.stringify(prop)}; it offers ${offer.props.join(', ')}`,
        });
        continue;
      }
      const allowed =
        prop === 'align'
          ? [
              ...new Set([
                ...offerAlign(def, offer).values,
                offerAlign(def, offer).defaultAlign,
              ]),
            ]
          : TEXT_SIZE_VALUES;
      if (!allowed.includes(value)) {
        out.push({
          key,
          reason: 'text_style_value_not_offered',
          message:
            `textStyles ${JSON.stringify(key)}.${prop} ` +
            `${JSON.stringify(value)} is not offered; use one of ` +
            `${allowed.join(', ')}`,
        });
      }
    }
  }
  return out;
}

/**
 * The CSS classes for one stored style, or '' when it is all defaults.
 * @param {{align?: string, size?: string}} style - a normalized style
 * @returns {string}
 */
function textStyleClasses(style) {
  const classes = [];
  if (style.align) classes.push(`tf-align-${style.align}`);
  if (style.size) classes.push(`tf-size-${style.size}`);
  return classes.join(' ');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `data-inline-field` values a storage key covers, as a regex source:
 * `*` matches any index, a set key each of its members.
 * @param {TextStyleOffer} offer
 * @returns {string}
 */
function fieldPattern(offer) {
  if (offer.scope === 'set') {
    return `(?:${offer.members.map(escapeRegExp).join('|')})`;
  }
  return offer.key
    .split('.')
    .map((p) => (p === EVERY ? '\\d+' : escapeRegExp(p)))
    .join('\\.');
}

/**
 * String post-pass: add the `tf-*` classes to every element a stored style
 * covers. Regex-based (like `injectSlideBackground`) so it runs identically on
 * the server and in the browser without a DOM. Matches the opening tag
 * carrying `data-inline-field="<covered key>"` and merges the classes into its
 * class attribute (or adds one). A key the type does not offer emits nothing.
 * @param {string} html - rendered slide HTML
 * @param {Object} content - slide content (reads `content.textStyles`)
 * @param {Object|null} def - the slide type definition
 * @returns {string}
 */
export function injectTextStyles(html, content, def) {
  const styles = normalizeTextStyles(content?.textStyles, def);
  const keys = Object.keys(styles);
  if (!keys.length || typeof html !== 'string') return html;
  const offers = textStyleOffers(def);
  let out = html;
  for (const key of keys) {
    const cls = textStyleClasses(styles[key]);
    if (!cls) continue;
    // The `"` after the pattern anchors the match, so `subheading` never
    // matches `subheading2`; `data-morph-role="body"` never matches field
    // `body`.
    const tagRe = new RegExp(
      `<([a-zA-Z][\\w-]*)\\b([^>]*\\bdata-inline-field="${fieldPattern(offers.get(key))}"[^>]*)>`,
      'g',
    );
    out = out.replace(tagRe, (_m, tag, attrs) => {
      if (/\sclass="/.test(attrs)) {
        const merged = attrs.replace(
          /(\sclass=")([^"]*)(")/,
          (_mm, a, existing, b) => `${a}${existing} ${cls}${b}`,
        );
        return `<${tag}${merged}>`;
      }
      return `<${tag} class="${cls}"${attrs}>`;
    });
  }
  return out;
}

/**
 * Fold a stored `textStyles` map into the offer model (the v17 -> v18 schema
 * step, B464). Drops every `color`; folds per-instance keys (`quotes.2.quote`,
 * a set member on its own) into the shared key when every stored instance
 * agrees on a property, and drops the property where they disagree; drops what
 * the type does not offer. A no-op on a map the current writers produce.
 *
 * "Every instance agrees" counts only the instances that stored the property:
 * the others rendered at the default, so folding would change them. That is
 * why a property is kept only when the stored instances cover the whole set -
 * otherwise the fold would restyle instances the author never touched.
 *
 * @param {unknown} raw
 * @param {Object|null} def - the slide type definition (null = type unknown
 *   here: only `color` goes, everything else is left for the type to read)
 * @param {Object} content - the slide content, to count array instances
 * @returns {Record<string, Object>|undefined} the folded map, or undefined
 *   when nothing is left
 */
export function foldTextStylesToOffers(raw, def, content) {
  if (!isPlainObject(raw)) return undefined;
  const withoutColor = {};
  for (const [key, style] of Object.entries(raw)) {
    if (!isPlainObject(style)) continue;
    const { color: _color, ...rest } = style;
    if (Object.keys(rest).length) withoutColor[key] = rest;
  }
  if (!def) {
    return Object.keys(withoutColor).length ? withoutColor : undefined;
  }
  const offers = textStyleOffers(def);
  // Gather per offer: the shared key's own style, and per-instance styles.
  const gathered = new Map();
  for (const [key, style] of Object.entries(withoutColor)) {
    const offer = offers.get(key) || textStyleOfferFor(def, key);
    if (!offer) continue;
    const entry = gathered.get(offer.key) || { own: null, instances: [] };
    if (offer.key === key) entry.own = style;
    else entry.instances.push(style);
    gathered.set(offer.key, entry);
  }
  const folded = {};
  for (const [key, { own, instances }] of gathered) {
    const offer = offers.get(key);
    const style = { ...(own || {}) };
    const total = instanceCount(offer, content);
    for (const prop of offer.props) {
      if (style[prop] !== undefined || !instances.length) continue;
      const values = instances.map((s) => s[prop]);
      if (
        values.length === total &&
        values.every((v) => v !== undefined && v === values[0])
      ) {
        style[prop] = values[0];
      }
    }
    folded[key] = style;
  }
  const out = normalizeTextStyles(folded, def);
  return Object.keys(out).length ? out : undefined;
}

/**
 * How many rendered instances an offer covers on this slide: a set's members,
 * or the items of the array (nested arrays summed). A standalone field is one.
 * @param {TextStyleOffer} offer
 * @param {Object} content
 * @returns {number}
 */
export function instanceCount(offer, content) {
  if (offer.scope === 'set') return offer.members.length;
  if (offer.scope === 'field') return 1;
  const parts = offer.key.split('.');
  const count = (value, i) => {
    if (i >= parts.length - 1) return 1;
    const part = parts[i];
    if (part === EVERY) {
      return Array.isArray(value)
        ? value.reduce((n, item) => n + count(item, i + 1), 0)
        : 0;
    }
    return count(value?.[part], i + 1);
  };
  return count(content, 0);
}

/**
 * Definition check for the three declarations, run by
 * `validateSlideTypeDefinition`. Returns error strings (a malformed offer
 * would show a control without an effect, or style one instance of many).
 * @param {Object} def
 * @param {string} who - the type name, for the message
 * @returns {string[]}
 */
export function checkTextStyleDeclarations(def, who) {
  const errors = [];
  const fields = Array.isArray(def?.fields) ? def.fields : [];
  const isText = (f) => ['string', 'markdown'].includes(f?.type);
  const checkProps = (list, where) => {
    if (
      !Array.isArray(list) ||
      !list.length ||
      list.some((p) => !TEXT_STYLE_PROPS.includes(p))
    ) {
      errors.push(
        `${where} must be a non-empty list of ${TEXT_STYLE_PROPS.join(', ')} ` +
          `(per-field colour was removed, D221)`,
      );
      return false;
    }
    return true;
  };
  const checkAlign = (list, sampleKey, where) => {
    if (!list.includes('align')) return;
    if (fieldGroupId(fields, sampleKey)) {
      errors.push(
        `${where} offers \`align\`, but the field belongs to a field group, ` +
          `which owns its alignment`,
      );
    } else if (!fieldAllowedAlignValues(def, sampleKey).length) {
      errors.push(
        `${where} offers \`align\`, but the field's role never aligns`,
      );
    }
  };
  const walk = (list, prefix, depth) => {
    for (const field of Array.isArray(list) ? list : []) {
      if (!field?.key) continue;
      const where = `${who}.fields.${prefix}${field.key}`;
      if (field.textStyle !== undefined) {
        if (depth > 0) {
          errors.push(
            `${where} declares \`textStyle\` on an item field; an item field ` +
              `is styled as a set, so declare \`itemTextStyle\` on its array`,
          );
        } else if (!isText(field)) {
          errors.push(`${where} declares \`textStyle\` on a non-text field`);
        } else if (checkProps(field.textStyle, `${where}.textStyle`)) {
          checkAlign(field.textStyle, field.key, where);
        }
      }
      if (field.itemTextStyle !== undefined) {
        const items = Array.isArray(field.itemFields) ? field.itemFields : null;
        if (!items || !isPlainObject(field.itemTextStyle)) {
          errors.push(
            `${where}.itemTextStyle must be an object on an array field, ` +
              `keyed by item field`,
          );
        } else {
          for (const [itemKey, props] of Object.entries(field.itemTextStyle)) {
            const sub = items.find((f) => f?.key === itemKey);
            const at = `${where}.itemTextStyle.${itemKey}`;
            if (!isText(sub)) {
              errors.push(`${at} does not name a text item field`);
              continue;
            }
            const sample = `${prefix.replace(/\*/g, '0')}${field.key}.0.${itemKey}`;
            if (checkProps(props, at)) checkAlign(props, sample, at);
          }
        }
      }
      if (Array.isArray(field.itemFields)) {
        walk(field.itemFields, `${prefix}${field.key}.*.`, depth + 1);
      }
    }
  };
  walk(fields, '', 0);

  if (def?.textStyleSets !== undefined) {
    if (!Array.isArray(def.textStyleSets)) {
      errors.push(`${who}.textStyleSets must be an array`);
      return errors;
    }
    const seenIds = new Set();
    const seenMembers = new Set();
    for (const [i, set] of def.textStyleSets.entries()) {
      const where = `${who}.textStyleSets[${i}]`;
      if (!set?.id || typeof set.id !== 'string' || seenIds.has(set.id)) {
        errors.push(`${where} needs a unique string \`id\``);
        continue;
      }
      seenIds.add(set.id);
      const members = Array.isArray(set.fields) ? set.fields : [];
      if (members.length < 2) {
        errors.push(`${where} must name at least two sibling fields`);
        continue;
      }
      for (const key of members) {
        const field = resolveFieldDef(fields, key);
        if (!fields.includes(field) || !isText(field)) {
          errors.push(
            `${where} names ${JSON.stringify(key)}, not a top-level text field`,
          );
        } else if (field.textStyle !== undefined) {
          errors.push(
            `${where} names ${JSON.stringify(key)}, which also declares its ` +
              `own \`textStyle\`; a field with siblings is styled as a set only`,
          );
        } else if (seenMembers.has(key)) {
          errors.push(
            `${where} names ${JSON.stringify(key)}, already in another set`,
          );
        }
        seenMembers.add(key);
      }
      if (checkProps(set.textStyle, `${where}.textStyle`)) {
        checkAlign(set.textStyle, members[0], where);
      }
    }
  }
  return errors;
}
