import { api } from '../lib/api.js';
import { h } from '../lib/dom.js';
import { login, me } from '../lib/user/auth.js';
import { t } from '../lib/ui-i18n.js';
import { createBusyManager } from '../lib/dom/busy.js';

export async function renderLogin(root, { nav } = {}) {
  const url = new URL(location.href);
  const returnToRaw =
    url.searchParams.get('returnTo') || '';
  const returnTo =
    returnToRaw.startsWith('/') &&
    !returnToRaw.startsWith('//')
      ? returnToRaw
      : '/app';

  // Extract email from URL params (direct or from returnTo) for pre-filling
  let prefillEmail = url.searchParams.get('email') || '';
  if (!prefillEmail && returnToRaw) {
    try {
      // Check if returnTo contains an email parameter
      const returnUrl = new URL(returnToRaw, location.origin);
      prefillEmail = returnUrl.searchParams.get('email') || '';
    } catch {
      // ignore invalid URLs
    }
  }
  prefillEmail = prefillEmail.trim();

  const shell = h('div', { class: 'auth-shell' });
  const card = h('div', { class: 'auth-card' });

  // Header
  const header = h('div', { class: 'auth-header' });
  const title = h('h1', {
    class: 'auth-title',
    text: t('login.title', 'Sign in'),
  });
  const subtitle = h('p', {
    class: 'auth-subtitle',
    text: t(
      'login.help',
      'Sign in with a magic link or your password.'
    ),
  });
  header.append(title, subtitle);

  // ============================================================
  // Magic Link Section (Easy Mode)
  // ============================================================
  const magicSection = h('div', { class: 'auth-magic-section' });
  const magicHeader = h('div', { class: 'auth-magic-header' });
  const magicBadge = h('span', {
    class: 'auth-magic-badge',
    text: t('login.magicBadge', 'Easy mode'),
  });
  const magicTitle = h('span', {
    class: 'auth-magic-title',
    text: t('login.magicTitle', 'Sign in with email link'),
  });
  magicHeader.append(magicBadge, magicTitle);

  const magicHelp = h('div', {
    class: 'auth-magic-help',
    text: t('login.magicHelp', 'No password needed. We\'ll send you a link.'),
  });

  const magicForm = h('div', { class: 'auth-magic-form' });
  const magicEmail = h('input', {
    class: 'auth-input',
    type: 'email',
    placeholder: t('login.email', 'Email'),
    autocomplete: 'email',
  });
  const magicBtn = h('button', {
    class: 'auth-magic-btn',
    text: t('login.magicSubmit', 'Send link'),
  });
  magicForm.append(magicEmail, magicBtn);

  const magicStatus = h('div', { class: 'auth-magic-status' });

  magicSection.append(magicHeader, magicHelp, magicForm, magicStatus);

  // ============================================================
  // Divider
  // ============================================================
  const divider = h('div', { class: 'auth-divider' });
  const dividerLine1 = h('span', { class: 'auth-divider-line' });
  const dividerText = h('span', {
    class: 'auth-divider-text',
    text: t('login.dividerOr', 'or sign in with password'),
  });
  const dividerLine2 = h('span', { class: 'auth-divider-line' });
  divider.append(dividerLine1, dividerText, dividerLine2);

  // ============================================================
  // Password Login Section
  // ============================================================
  const form = h('div', { class: 'auth-form' });
  const email = h('input', {
    class: 'auth-input',
    type: 'email',
    placeholder: t('login.email', 'Email'),
    autocomplete: 'username',
  });
  const password = h('input', {
    class: 'auth-input',
    type: 'password',
    placeholder: t('login.password', 'Password'),
    autocomplete: 'current-password',
  });
  const status = h('div', { class: 'auth-status' });

  const btn = h('button', {
    class: 'auth-btn',
    text: t('login.submit', 'Sign in'),
  });

  const btnDev = h('button', {
    class: 'auth-btn',
    text: t(
      'login.devContinue',
      'Continue without signing in (local dev)'
    ),
    hidden: true,
  });
  btnDev.style.background = 'hsl(var(--app-bg-hover))';
  btnDev.style.color = 'hsl(var(--app-text-primary))';

  const busyManager = createBusyManager({
    elements: [email, password, btn, btnDev, magicEmail, magicBtn],
  });

  // ============================================================
  // Magic Link Handler
  // ============================================================
  const submitMagicLink = async () => {
    if (busyManager.isBusy()) return;
    const e = (magicEmail.value || '').trim();
    if (!e || !e.includes('@')) {
      magicStatus.textContent = t('login.magicMissingEmail', 'Enter your email address.');
      magicStatus.className = 'auth-magic-status is-error';
      return;
    }
    magicStatus.textContent = t('login.magicSending', 'Sending link...');
    magicStatus.className = 'auth-magic-status';
    busyManager.setBusy(true);
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: e }),
      });
      const data = await res.json();
      if (data.ok) {
        magicStatus.textContent = t(
          'login.magicSuccess',
          'Check your inbox! Click the link we sent to sign in.'
        );
        magicStatus.className = 'auth-magic-status is-success';
        magicEmail.value = '';
      } else {
        throw new Error(data.message || 'Failed to send magic link');
      }
    } catch (err) {
      magicStatus.textContent = String(err?.message || err);
      magicStatus.className = 'auth-magic-status is-error';
    } finally {
      busyManager.setBusy(false);
    }
  };

  magicBtn.onclick = submitMagicLink;
  magicEmail.addEventListener('keydown', (ev) => ev.key === 'Enter' && submitMagicLink());

  // ============================================================
  // Password Login Handler
  // ============================================================
  const submit = async () => {
    if (busyManager.isBusy()) return;
    const e = (email.value || '').trim();
    const p = password.value || '';
    if (!e || !p) {
      status.textContent = t(
        'login.missingFields',
        'Enter email and password.'
      );
      status.className = 'auth-status is-error';
      return;
    }
    status.textContent = t('login.busy', 'Signing in…');
    status.className = 'auth-status';
    busyManager.setBusy(true);
    try {
      await login(e, p);
      // Set fresh login flag so list view starts on 'home'
      try {
        sessionStorage.setItem('ps:fresh-login-pending', '1');
      } catch { /* sessionStorage may not be available */ }
      nav?.(returnTo);
    } catch (err) {
      status.textContent = String(err?.message || err);
      status.className = 'auth-status is-error';
      busyManager.setBusy(false);
    }
  };

  btn.onclick = submit;

  btnDev.onclick = async () => {
    if (busyManager.isBusy()) return;
    status.textContent = t('login.devBusy', 'Dev login…');
    status.className = 'auth-status';
    busyManager.setBusy(true);
    try {
      await api('/api/auth/dev-login', { method: 'POST', body: {} });
      // Confirm session / user and proceed.
      await me();
      // Set fresh login flag so list view starts on 'home'
      try {
        sessionStorage.setItem('ps:fresh-login-pending', '1');
      } catch { /* sessionStorage may not be available */ }
      nav?.(returnTo);
    } catch (err) {
      status.textContent = String(err?.message || err);
      status.className = 'auth-status is-error';
      busyManager.setBusy(false);
    }
  };

  const forgotLink = h('a', {
    href: '/forgot-password',
    class: 'auth-link auth-link-subtle',
    text: t('login.forgotPassword', 'Forgot password?'),
  });
  forgotLink.onclick = (e) => {
    e.preventDefault();
    nav?.('/forgot-password');
  };

  // Button row: sign in button + forgot password link
  const btnRow = h('div', { class: 'auth-btn-row' });
  btnRow.append(btn, forgotLink);

  form.append(email, password, btnRow, btnDev, status);

  card.append(header, magicSection, divider, form);
  shell.append(card);
  root.append(shell);

  // If already logged in (or auth disabled), immediately continue.
  try {
    const u = await me();
    if (u) {
      nav?.(returnTo);
      return;
    }
  } catch {
    // ignore
  }

  // Show dev bypass button only if server has it enabled.
  try {
    await api('/api/auth/dev-login', { method: 'POST', body: { probe: true } });
    btnDev.hidden = false;
  } catch {
    // ignore
  }

  email.addEventListener(
    'keydown',
    (ev) => ev.key === 'Enter' && submit()
  );
  password.addEventListener(
    'keydown',
    (ev) => ev.key === 'Enter' && submit()
  );

  // Pre-fill email fields if email was provided in URL
  if (prefillEmail) {
    magicEmail.value = prefillEmail;
    email.value = prefillEmail;
  }

  email.focus();
}