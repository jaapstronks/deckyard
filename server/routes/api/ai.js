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
 * A single declarative AI route: exact method + pathname → handler.
 *
 * @typedef {object} AiRoute
 * @property {string} method - HTTP method to require.
 * @property {string} path - Exact pathname to match.
 * @property {(ctx: import('./ai/shared.js').AiContext) => Promise<boolean>} handler
 */

/**
 * Declarative route table for `/api/ai/*`. All paths are exact strings, so
 * order is not significant (unlike the presentations dispatcher). Each handler
 * owns its request parsing, AI orchestration and persistence.
 *
 * @type {AiRoute[]}
 */
const ROUTES = [
  { method: 'GET', path: '/api/ai/vendors', handler: handleAiVendors },
  { method: 'POST', path: '/api/ai/wizard', handler: handleAiWizard },
  { method: 'POST', path: '/api/ai/wizard-v2', handler: handleAiWizardV2 },
  { method: 'POST', path: '/api/ai/wizard-v2/outline', handler: handleAiWizardV2Outline },
  { method: 'POST', path: '/api/ai/wizard-v2/stream', handler: handleAiWizardV2Stream },
  { method: 'POST', path: '/api/ai/append-slides', handler: handleAiAppendSlides },
  { method: 'POST', path: '/api/ai/refine-section', handler: handleAiRefineSection },
  { method: 'POST', path: '/api/ai/convert-slide', handler: handleAiConvertSlide },
  { method: 'POST', path: '/api/ai/compress-deck', handler: handleAiCompressDeck },
  { method: 'POST', path: '/api/ai/iterate', handler: handleAiIterate },
];

/**
 * Dispatch `/api/ai/*` requests to the matching handler.
 * @param {import('./ai/shared.js').AiContext} ctx
 * @returns {Promise<boolean>} true if a route handled the request.
 */
export async function handleAi(ctx) {
  const { req, url } = ctx;
  for (const route of ROUTES) {
    if (route.method === req.method && route.path === url.pathname) {
      return route.handler(ctx);
    }
  }
  return false;
}
