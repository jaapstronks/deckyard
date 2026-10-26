/** Pure outgoing-mail configuration. Diagnostics contain field names only. */
import { getAppName } from '../../config/branding.js';
import { UUID_RE } from '../../utils/uuid.js';

const FIELDS = {
  smtp: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'SMTP_PASSWORD'],
  brevo: ['BREVO_API_KEY'],
  scaleway: ['SCW_SECRET_KEY', 'SCW_PROJECT_ID', 'SCW_REGION'],
  mailgun: ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_REGION'],
};

/** One sender precedence for storage, capabilities and sends. */
export function resolveMailSender(override, env = process.env) {
  return {
    email: override?.email || env.MAIL_FROM || '',
    name: override?.name || env.MAIL_FROM_NAME || getAppName(env),
  };
}

/** A single mailbox, never a list or a header. */
export function validMailAddress(value) {
  return (
    validMailHeader(value) &&
    /^[^\s<>@,;"\\]+@[^\s<>@,;"\\]+\.[^\s<>@,;"\\]+$/.test(value)
  );
}

/** Header input stays text; reject controls before any protocol encoder. */
export function validMailHeader(value) {
  return typeof value === 'string' && !/[\x00-\x1f\x7f]/.test(value);
}

/** Resolve the selected transport. No credential autodetection or aliases. */
export function readMailConfig(env = process.env, senderOverride) {
  const value = (field) => String(env[field] || '');
  const transport = value('MAIL_TRANSPORT');
  const errors = [];
  const warnings = [];
  for (const field of ['BREVO_SENDER_EMAIL', 'BREVO_SENDER_NAME']) {
    if (value(field)) warnings.push(field);
  }
  for (const [provider, fields] of Object.entries(FIELDS)) {
    if (provider !== transport) {
      warnings.push(...fields.filter((field) => value(field)));
    }
  }
  const from = resolveMailSender(senderOverride, env);
  if (!transport || transport === 'none') {
    return { transport, configured: false, errors, warnings, from };
  }
  if (!Object.hasOwn(FIELDS, transport)) errors.push('MAIL_TRANSPORT');
  if (!validMailAddress(from.email)) errors.push('MAIL_FROM');
  if (!validMailHeader(from.name)) errors.push('MAIL_FROM_NAME');
  const required = (fields) => {
    for (const field of fields) if (!value(field)) errors.push(field);
  };
  let options = {};
  switch (transport) {
    case 'smtp':
      required(['SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS']);
      if (!/^[a-zA-Z0-9.:-]+$/.test(value('SMTP_HOST')))
        errors.push('SMTP_HOST');
      if (
        !/^\d+$/.test(value('SMTP_PORT')) ||
        +env.SMTP_PORT < 1 ||
        +env.SMTP_PORT > 65535
      )
        errors.push('SMTP_PORT');
      if (!['tls', 'starttls'].includes(value('SMTP_TLS')))
        errors.push('SMTP_TLS');
      if (Boolean(value('SMTP_USER')) !== Boolean(value('SMTP_PASSWORD')))
        errors.push('SMTP_USER', 'SMTP_PASSWORD');
      options = {
        host: value('SMTP_HOST'),
        port: +env.SMTP_PORT,
        tls: value('SMTP_TLS'),
        user: value('SMTP_USER'),
        password: value('SMTP_PASSWORD'),
      };
      break;
    case 'brevo':
      required(FIELDS.brevo);
      options = { key: value('BREVO_API_KEY') };
      break;
    case 'scaleway':
      required(FIELDS.scaleway);
      if (value('SCW_REGION') !== 'fr-par') errors.push('SCW_REGION');
      if (!UUID_RE.test(value('SCW_PROJECT_ID'))) errors.push('SCW_PROJECT_ID');
      options = {
        key: value('SCW_SECRET_KEY'),
        project: value('SCW_PROJECT_ID'),
        region: value('SCW_REGION'),
      };
      break;
    case 'mailgun':
      required(FIELDS.mailgun);
      if (!['eu', 'us'].includes(value('MAILGUN_REGION')))
        errors.push('MAILGUN_REGION');
      if (
        !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
          value('MAILGUN_DOMAIN'),
        )
      )
        errors.push('MAILGUN_DOMAIN');
      options = {
        key: value('MAILGUN_API_KEY'),
        domain: value('MAILGUN_DOMAIN'),
        region: value('MAILGUN_REGION'),
      };
      break;
  }
  return {
    transport,
    configured: errors.length === 0,
    errors: [...new Set(errors)],
    warnings,
    from,
    options,
  };
}
