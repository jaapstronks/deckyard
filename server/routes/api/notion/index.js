/**
 * Notion API route handlers: the seam over `server/routes/api/notion/`.
 *
 * One declarative table dispatched through the shared {@link dispatchRoutes};
 * the concern modules underneath are reached only from here:
 * - `status.js` - Status/capability detection
 * - `fetch.js` - Fetch and publish endpoints
 * - `import.js` - Import and stream-import endpoints
 * - `subjects.js` - Subjects and compose endpoints (the wizard's picker)
 * - `suggest.js` - Suggest endpoint
 * - `utils.js` - Shared utility functions
 *
 * Whether the module exists is its mount's `feature: 'notion'`
 * (`NOTION_ENABLED`, `routes/api/index.js`): with it off all eight rows answer
 * the `/api` 404. Whether Notion is *configured* (`NOTION_SECRET`) is the
 * handlers' own `notionEnabled()` check, answered with a 501.
 */
import { dispatchRoutes } from '../../../utils/router.js';
import { withErrorHandler } from '../../../utils/http.js';
import { handleNotionStatus } from './status.js';
import { handleNotionFetch, handleNotionPublish } from './fetch.js';
import { handleNotionImport, handleNotionImportStream } from './import.js';
import { handleNotionSubjects, handleNotionCompose } from './subjects.js';
import { handleNotionSuggest } from './suggest.js';

/**
 * The Notion routes (A7.19 C8). The two import rows also carry
 * `feature: 'ai'`: an import runs the AI refinement pipeline
 * (`utils/convert-notion.js`), so with AI off it is not mounted either.
 * Subjects, compose and suggest only read Notion. Method mismatch falls
 * through (the chain had no 405).
 *
 * @type {import('../../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/notion/status', handler: handleNotionStatus },
  { method: 'POST', pattern: '/api/notion/fetch', handler: handleNotionFetch },
  {
    method: 'POST',
    pattern: '/api/notion/publish',
    handler: handleNotionPublish,
  },
  {
    method: 'POST',
    pattern: '/api/notion/import',
    handler: handleNotionImport,
    feature: 'ai',
  },
  {
    method: 'POST',
    pattern: '/api/notion/import/stream',
    handler: handleNotionImportStream,
    feature: 'ai',
  },
  {
    method: 'POST',
    pattern: '/api/notion/subjects',
    handler: handleNotionSubjects,
  },
  {
    method: 'POST',
    pattern: '/api/notion/compose',
    handler: handleNotionCompose,
  },
  {
    method: 'POST',
    pattern: '/api/notion/suggest',
    handler: handleNotionSuggest,
  },
];

/**
 * Handle Notion API requests.
 * @param {import('../../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} true if a route handled the request.
 */
export const handleNotion = withErrorHandler('notion', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
