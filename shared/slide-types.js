// Canonical slide type exports (thin re-export layer).
//
// This repository historically had an inlined/monolithic `shared/slide-types.js`.
// The current implementation lives in `shared/slide-types/*` and must be the
// single source of truth so new slide types (like `follow-invite-slide`) are
// recognized consistently across server + client (rendering, validation, editor).

export {
  SLIDE_TYPES,
  THEMES,
  GLOBAL_SLIDE_FIELD_KEYS,
  CUSTOM_SLIDE_TYPE_NAMES,
} from './slide-types/registry.js';

export {
  newPresentation,
  newSlide,
  renderSlideHtml,
  validatePresentation,
  validateSlide,
} from './slide-types/presentation.js';

export {
  presentationToDeck,
  deckToPresentationParts,
} from './slide-types/deck.js';

export {
  getLayoutVariants,
  activeLayoutVariantId,
  applyLayoutVariant,
} from './slide-types/layout-variants.js';

export {
  getConvertibleSlideTypes,
  convertSlideToType,
  getConversionLossyKeys,
} from './slide-types/convert.js';
