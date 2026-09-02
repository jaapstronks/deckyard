/**
 * Translated copy for a rejected field definition.
 *
 * The rules and the located problem come from
 * `shared/slide-types/custom-field-definitions.js`, which the server runs too;
 * this module is only the UI's voice for them. `describeFieldProblem` is the
 * fallback, so a reason added there without copy here still says something true
 * rather than nothing.
 */

import { t } from '../../../lib/ui-i18n.js';
import {
  CUSTOM_TYPE_FIELD_TYPES,
  MAX_CUSTOM_TYPE_FIELDS,
  describeFieldProblem,
} from '../../../../shared/slide-types/custom-field-definitions.js';

/** reason -> [translation key, English fallback]. Keep in step with the module above. */
const REASON_COPY = {
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
};

/**
 * The sentence to show for a field-definition problem.
 * @param {import('../../../../shared/slide-types/custom-field-definitions.js').FieldDefinitionProblem} problem
 * @returns {string}
 */
export function fieldProblemMessage(problem) {
  const entry = REASON_COPY[problem?.reason];
  if (!entry) return describeFieldProblem(problem);
  return t(entry[0], entry[1], {
    where: problem.where || '',
    max: MAX_CUSTOM_TYPE_FIELDS,
    types: CUSTOM_TYPE_FIELD_TYPES.join(', '),
  });
}
