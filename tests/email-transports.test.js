import { test, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readMailConfig } from '../server/integrations/email/config.js';
import {
  sendEmail,
  isEmailConfigured,
  getSenderIdentity,
} from '../server/integrations/email/index.js';
import { sendSmtp } from '../server/integrations/email/transports/smtp.js';
import { smtpCertificate, smtpInbox } from './helpers/smtp-inbox.js';
import { mailCheck } from '../server/doctor/runtime.js';
import { __setTestDb } from '../server/db/client.js';
import { createFakeDb } from './helpers/fake-db.js';

const configs = {
  smtp: { SMTP_HOST: '127.0.0.1', SMTP_PORT: '465', SMTP_TLS: 'tls' },
  brevo: { BREVO_API_KEY: 'synthetic-secret' },
  scaleway: {
    SCW_SECRET_KEY: 'synthetic-secret',
    SCW_PROJECT_ID: '11111111-1111-1111-1111-111111111111',
    SCW_REGION: 'fr-par',
  },
  mailgun: {
    MAILGUN_API_KEY: 'synthetic-secret',
    MAILGUN_DOMAIN: 'mail.example.test',
    MAILGUN_REGION: 'eu',
  },
};
const fields = [
  'MAIL_TRANSPORT',
  'MAIL_FROM',
  'MAIL_FROM_NAME',
  'BREVO_SENDER_EMAIL',
  'BREVO_SENDER_NAME',
  ...Object.values(configs).flatMap(Object.keys),
  'SMTP_USER',
  'SMTP_PASSWORD',
];
const saved = Object.fromEntries(
  fields.map((field) => [field, process.env[field]]),
);
const realFetch = globalThis.fetch;
beforeEach(() => {
  for (const field of fields) delete process.env[field];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  __setTestDb(null);
});
after(() => {
  for (const [field, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[field];
    else process.env[field] = value;
  }
});
const envFor = (transport) => ({
  MAIL_TRANSPORT: transport,
  MAIL_FROM: 'sender@example.test',
  ...configs[transport],
});
const args = {
  to: 'recipient@example.test',
  toName: 'Recipient "One"',
  subject: 'Mail ✓',
  htmlContent: '<p>HTML ✓</p>',
  textContent: 'Plain ✓',
};

for (const transport of Object.keys(configs)) {
  test(`${transport}: complete configuration and each missing field`, () => {
    const env = envFor(transport);
    assert.equal(readMailConfig(env).configured, true);
    for (const field of ['MAIL_FROM', ...Object.keys(configs[transport])]) {
      assert.equal(
        readMailConfig({ ...env, [field]: '' }).configured,
        false,
        field,
      );
    }
    assert.equal(
      readMailConfig(
        { ...env, MAIL_FROM: '' },
        { email: 'stored@example.test' },
      ).configured,
      true,
    );
  });
}

test('selection is explicit; no legacy runtime aliases, no invalid regions or unsafe SMTP', () => {
  for (const env of [
    {},
    { BREVO_API_KEY: 'secret' },
    { MAIL_TRANSPORT: 'none' },
    { MAIL_TRANSPORT: 'other' },
    {
      ...envFor('brevo'),
      MAIL_FROM: '',
      BREVO_SENDER_EMAIL: 'old@example.test',
    },
    { ...envFor('smtp'), SMTP_TLS: 'plain' },
    { ...envFor('smtp'), SMTP_PORT: '65536' },
    { ...envFor('smtp'), SMTP_PORT: '0' },
    { ...envFor('smtp'), SMTP_USER: 'user' },
    { ...envFor('mailgun'), MAILGUN_REGION: '' },
    { ...envFor('mailgun'), MAILGUN_DOMAIN: 'example.test/path' },
    { ...envFor('scaleway'), SCW_REGION: 'other' },
  ]) {
    assert.equal(readMailConfig(env).configured, false);
  }
  assert.deepEqual(
    readMailConfig({ MAIL_TRANSPORT: 'none', BREVO_API_KEY: 'secret' })
      .warnings,
    ['BREVO_API_KEY'],
  );
  assert.equal(
    readMailConfig({ ...envFor('smtp'), SMTP_USER: 'u', SMTP_PASSWORD: 'p' })
      .configured,
    true,
  );
});

test('invalid config and header injection never touch a transport', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('must not send');
  };
  for (const env of [
    {},
    {
      ...envFor('brevo'),
      MAIL_FROM: 'a@example.test\r\nBcc: other@example.test',
    },
    { ...envFor('brevo'), MAIL_FROM_NAME: 'name\nextra' },
  ]) {
    for (const field of fields) delete process.env[field];
    Object.assign(process.env, env);
    assert.equal((await sendEmail(args)).reason, 'not_configured');
  }
  Object.assign(process.env, envFor('brevo'));
  for (const patch of [
    { to: 'a@example.test,b@example.test' },
    { toName: 'A\r\nBcc: x' },
    { to: 'a\x00@example.test' },
    { subject: 'hello\nBcc: x' },
    { htmlContent: { path: '/etc/passwd' } },
  ]) {
    assert.equal((await sendEmail({ ...args, ...patch })).ok, false);
  }
  assert.equal(calls, 0);
});

for (const transport of ['brevo', 'scaleway', 'mailgun']) {
  test(`${transport}: real adapter mapping, region, credentials, redaction and no retry`, async () => {
    Object.assign(process.env, envFor(transport));
    let calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return new Response('', { status: 201 });
    };
    assert.equal(isEmailConfigured(), true);
    assert.equal(
      (
        await sendEmail({
          ...args,
          senderOverride: {
            email: 'stored@example.test',
            name: 'Stored "Name"',
          },
        })
      ).ok,
      true,
    );
    const { url, init } = calls[0];
    assert.equal(init.redirect, 'error');
    if (transport === 'mailgun') {
      assert.equal(
        url,
        'https://api.eu.mailgun.net/v3/mail.example.test/messages',
      );
      assert.equal(
        Buffer.from(init.headers.Authorization.slice(6), 'base64').toString(),
        'api:synthetic-secret',
      );
      assert.equal(
        init.body.get('from'),
        '"Stored \\"Name\\"" <stored@example.test>',
      );
      assert.equal(init.body.get('text'), args.textContent);
      assert.match(init.body.get('to'), /recipient@example.test/);
      process.env.MAILGUN_REGION = 'us';
      await sendEmail(args);
      assert.match(calls[1].url, /^https:\/\/api.mailgun.net/);
    } else {
      const body = JSON.parse(init.body);
      const from = body.sender || body.from;
      assert.equal(from.email, 'stored@example.test');
      assert.equal(body.to[0].name, args.toName);
      assert.equal(body.subject, args.subject);
      assert.equal(body.htmlContent || body.html, args.htmlContent);
      assert.equal(body.textContent || body.text, args.textContent);
      if (transport === 'scaleway') {
        assert.equal(
          url,
          'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails',
        );
        assert.equal(init.headers['X-Auth-Token'], 'synthetic-secret');
        assert.equal(body.project_id, configs.scaleway.SCW_PROJECT_ID);
      } else assert.equal(init.headers['api-key'], 'synthetic-secret');
    }
    calls = [];
    globalThis.fetch = async () => {
      calls.push(1);
      return new Response(
        'secret token https://reset.example.test/?token=secret',
        { status: 429 },
      );
    };
    const failure = await sendEmail(args);
    assert.equal(failure.status, 429);
    assert.equal(failure.reason, 'upstream');
    assert.doesNotMatch(failure.error, /secret|token|https/);
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => {
      throw new Error(
        'synthetic-secret https://reset.example.test/?token=secret',
      );
    };
    assert.doesNotMatch(
      JSON.stringify(await sendEmail(args)),
      /secret|token|https/,
    );
  });
}

const certificate = smtpCertificate();
const message = {
  from: { email: 'sender@example.test', name: 'Sender' },
  to: { email: args.to, name: args.toName },
  subject: args.subject,
  html: args.htmlContent,
  text: args.textContent,
};
for (const mode of ['tls', 'starttls']) {
  test(`SMTP ${mode}: trusted certificate delivers MIME; untrusted certificate refuses`, async () => {
    const inbox = await smtpInbox({ certificate, mode });
    const config = { host: '127.0.0.1', port: inbox.port, tls: mode };
    try {
      assert.deepEqual(
        await sendSmtp(config, message, { ca: certificate.cert }),
        { ok: true },
      );
      assert.equal(inbox.messages.length, 1);
      assert.match(inbox.messages[0], /Content-Type: multipart\/alternative/);
      assert.match(inbox.messages[0], /sender@example.test/);
      assert.match(inbox.messages[0], /recipient@example.test/);
      assert.match(inbox.messages[0], /Plain/);
      assert.match(inbox.messages[0], /HTML/);
      assert.equal((await sendSmtp(config, message)).ok, false);
      assert.equal(inbox.messages.length, 1);
    } finally {
      await inbox.close();
    }
  });
}

test('SMTP refuses missing STARTTLS, rejection and an overall deadline', async () => {
  for (const options of [
    { mode: 'plain' },
    { mode: 'tls', reject: true },
    { mode: 'plain', stall: true },
  ]) {
    const inbox = await smtpInbox({ certificate, ...options });
    try {
      const result = await sendSmtp(
        {
          host: '127.0.0.1',
          port: inbox.port,
          tls: options.mode === 'tls' ? 'tls' : 'starttls',
        },
        message,
        { ca: certificate.cert, deadline: 150 },
      );
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'upstream');
      if (options.mode === 'plain') assert.equal(inbox.messages.length, 0);
    } finally {
      await inbox.close();
    }
  }
});

test('doctor shares complete config, explicit disable, legacy and partial diagnostics even with auth off', async () => {
  process.env.MAIL_TRANSPORT = 'none';
  assert.equal((await mailCheck.run()).status, 'skip');
  process.env.BREVO_API_KEY = 'synthetic-secret';
  const legacy = await mailCheck.run();
  assert.equal(legacy.status, 'warn');
  assert.doesNotMatch(JSON.stringify(legacy), /synthetic-secret/);
  delete process.env.BREVO_API_KEY;
  Object.assign(process.env, envFor('smtp'));
  assert.equal((await mailCheck.run()).status, 'ok');
  delete process.env.MAIL_FROM;
  __setTestDb(
    createFakeDb({
      app_settings: [
        { id: 1, settings: { emailSender: { email: 'stored@example.test' } } },
      ],
    }),
  );
  // Storage precedence itself is also exercised through sender tests; the doctor
  // only claims settings availability when storage was initialized.
  const finding = await mailCheck.run({
    results: new Map([['database', { status: 'ok' }]]),
  });
  assert.equal(finding.status, 'ok');
  assert.doesNotMatch(finding.message, /unavailable/);
});

test('API deadline aborts a stalled send once, without exposing provider diagnostics', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  Object.assign(process.env, envFor('brevo'));
  let calls = 0;
  globalThis.fetch = (_url, { signal }) =>
    new Promise((_, reject) => {
      calls++;
      signal.addEventListener(
        'abort',
        () => reject(new Error('synthetic-secret')),
        { once: true },
      );
    });
  const pending = sendEmail(args);
  t.mock.timers.tick(10000);
  const result = await pending;
  assert.equal(result.reason, 'upstream');
  assert.equal(calls, 1);
  assert.doesNotMatch(result.error, /synthetic-secret/);
});

test('sender precedence and APP_NAME resolve against the supplied environment', () => {
  const config = readMailConfig({
    ...envFor('brevo'),
    APP_NAME: 'Other Brand',
  });
  assert.equal(config.from.name, 'Other Brand');
  const override = readMailConfig(
    { ...envFor('brevo'), MAIL_FROM_NAME: 'Environment' },
    { email: 'stored@example.test', name: 'Stored' },
  );
  assert.deepEqual(override.from, {
    email: 'stored@example.test',
    name: 'Stored',
  });
});

for (const mode of ['tls', 'starttls']) {
  test(`SMTP ${mode}: credentials are exchanged over TLS; bad credentials refuse once`, async () => {
    const inbox = await smtpInbox({ certificate, mode, auth: true });
    const config = {
      host: '127.0.0.1',
      port: inbox.port,
      tls: mode,
      user: 'test-user',
      password: 'test-password',
    };
    try {
      assert.equal(
        (await sendSmtp(config, message, { ca: certificate.cert })).ok,
        true,
      );
      assert.equal(inbox.messages.length, 1);
      const result = await sendSmtp(
        { ...config, password: 'wrong-secret' },
        message,
        { ca: certificate.cert },
      );
      assert.equal(result.ok, false);
      assert.doesNotMatch(result.error, /wrong-secret|test-password/);
      assert.equal(inbox.messages.length, 1);
      assert.equal(
        inbox.commands.filter((command) => command === 'AUTH').length,
        2,
      );
    } finally {
      await inbox.close();
    }
  });
}

test('doctor reports partial transport configuration even with auth disabled', async () => {
  const original = process.env.AUTH_ENABLED;
  try {
    process.env.AUTH_ENABLED = 'false';
    process.env.MAIL_TRANSPORT = 'smtp';
    process.env.SMTP_HOST = 'localhost';
    const finding = await mailCheck.run();
    assert.equal(finding.status, 'warn');
    assert.match(finding.message, /SMTP_PORT/);
    assert.match(finding.message, /SMTP_TLS/);
  } finally {
    if (original === undefined) delete process.env.AUTH_ENABLED;
    else process.env.AUTH_ENABLED = original;
  }
});

test('rootless PostgreSQL callers keep the same stored sender as capabilities and doctor', async () => {
  Object.assign(process.env, envFor('brevo'));
  delete process.env.MAIL_FROM;
  __setTestDb(
    createFakeDb({
      app_settings: [
        {
          singleton: true,
          settings: {
            emailSender: {
              email: 'stored@example.test',
              name: 'Stored Sender',
            },
          },
        },
      ],
    }),
  );
  const sender = await getSenderIdentity(null);
  assert.deepEqual(sender, {
    email: 'stored@example.test',
    name: 'Stored Sender',
  });
  assert.equal(isEmailConfigured(sender), true);
  let payload;
  globalThis.fetch = async (_url, init) => {
    payload = JSON.parse(init.body);
    return new Response('', { status: 201 });
  };
  assert.equal((await sendEmail({ ...args, senderOverride: sender })).ok, true);
  assert.deepEqual(payload.sender, sender);
});
