/**
 * Authentication-related email templates
 * Password reset, user invitation, activation reminder, magic link
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES, emailButton, emailWrapper, troubleClickingFooter } from './helpers.js';

// ============================================================
// PASSWORD RESET TEMPLATE
// ============================================================

export function buildPasswordResetEmail({
  tr,
  name,
  resetUrl,
}) {
  const greeting = tr('email.common.greeting', 'Hi {name},', { name });
  const bodyText = tr('email.passwordReset.body', 'We received a request to reset your password. Click the button below to choose a new password:');
  const buttonLabel = tr('email.passwordReset.button', 'Reset Password');
  const expiryText = tr('email.passwordReset.expiry', "This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email.");

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${escapeHtml(bodyText)}</p>
      ${emailButton(resetUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(expiryText)}</p>
    `,
    footer: troubleClickingFooter(resetUrl, tr),
  });

  const textContent = `
${greeting}

${bodyText}

${resetUrl}

${expiryText}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// USER INVITATION TEMPLATE
// ============================================================

export function buildUserInvitationEmail({
  tr,
  name,
  inviter,
  setupUrl,
}) {
  const greeting = tr('email.common.greeting', 'Hi {name},', { name });
  const bodyText = tr('email.userInvitation.body', '{inviter} has invited you to join. Click the button below to set up your account:', { inviter });
  const buttonLabel = tr('email.userInvitation.button', 'Set Up Your Account');
  const expiryText = tr('email.userInvitation.expiry', 'This invitation expires in 7 days.');

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${escapeHtml(bodyText)}</p>
      ${emailButton(setupUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(expiryText)}</p>
    `,
    footer: troubleClickingFooter(setupUrl, tr),
  });

  const textContent = `
${greeting}

${bodyText}

${setupUrl}

${expiryText}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// ACTIVATION REMINDER TEMPLATE
// ============================================================

export function buildActivationReminderEmail({
  tr,
  name,
  inviter,
  setupUrl,
}) {
  const greeting = tr('email.common.greeting', 'Hi {name},', { name });
  const bodyText = tr('email.activationReminder.body', "We noticed you haven't completed your account setup yet. {inviter} invited you to join — click the button below to get started:", { inviter });
  const buttonLabel = tr('email.activationReminder.button', 'Complete Setup');
  const footerText = tr('email.activationReminder.expiry', 'This invitation link is still valid.');

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${escapeHtml(bodyText)}</p>
      ${emailButton(setupUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(footerText)}</p>
    `,
    footer: troubleClickingFooter(setupUrl, tr),
  });

  const textContent = `
${greeting}

${bodyText}

${setupUrl}

${footerText}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// MAGIC LINK TEMPLATE
// ============================================================

export function buildMagicLinkEmail({
  tr,
  magicLinkUrl,
  hasPassword = true,
  loginUrl = '',
}) {
  const greeting = tr('email.common.greetingAnonymous', 'Hi there,');
  const bodyText = tr('email.magicLink.body', 'Click the button below to sign in. No password needed!');
  const buttonLabel = tr('email.magicLink.button', 'Sign in now');
  const expiryText = tr('email.magicLink.expiry', 'This link expires in 15 minutes and can only be used once.');
  const safeToIgnore = tr('email.common.safeToIgnore', "If you didn't request this, you can safely ignore this email.");

  // Add a note about setting up a password if they don't have one
  let passwordNote = '';
  let passwordNoteText = '';
  if (!hasPassword && loginUrl) {
    const passwordHintText = tr(
      'email.magicLink.passwordHint',
      'Prefer to use a password? You can set one up anytime from the login page using "Forgot password".'
    );
    passwordNote = `<p style="${EMAIL_STYLES.mutedSmall}; margin-top: 16px;">
      ${escapeHtml(passwordHintText)}
      <a href="${escapeHtml(loginUrl)}" style="color: #0066cc;">${escapeHtml(tr('email.magicLink.loginPageLink', 'Go to login page'))}</a>
    </p>`;
    passwordNoteText = `\n\n${passwordHintText} ${loginUrl}`;
  }

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${escapeHtml(bodyText)}</p>
      ${emailButton(magicLinkUrl, buttonLabel, { alt: true })}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(expiryText)}</p>
      ${passwordNote}
    `,
    footer: `${escapeHtml(safeToIgnore)}<br><br>${troubleClickingFooter(magicLinkUrl, tr)}`,
  });

  const textContent = `
${greeting}

${bodyText}

${magicLinkUrl}

${expiryText}${passwordNoteText}

---
${safeToIgnore}
`.trim();

  return { htmlContent, textContent };
}
