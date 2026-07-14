/**
 * Collaboration email templates
 * Guest verification, collaborator invite, guest invitation
 */

import { escapeHtml } from '../../../shared/slide-types/helpers.js';
import { EMAIL_STYLES, emailButton, emailWrapper, troubleClickingFooter } from './helpers.js';

// ============================================================
// GUEST VERIFICATION TEMPLATE
// ============================================================

export function buildGuestVerificationEmail({
  tr,
  name,
  presTitle,
  verificationUrl,
}) {
  const greeting = tr('email.common.greeting', 'Hi {name},', { name });
  const bodyText = tr('email.guestVerification.body', 'Click the link below to verify your email and join the discussion on <strong>{presTitle}</strong>:', { presTitle });
  const buttonLabel = tr('email.guestVerification.button', 'Verify Email & Join Discussion');
  const expiryText = tr('email.guestVerification.expiry', 'This link expires in 24 hours.');
  const safeToIgnore = tr('email.common.safeToIgnore', "If you didn't request this, you can safely ignore this email.");

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${bodyText}</p>
      ${emailButton(verificationUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(expiryText)}</p>
    `,
    footer: escapeHtml(safeToIgnore),
  });

  const textContent = `
${greeting}

${bodyText.replace(/<[^>]*>/g, '')}

${verificationUrl}

${expiryText}

---
${safeToIgnore}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// COLLABORATOR INVITE TEMPLATE
// ============================================================

export function buildCollaboratorInviteEmail({
  tr,
  name,
  presTitle,
  inviter,
  permission,
  editUrl,
}) {
  const permissionTextMap = {
    view: tr('email.collaboratorInvite.permission.view', 'view'),
    comment: tr('email.collaboratorInvite.permission.comment', 'view and comment on'),
    edit: tr('email.collaboratorInvite.permission.edit', 'edit'),
  };
  const permissionText = permissionTextMap[permission] || 'access';

  const accessLevelMap = {
    view: tr('email.collaboratorInvite.accessLevel.view', 'view access'),
    comment: tr('email.collaboratorInvite.accessLevel.comment', 'commenting access'),
    edit: tr('email.collaboratorInvite.accessLevel.edit', 'full editing access'),
  };
  const accessLevel = accessLevelMap[permission] || accessLevelMap.view;

  const greeting = tr('email.common.greeting', 'Hi {name},', { name });
  const bodyText = tr('email.collaboratorInvite.body', '<strong>{inviter}</strong> has invited you to {permission} <strong>{presTitle}</strong>.', { inviter, permission: permissionText, presTitle });
  const buttonLabel = tr('email.collaboratorInvite.button', 'Open Presentation');
  const accessText = tr('email.collaboratorInvite.access', 'You now have {accessLevel} to this presentation.', { accessLevel });

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${bodyText}</p>
      ${emailButton(editUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(accessText)}</p>
    `,
    footer: troubleClickingFooter(editUrl, tr),
  });

  const textContent = `
${greeting}

${bodyText.replace(/<[^>]*>/g, '')}

${buttonLabel}: ${editUrl}

${accessText}
`.trim();

  return { htmlContent, textContent };
}

// ============================================================
// GUEST INVITATION TEMPLATE
// ============================================================

export function buildGuestInvitationEmail({
  tr,
  name,
  presTitle,
  inviter,
  shareUrl,
}) {
  const greeting = tr('email.common.greeting', 'Hi {name},', { name });
  const bodyText = tr('email.guestInvitation.body', '<strong>{inviter}</strong> has invited you to view and comment on their presentation <strong>{presTitle}</strong>.', { inviter, presTitle });
  const buttonLabel = tr('email.guestInvitation.button', 'View Presentation');
  const footerText = tr('email.guestInvitation.footer', "You'll be asked to verify your email address when you access the presentation.");

  const htmlContent = emailWrapper({
    greeting,
    body: `
      <p>${bodyText}</p>
      ${emailButton(shareUrl, buttonLabel)}
      <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(footerText)}</p>
    `,
    footer: troubleClickingFooter(shareUrl, tr),
  });

  const textContent = `
${greeting}

${bodyText.replace(/<[^>]*>/g, '')}

${buttonLabel}: ${shareUrl}

${footerText}
`.trim();

  return { htmlContent, textContent };
}
