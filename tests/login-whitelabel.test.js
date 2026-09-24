/**
 * B432: the sign-in card is white-labelable per instance. The SSO button
 * says what `SSO_BUTTON_LABEL` says and the header carries `APP_LOGO_URL`,
 * both read from the public `GET /api/auth/config`; unset, the card looks as
 * it always did (the translated "Sign in with SSO", no logo).
 *
 * Run with: node --test tests/login-whitelabel.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/login',
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.Event = dom.window.Event;
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (fn) => dom.window.setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);

const CONFIG = {
  sso: {
    enabled: true,
    enforce: false,
    provider: 'oidc',
    loginPath: '/api/auth/oidc/login',
    buttonLabel: 'Sign in with Acme ID',
  },
  branding: {
    appName: 'Acme Slides',
    helpUrl: null,
    logoUrl: '/custom/assets/images/acme/lockup.svg',
  },
};

globalThis.fetch = async (input) => {
  const path = String(input);
  const json = (status, body) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  if (path.startsWith('/api/auth/config')) return json(200, CONFIG);
  if (path.startsWith('/api/auth/me'))
    return json(401, { error: 'Unauthorized' });
  return json(404, { error: 'Not found' });
};

const { renderLogin } = await import('../client/views/login.js');
const { authLogo } = await import('../client/views/auth-shell.js');
const { ssoButtonLabel } = await import('../client/lib/user/auth.js');

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test('a configured instance: its own SSO button words and its logo on the card', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  await renderLogin(root);
  await settle();

  const ssoButton = root.querySelector('.auth-sso-section .auth-btn');
  assert.equal(ssoButton.textContent, 'Sign in with Acme ID');
  assert.equal(root.querySelector('.auth-sso-section').hidden, false);

  const logo = root.querySelector('.auth-header > img.auth-logo');
  assert.ok(logo, 'the logo sits in the card header');
  assert.equal(logo.getAttribute('src'), CONFIG.branding.logoUrl);
  assert.equal(logo.getAttribute('alt'), 'Acme Slides');
  assert.equal(
    root.querySelector('.auth-header').firstElementChild,
    logo,
    'above the title',
  );
  root.remove();
});

test('an unconfigured instance keeps the upstream card', () => {
  assert.equal(
    ssoButtonLabel({ sso: { enabled: true, buttonLabel: null } }),
    'Sign in with SSO',
  );
  assert.equal(ssoButtonLabel(null), 'Sign in with SSO');
  assert.equal(
    authLogo({ appName: 'Deckyard', logoUrl: null }),
    null,
    'no logo configured, no logo drawn',
  );
  assert.equal(authLogo(undefined), null);
});
