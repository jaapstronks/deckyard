import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { t } from '../lib/ui-i18n.js';
import { me } from '../lib/user/auth.js';
import { spinner } from '../lib/dom/spinner.js';
import { authShell } from './auth-shell.js';
import { nav } from '../lib/state/router.js';

export async function renderMagicLogin(root) {
  const url = new URL(location.href);
  const returnToRaw = url.searchParams.get('returnTo') || '';
  const returnTo =
    returnToRaw.startsWith('/') && !returnToRaw.startsWith('//')
      ? returnToRaw
      : '/app';

  const { shell, card, header, title, subtitle } = authShell({
    title: t('magicLogin.title', 'Signing you in…'),
    subtitle: t('magicLogin.verifying', 'Verifying your link…'),
    centered: true,
  });

  // Add a spinner/loading indicator
  const spinnerEl = spinner('xl');

  card.append(spinnerEl);
  root.append(shell);

  // Get token from URL
  const token = url.searchParams.get('token');

  if (!token) {
    spinnerEl.remove();
    title.textContent = t('magicLogin.error', 'Invalid link');
    subtitle.textContent = t(
      'magicLogin.invalidToken',
      'This sign-in link is invalid or has expired.',
    );
    subtitle.className = 'auth-subtitle';

    const loginLink = h('a', {
      href: '/login',
      class: 'auth-btn',
      style:
        'text-decoration: none; margin-top: var(--ps-space-4); width: auto;',
      text: t('magicLogin.goToLogin', 'Go to login'),
    });
    loginLink.onclick = (e) => {
      e.preventDefault();
      nav('/login');
    };
    card.append(loginLink);
    return;
  }

  // Verify and consume the token
  try {
    // Verify is a soft-fail endpoint: HTTP 200 with { ok, reason } either way.
    const data = await api('/api/auth/magic-link/verify', {
      method: 'POST',
      body: { token },
    });

    if (data.ok) {
      // Success! Redirect to app
      spinnerEl.remove();

      // Show success icon
      const successIcon = h('div', {
        class: 'auth-success-icon',
        text: '\u2713',
      });
      header.before(successIcon);

      title.textContent = t('magicLogin.success', 'Welcome!');
      subtitle.textContent = t(
        'magicLogin.redirecting',
        'Redirecting you now…',
      );
      subtitle.className = 'auth-subtitle';

      // Set fresh login flag so list view starts on 'home'
      try {
        sessionStorage.setItem('ps:fresh-login-pending', '1');
      } catch {
        /* sessionStorage may not be available */
      }

      // Verify session and navigate
      try {
        await me();
        setTimeout(() => nav(returnTo), 500);
      } catch {
        nav(returnTo);
      }
    } else {
      // Token invalid or expired
      spinnerEl.remove();
      title.textContent = t('magicLogin.error', 'Invalid link');
      subtitle.textContent =
        data.reason === 'expired'
          ? t(
              'magicLogin.expiredToken',
              'This sign-in link has expired. Please request a new one.',
            )
          : t(
              'magicLogin.invalidToken',
              'This sign-in link is invalid or has expired.',
            );
      subtitle.className = 'auth-subtitle';

      const loginLink = h('a', {
        href: '/login',
        class: 'auth-btn',
        style:
          'text-decoration: none; margin-top: var(--ps-space-4); width: auto;',
        text: t('magicLogin.tryAgain', 'Try again'),
      });
      loginLink.onclick = (e) => {
        e.preventDefault();
        nav('/login');
      };
      card.append(loginLink);
    }
  } catch (err) {
    spinnerEl.remove();
    title.textContent = t(
      'magicLogin.networkErrorTitle',
      'Something went wrong',
    );
    subtitle.textContent = t(
      'magicLogin.networkError',
      'Could not verify your link. Please try again.',
    );
    subtitle.className = 'auth-subtitle';

    const loginLink = h('a', {
      href: '/login',
      class: 'auth-btn',
      style:
        'text-decoration: none; margin-top: var(--ps-space-4); width: auto;',
      text: t('magicLogin.goToLogin', 'Go to login'),
    });
    loginLink.onclick = (e) => {
      e.preventDefault();
      nav('/login');
    };
    card.append(loginLink);
  }
}
