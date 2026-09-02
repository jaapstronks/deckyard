/**
 * The email-templates default-locale select rolls back to what the server
 * holds, not to what it held at page load.
 *
 * The panel keeps the saved value in one place: `data.defaultLocale`, the
 * field the list payload carries and the field `buildDefaultLocaleOptions()`
 * selects on. A successful `PUT …/settings` used to leave that field alone,
 * so the state went stale the moment the first change succeeded — and every
 * later reader of it was wrong:
 *
 *   1. a *refused* change snapped the select back to the load-time value
 *      while the server still held the one saved in between (seen at #1079);
 *   2. any rebuild of the panel (switching template type, saving a template)
 *      re-selected that same stale value.
 *
 * Pinned here through the real panel against a stubbed `fetch`: the server
 * answers each accepted change with the locale it now holds, and the panel
 * records it, so both readers land on the truth.
 *
 * Run with: node --test tests/email-default-locale-rollback.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/settings',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;
globalThis.localStorage = dom.window.localStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle;

const { createEmailTemplatesPanel } =
  await import('../client/views/settings/email-templates/index.js');

const ADMIN = { email: 'jaap@example.com', isAdmin: true };
const LOCALES = ['en', 'nl', 'de'];

const flush = () => new Promise((r) => setTimeout(r, 0));

/** JSON response the stubbed `fetch` hands back. */
function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (k) =>
        k.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

/**
 * Mount the panel over a stubbed server that holds one default locale and
 * accepts only the locales in `accepts`. Mirrors the real route: the list
 * payload carries `defaultLocale`, the settings PUT answers with the value
 * the server now holds, and a rejected locale is a 400 envelope.
 * @param {{ defaultLocale: string, accepts: string[] }} server
 */
function mount(server) {
  const held = { defaultLocale: server.defaultLocale };
  globalThis.fetch = async (path, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (path === '/api/admin/email-templates' && method === 'GET') {
      return jsonResponse(200, {
        defaultLocale: held.defaultLocale,
        supportedLocales: LOCALES,
        templates: {
          userInvitation: {
            fields: ['subject'],
            locales: Object.fromEntries(
              LOCALES.map((l) => [
                l,
                { isCustom: false, override: {}, defaults: { subject: 'S' } },
              ]),
            ),
          },
        },
      });
    }
    if (path === '/api/admin/email-templates/settings' && method === 'PUT') {
      const locale = JSON.parse(opts.body || '{}').defaultLocale;
      if (!server.accepts.includes(locale)) {
        return jsonResponse(400, {
          ok: false,
          error: 'bad_request',
          message: `Invalid locale. Supported: ${server.accepts.join(', ')}`,
        });
      }
      held.defaultLocale = locale;
      return jsonResponse(200, { ok: true, defaultLocale: locale });
    }
    throw new Error(`unexpected fetch: ${method} ${path}`);
  };

  // `loadData()` fetches with `maxAgeMs: 0`, so the module-level response
  // cache never stands between a test and its stub.
  const panel = createEmailTemplatesPanel({ user: ADMIN });
  document.body.append(panel);
  return { panel, held };
}

/** The default-locale select is the first one in the panel. */
const defaultLocaleSelect = (panel) => panel.querySelectorAll('select')[0];

/** Pick `locale` in the select and let the save round-trip settle. */
async function chooseDefaultLocale(panel, locale) {
  const select = defaultLocaleSelect(panel);
  select.value = locale;
  select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await flush();
  await flush();
  await flush();
}

test.afterEach(() => {
  document.body.innerHTML = '';
});

test('a refused change rolls back to the locale the server holds', async () => {
  const { panel, held } = mount({ defaultLocale: 'en', accepts: ['en', 'nl'] });
  await flush();
  await flush();

  await chooseDefaultLocale(panel, 'nl');
  assert.equal(
    held.defaultLocale,
    'nl',
    'the server accepted the first change',
  );

  await chooseDefaultLocale(panel, 'de');
  assert.equal(
    held.defaultLocale,
    'nl',
    'the server refused the second change',
  );
  assert.equal(
    defaultLocaleSelect(panel).value,
    'nl',
    'the select shows what the server holds, not the load-time value',
  );
});

test('a rebuild of the panel re-selects the saved locale, not the load-time one', async () => {
  const { panel } = mount({ defaultLocale: 'en', accepts: LOCALES });
  await flush();
  await flush();

  await chooseDefaultLocale(panel, 'nl');

  // Switching template type rebuilds every control, including this select.
  const templateSelect = panel.querySelectorAll('select')[1];
  templateSelect.dispatchEvent(
    new dom.window.Event('change', { bubbles: true }),
  );
  await flush();

  assert.equal(
    defaultLocaleSelect(panel).value,
    'nl',
    'the rebuilt select keeps the saved locale',
  );
});
