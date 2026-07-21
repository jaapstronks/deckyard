import { api } from '../api.js';

let cachedApp = null;
let cachedAppAt = 0;
let cachedMe = null;
let cachedMeAt = 0;
let cachedOrg = null;
let cachedOrgAt = 0;

export function invalidateSettingsCache() {
  cachedApp = null;
  cachedAppAt = 0;
  cachedMe = null;
  cachedMeAt = 0;
  cachedOrg = null;
  cachedOrgAt = 0;
}

export async function fetchAppSettings({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (cachedApp && now - cachedAppAt < maxAgeMs) return cachedApp;
  const resp = await api('/api/settings/app');
  const s = resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
  cachedApp = s;
  cachedAppAt = now;
  return s;
}

export async function updateAppSettings(next) {
  const resp = await api('/api/settings/app', {
    method: 'PUT',
    body: JSON.stringify(next || {}),
  });
  const s = resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
  cachedApp = s;
  cachedAppAt = Date.now();
  return s;
}

export async function fetchOrgSettings({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (cachedOrg && now - cachedOrgAt < maxAgeMs) return cachedOrg;
  const resp = await api('/api/settings/organization');
  const s = resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
  cachedOrg = s;
  cachedOrgAt = now;
  return s;
}

export async function updateOrgSettings(next) {
  const resp = await api('/api/settings/organization', {
    method: 'PATCH',
    body: JSON.stringify(next || {}),
  });
  const s = resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
  cachedOrg = s;
  cachedOrgAt = Date.now();
  return s;
}

export async function fetchMySettings({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (cachedMe && now - cachedMeAt < maxAgeMs) return cachedMe;
  const resp = await api('/api/settings/me');
  const s = resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
  cachedMe = s;
  cachedMeAt = now;
  return s;
}

export async function updateMySettings(next) {
  const resp = await api('/api/settings/me', {
    method: 'PUT',
    body: JSON.stringify(next || {}),
  });
  const s = resp?.settings && typeof resp.settings === 'object' ? resp.settings : {};
  cachedMe = s;
  cachedMeAt = Date.now();
  return s;
}

// ============================================================
// Email Template API
// ============================================================

let cachedEmailTemplates = null;
let cachedEmailTemplatesAt = 0;

export function invalidateEmailTemplatesCache() {
  cachedEmailTemplates = null;
  cachedEmailTemplatesAt = 0;
}

export async function fetchEmailTemplates({ maxAgeMs = 60_000 } = {}) {
  const now = Date.now();
  if (cachedEmailTemplates && now - cachedEmailTemplatesAt < maxAgeMs) {
    return cachedEmailTemplates;
  }
  const resp = await api('/api/admin/email-templates');
  cachedEmailTemplates = resp;
  cachedEmailTemplatesAt = now;
  return resp;
}

export async function updateEmailTemplate(type, locale, fields) {
  const resp = await api(`/api/admin/email-templates/${type}/${locale}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
  invalidateEmailTemplatesCache();
  return resp;
}

export async function resetEmailTemplate(type, locale) {
  const resp = await api(`/api/admin/email-templates/${type}/${locale}`, {
    method: 'DELETE',
  });
  invalidateEmailTemplatesCache();
  return resp;
}

export async function updateEmailDefaultLocale(locale) {
  const resp = await api('/api/admin/email-templates/settings', {
    method: 'PUT',
    body: JSON.stringify({ defaultLocale: locale }),
  });
  invalidateEmailTemplatesCache();
  return resp;
}

export async function previewEmailTemplate(type, locale, fields = null) {
  return api(`/api/admin/email-templates/${type}/preview`, {
    method: 'POST',
    body: JSON.stringify({ locale, fields }),
  });
}

export async function sendTestEmail(type, locale, fields = null) {
  return api(`/api/admin/email-templates/${type}/test`, {
    method: 'POST',
    body: JSON.stringify({ locale, fields }),
  });
}
