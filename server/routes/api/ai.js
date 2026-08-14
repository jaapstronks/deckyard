import { dispatchRoutes } from '../../utils/router.js';
import { withErrorHandler } from '../../utils/http.js';
import { handleAiVendors } from './ai/vendors.js';
import { handleAiWizard } from './ai/wizard.js';
import { handleAiWizardV2 } from './ai/wizard-v2.js';
import { handleAiWizardV2Outline } from './ai/wizard-v2-outline.js';
import { handleAiWizardV2Stream } from './ai/wizard-v2-stream.js';
import { handleAiAppendSlides } from './ai/append-slides.js';
import { handleAiRefineSection } from './ai/refine-section.js';
import { handleAiConvertSlide } from './ai/convert-slide.js';
import { handleAiCompressDeck } from './ai/compress-deck.js';
import { handleAiIterate } from './ai/iterate.js';

/**
 * Declarative route table for `/api/ai/*`, dispatched through the shared
 * {@link dispatchRoutes}. All patterns are exact strings, so order is not
 * significant (unlike the presentations dispatcher). Each handler owns its
 * request parsing, AI orchestration and persistence.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
const ROUTES = [
  { method: 'GET', pattern: '/api/ai/vendors', handler: handleAiVendors },
  { method: 'POST', pattern: '/api/ai/wizard', handler: handleAiWizard },
  { method: 'POST', pattern: '/api/ai/wizard-v2', handler: handleAiWizardV2 },
  { method: 'POST', pattern: '/api/ai/wizard-v2/outline', handler: handleAiWizardV2Outline },
  { method: 'POST', pattern: '/api/ai/wizard-v2/stream', handler: handleAiWizardV2Stream },
  { method: 'POST', pattern: '/api/ai/append-slides', handler: handleAiAppendSlides },
  { method: 'POST', pattern: '/api/ai/refine-section', handler: handleAiRefineSection },
  { method: 'POST', pattern: '/api/ai/convert-slide', handler: handleAiConvertSlide },
  { method: 'POST', pattern: '/api/ai/compress-deck', handler: handleAiCompressDeck },
  { method: 'POST', pattern: '/api/ai/iterate', handler: handleAiIterate },
];

/**
 * Dispatch `/api/ai/*` requests to the matching handler.
 * @param {import('./ai/shared.js').AiContext} ctx
 * @returns {Promise<boolean>} true if a route handled the request.
 */
export const handleAi = withErrorHandler('ai', (ctx) =>
  dispatchRoutes(ROUTES, ctx)
);
