/**
 * Translated copy for a rejected field definition.
 *
 * The rules and the located problem come from
 * `shared/slide-types/field-definitions.js`, the walk the server runs too;
 * this module is only the UI's voice for them. `describeFieldFinding` is the
 * fallback, so a code added there without copy here still says something true
 * rather than nothing.
 */

import { t } from '../../../lib/ui-i18n.js';
import {
  CUSTOM_TYPE_FIELD_TYPES,
  MAX_CUSTOM_TYPE_FIELDS,
} from '../../../../shared/slide-types/custom-field-definitions.js';
import { describeFieldFinding } from '../../../../shared/slide-types/field-definitions.js';

/** code -> [translation key, English fallback]. Keep in step with the shared walk. */
const CODE_COPY = {
  not_an_array: [
    'settings.slideTypes.fields.error.notAnArray',
    'The field list must be an array.',
  ],
  too_many: [
    'settings.slideTypes.fields.error.tooMany',
    'A slide type may have at most {max} fields.',
  ],
  not_an_object: [
    'settings.slideTypes.fields.error.notAnObject',
    '{where} is not a field definition.',
  ],
  missing_key: [
    'settings.slideTypes.fields.error.missingKey',
    '{where} has no key.',
  ],
  missing_label: [
    'settings.slideTypes.fields.error.missingLabel',
    '{where} has no label.',
  ],
  missing_type: [
    'settings.slideTypes.fields.error.missingType',
    '{where} has no type.',
  ],
  unknown_type: [
    'settings.slideTypes.fields.error.unknownType',
    '{where} has a type this builder does not offer — pick one of {types}.',
  ],
  duplicate_key: [
    'settings.slideTypes.fields.error.duplicateKey',
    '{where} reuses a key another field already has.',
  ],
  enum_without_options: [
    'settings.slideTypes.fields.error.enumWithoutOptions',
    '{where} is a dropdown with no options — add at least one.',
  ],
  items_without_item_fields: [
    'settings.slideTypes.fields.error.itemsWithoutItemFields',
    '{where} is a repeater with no item fields — add at least one, so something describes the shape of an item.',
  ],
  unknown_property: [
    'settings.slideTypes.fields.error.unknownProperty',
    '{where} declares “{property}”, which a stored field definition of this type cannot carry — remove it, or change the field type.',
  ],
};

/**
 * The sentence to show for a field-definition problem.
 * @param {import('../../../../shared/slide-types/field-definitions.js').FieldFinding} problem
 * @returns {string}
 */
export function fieldProblemMessage(problem) {
  const entry = CODE_COPY[problem?.code];
  if (!entry) return describeFieldFinding(problem);
  return t(entry[0], entry[1], {
    where: problem.name || '',
    max: MAX_CUSTOM_TYPE_FIELDS,
    types: CUSTOM_TYPE_FIELD_TYPES.join(', '),
    property: problem.detail?.property || '',
  });
}
