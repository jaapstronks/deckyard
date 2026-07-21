/**
 * Fixture standing in for a fork's `custom/ai/catalog.js`.
 * Exercises the loader's accept/ignore rules:
 *  - a partial override for a known core type      -> kept (only listed fields)
 *  - an unrecognised field on a kept entry          -> stripped
 *  - a non-object value                              -> ignored
 *  - an override for an unknown type name            -> ignored (when knownTypes given)
 */
export default {
  'content-slide': {
    description: 'FORK content description',
    bestFor: ['fork use'],
    somethingWeird: 'stripped',
  },
  'not-a-real-type': { description: 'nope' },
  'quote-slide': 'not-an-object',
};
