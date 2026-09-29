/**
 * SSO logins card — the claims the identity provider sent at the last few
 * logins, for an instance admin setting up `OIDC_ADMIN_GROUPS`,
 * `OIDC_GROUPS_CLAIM` or `OIDC_ORG_CLAIM` (B551).
 *
 * Read-only. The server keeps the list in memory and answers only instance
 * admins (server/routes/api/admin-sso.js); on an instance without SSO the card
 * stays hidden.
 *
 * @see docs/reference/sso-oidc.md § Inspecting the claims of a login
 */

import { h } from '../../lib/dom/index.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { formatDateTime } from '../../lib/format/format.js';

/**
 * One login as a collapsible row: when, who, how it ended, and the claims.
 * @param {{ at: string, email: string|null, outcome: string, claims: Object }} login
 * @returns {HTMLElement}
 */
function renderLogin(login) {
  const outcome =
    login.outcome === 'ok'
      ? t('settings.admin.ssoLogins.ok', 'signed in')
      : t('settings.admin.ssoLogins.refused', 'refused: {reason}', {
          reason: login.outcome,
        });
  return h('details', { class: 'sso-login' }, [
    h('summary', {
      text: `${formatDateTime(login.at)} · ${login.email || '—'} · ${outcome}`,
    }),
    h('pre', {
      class: 'sso-login-claims',
      text: JSON.stringify(login.claims, null, 2),
    }),
  ]);
}

/**
 * Create the SSO logins card.
 * @returns {{ el: HTMLElement, load: () => Promise<void> }}
 */
export function createSsoLoginsCard() {
  const list = h('div', { class: 'stack' });
  const el = h('div', { class: 'stack editor-card', hidden: true }, [
    h('div', {
      class: 'field-label',
      text: t('settings.admin.ssoLogins.title', 'SSO: claims of recent logins'),
    }),
    h('div', {
      class: 'help',
      text: t(
        'settings.admin.ssoLogins.hint',
        'What the identity provider sent at the last ten logins of the past day, refused ones included. Kept in server memory only, never tokens; a restart clears it.',
      ),
    }),
    list,
  ]);

  const load = async () => {
    let data;
    try {
      data = await api('/api/admin/sso/logins');
    } catch {
      // 403 for an organization admin without the instance role, or the
      // route is unreachable: either way there is nothing to show.
      return;
    }
    if (!data?.enabled) return;
    el.hidden = false;
    list.replaceChildren(
      ...(data.logins.length
        ? data.logins.map(renderLogin)
        : [
            h('div', {
              class: 'help',
              text: t(
                'settings.admin.ssoLogins.empty',
                'No SSO login since the server started. Sign in through SSO in another browser, then reload this page.',
              ),
            }),
          ]),
    );
  };

  return { el, load };
}
