# Email infrastructure

## Purpose & scope

Every email Deckyard sends — password resets, magic links, invitations,
collaborator and guest invites, comment notifications, export-ready notices and
the weekly digest — goes through **one transport function** with one explicitly selected SMTP, Brevo, Scaleway TEM or Mailgun adapter, and gets its body from **one of two places**: a code
default (a builder function in `server/integrations/email-templates/`) or an
admin's customized override stored in Postgres. The resolver in front decides
which, per template type and locale.

This document covers that stack: transport, senders, template builders, the
override store, the admin API, and what happens when nothing is configured. The
notification _preferences_ that decide whether a comment even warrants an email
live with the notification system; this doc covers the sending half.

## Module map

Transport and senders (`server/integrations/email/`):

- `server/integrations/email/index.js` — the barrel; re-exports the transport,
  the template-builder helpers and the three sender families.
- `server/integrations/email/core.js` provides `sendEmail({to, toName, subject, htmlContent, textContent, senderOverride})`, `getSenderIdentity()` and `isEmailConfigured()`. Failed sends return `{ok:false, reason, error, status?}`; configuration failures use `not_configured`, attempted failures use `upstream`.
- `server/integrations/email/config.js` owns pure transport validation and effective sender precedence. `transports/{smtp,brevo,scaleway,mailgun}.js` map the same normalized message to each protocol. API calls have a 10-second deadline and refuse redirects; SMTP requires verified TLS with a 10-second overall deadline that also destroys the socket. No retries or provider fallback. Provider response bodies and raw errors are never exposed.
- `server/integrations/email/template-builder.js` — `trySendCustomTemplate()`
  (resolve an override; return `null` to mean "no override, fall back") and
  `buildFromResolvedTemplate()` (resolved fields → html + text).
- `server/integrations/email/senders-auth.js` —
  `sendPasswordResetEmail`, `sendUserInvitationEmail`,
  `sendActivationReminderEmail`, `sendMagicLinkEmail`.
- `server/integrations/email/senders-collaboration.js` —
  `sendCommentNotification`, `sendGuestVerificationEmail`,
  `sendCollaboratorInviteEmail`, `sendGuestInvitationEmail`.
- `server/integrations/email/senders-digests.js` —
  `sendWeeklyDigestEmail`, `sendTeamDigestEmail`.
- `server/integrations/email/senders-export.js` —
  `sendExportReadyNotification`. Not re-exported by the barrel; the bulk-export
  worker imports it directly.

Template bodies (`server/integrations/email-templates/`):

- `server/integrations/email-templates/index.js` — the shared shell:
  `EMAIL_STYLES`, `emailButton`, `emailWrapper`, `troubleClickingFooter`.
- `server/integrations/email-templates/auth.js` — password reset,
  user invitation, activation reminder, magic link.
- `server/integrations/email-templates/notifications.js` — comment
  notification.
- `server/integrations/email-templates/collaboration.js` — guest
  verification, collaborator invite, guest invitation.
- `server/integrations/email-templates/digest.js` — weekly and team
  digest.
- `server/integrations/email-templates/export.js` — export ready.
- `server/integrations/email-templates/helpers.js` — formatting
  helpers (`formatBytes`, …).

Override store and resolution:

- `server/storage/email-templates.js` — `TEMPLATE_METADATA` (label,
  description, placeholders and customizable fields per type),
  `getEmailTemplates`, `writeEmailTemplate`, `deleteEmailTemplate`,
  `getEmailTemplateOverride`, `updateDefaultLocale`, `getEmailDefaultLocale`.
- `server/integrations/email-template-resolver.js` —
  `resolveTemplate(repoRoot, type, locale)` with the fallback chain _custom
  override → code default → `en` default_, plus `interpolatePlaceholders` and the
  preview builders.
- `shared/constants/email-templates.js` — `TEMPLATE_TYPES`, `DEFAULT_LOCALE`
  (`en`), `TEMPLATE_FIELDS` (`subject`, `greeting`, `body`, `buttonLabel`,
  `footer`).
- `server/i18n/index.js` — `SUPPORTED_LOCALES`, **derived from the files in
  `server/i18n/locales/`** (today: `en`, `nl`). Adding `de.json` is the whole
  act of supporting German: the admin panel gains a tab, the API accepts the
  locale, and outgoing mail can be written in it. The list is re-exported by
  `server/storage/email-templates.js` for the server call sites and reaches the
  admin panel over the wire as `supportedLocales`;
  `tests/i18n-supported-locales.test.js` fails when a listed locale lacks the
  full English key set.

Routes and UI:

- `server/routes/api/email-templates.js` — the admin API under
  `/api/admin/email-templates`.
- `client/views/settings/email-templates/` (concerns: `index.js`, `builders.js`,
  `state.js`, `actions.js`, `labels.js`) — the admin panel.

## Data model

Two tables, both created by
`server/db/migrations/058_email_templates_to_table.js`, which also back-filled
whatever the old on-disk `email-templates.json` held (idempotent, `ON CONFLICT
DO NOTHING`):

| Table                     | Shape                                                                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `email_templates`         | `(type, locale)` composite primary key, `fields` jsonb, `created_at`, `updated_at`. The jsonb bag holds **only the fields the admin actually overrode**; an empty override is represented by the _absence_ of the row. |
| `email_template_settings` | Singleton: `id boolean PRIMARY KEY DEFAULT true` with a `CHECK (id)`, plus `default_locale`. A missing row means "unset", which the storage layer reads as the code `DEFAULT_LOCALE`.                                  |

Neither table is organization-scoped: template overrides and the default locale
are **instance-level**, set by an admin, applied to every organization.

Nothing else about email is persisted. There is **no outbox, no send log and no
delivery-status table** — a send either returns `{ok:true}` from the selected transport or it does
not, and that result is discarded by most call sites.

## Flows

- **Sending one email** — a sender function (a) resolves the sender identity
  (app settings → `MAIL_FROM`/`MAIL_FROM_NAME`, with `APP_NAME` as the display-name fallback and no fallback address), (b) calls
  `trySendCustomTemplate()` for its template type and locale; if an override
  exists the interpolated custom body is sent and the function returns, (c)
  otherwise falls through to the code default builder and calls `sendEmail()`.
  Every sender takes an optional `repoRoot`; without it there is no template override lookup. Sender settings are instance-level PostgreSQL data and retain their precedence even for rootless callers.
- **Resolution** — `resolveTemplate()` rejects an unknown type, normalizes an
  unsupported locale to `en`, marks the result `isCustom` if any override field
  exists, and resolves each of the five fields independently — so an admin can
  override just the subject and inherit the rest.
- **Admin editing** — `GET /api/admin/email-templates` (all overrides),
  `GET …/metadata` (types, labels, placeholders), `PUT …/settings` (default
  locale), `PUT`/`DELETE …/:type/:locale` (write or clear one override),
  `POST …/:type/preview` (interpolated preview, nothing sent),
  `POST …/:type/test` (send a real test message). Writes are filtered to the
  type's declared fields.
- **Escaping** — the rule is _escape once, at the point of insertion_. A
  template's `body` is admin-authored HTML and is inserted into the wrapper
  unescaped; `greeting`, `buttonLabel` and `footer` are escaped whole by
  `emailWrapper` / `emailButton` / the muted paragraph, so they are interpolated
  raw. Placeholder **values** — a deck title, a commenter's name, a comment body
  — are escaped in every field, so the raw `body` is not a route in for anything
  a user typed. The `subject` header and the `text/plain` half are not HTML
  sinks and carry raw values; the action URL is escaped into its `href` and into
  the copy-paste footer, identically in both. Pinned by
  `tests/email-template-escaping.test.js`.
- **Language** — every sender asks `resolveRecipientLocale()`
  (`server/integrations/email/recipient-locale.js`) for its own recipient and
  has no `locale` parameter (B400), so no call site can pick or default a
  language. The chain it answers with: the recipient's stored `uiLocale` when
  the install has strings for it, otherwise the install's mail default (the
  admin panel's "default language", `en` until set). That second step covers
  everyone who has not chosen: a share-link guest without an account and an
  invitee whose account was created a moment ago. The two digests are the one
  exception in form, not in outcome: their body is AI-generated prose, so the
  digest job resolves the locale once, `generateDigestWithAI` and
  `generateTeamDigestWithAI` require it, tell the model to write every field
  in that language, render the template fallbacks and the analytics insights
  (from their `type` and `data`, never their English `text`) through the
  translator, and stamp it on `digest.locale`. The digest senders render the
  chrome in `digest.locale` and refuse a digest that names none, so prose and
  frame cannot disagree (B390).
- **Digest** — `scheduleDigestEmailJob()` starts in `server/server.js` and runs
  **daily**, sending only to users whose `digest` preference (Settings >
  Preferences, stored in `user_settings`) is on and names today (default: on,
  Monday; 0 = Sunday). `listDigestRecipients()` in `server/storage/settings.js`
  is the one reader of that preference. It pulls the week's numbers from
  `server/storage/analytics/weekly-summary.js`, has
  `server/services/digest-generation.js` write the prose with an LLM, and sends
  through `sendWeeklyDigestEmail` / `sendTeamDigestEmail`.
- **Export ready** — the bulk-export worker
  (`server/jobs/queue/workers/bulk-export-worker.js`) dynamically imports
  `senders-export.js` when a job finishes and mails the download URL.
- **Unconfigured instance**: an absent selector, invalid transport configuration or missing effective sender returns `reason:'not_configured'` before network access. Admin test-send maps this to 501 `email_not_configured`; provider failures remain 502. Password reset and magic link retain their anti-enumeration responses. Invite outcomes report whether the transport accepted the message, and failed mail never recommends a password reset as a working recovery route. Existing passwords and SSO remain usable.

## Config & flags

`MAIL_TRANSPORT` selects exactly one of `none`, `smtp`, `brevo`, `scaleway`, `mailgun`. Unset selects no transport. There is no autodetection from credentials. Set `MAIL_FROM` to a verified sender address and optionally `MAIL_FROM_NAME`; instance `settings.emailSender.{email,name}` takes precedence field by field. Missing names fall back to `APP_NAME`; missing addresses refuse sending. Headers reject control characters before any adapter runs.

All examples below also need the shared sender:

```dotenv
MAIL_FROM=noreply@example.org
MAIL_FROM_NAME=Deckyard
```

SMTP (both credential fields may be omitted for a trusted relay):

```dotenv
MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.org
SMTP_PORT=587
SMTP_TLS=starttls
SMTP_USER=your-user
SMTP_PASSWORD=your-password
```

Use `SMTP_TLS=tls` for implicit TLS (usually port 465), or `starttls` for a mandatory upgrade (usually 587). The port is explicit, 1-65535. Certificate verification is mandatory; there is no plaintext or insecure-certificate switch. Nodemailer handles MIME and address encoding; file and URL content access are disabled.

Brevo:

```dotenv
MAIL_TRANSPORT=brevo
BREVO_API_KEY=your-key
```

Scaleway TEM:

```dotenv
MAIL_TRANSPORT=scaleway
SCW_SECRET_KEY=your-key
SCW_PROJECT_ID=00000000-0000-0000-0000-000000000000
SCW_REGION=fr-par
```

Mailgun:

```dotenv
MAIL_TRANSPORT=mailgun
MAILGUN_API_KEY=your-key
MAILGUN_DOMAIN=mail.example.org
MAILGUN_REGION=eu
```

Mailgun requires an explicit `eu` or `us` region. Scaleway currently supports `fr-par`. Endpoints are fixed by the adapter; there is no configurable API URL. Use the provider's verified sending domain. Configure SPF, DKIM and DMARC for that domain and check provider acceptance with the admin template test-send. Acceptance means accepted by the transport, not proven inbox delivery.

### Brevo migration

When upgrading from v1.89.1 or earlier to v1.90.0, apply these changes before restarting an instance that sends mail.

| Previous configuration                    | Required configuration                     |
| ----------------------------------------- | ------------------------------------------ |
| `BREVO_API_KEY` alone selected Brevo      | Add `MAIL_TRANSPORT=brevo`; retain the key |
| `BREVO_SENDER_EMAIL`                      | Rename to `MAIL_FROM`                      |
| `BREVO_SENDER_NAME`                       | Rename to `MAIL_FROM_NAME`                 |
| `integrations/brevo.js` imports in a fork | Import `integrations/email/index.js`       |

The old sender variables and module shim are removed without runtime aliases. Stored instance sender settings remain unchanged; no data migration is needed. Remove unused provider fields. Doctor reports legacy and unused field names without their values.

### Disabled or missing mail

`MAIL_TRANSPORT=none` deliberately disables all outgoing mail (doctor: skipped when no leftover fields). An unset selector warns when auth is enabled; invalid or partial configuration warns even with auth disabled. Doctor checks the effective instance sender using initialized storage and explicitly reports when only environment fallback could be checked. It never sends mail or claims reachability. Public `/api/auth/config` exposes only `emailConfigured`, alongside the existing sign-in configuration.

SSO-only installations can sign in without mail, but invitations and notifications need a transport. Password installations need mail for new-account setup, resets and magic links. An existing password keeps working during mail failure. The invite report points to available SSO or an administrator and stays cautious if auth configuration could not be read.

The instance default locale is stored in `email_template_settings`. User `settings.digest.{enabled,dayOfWeek}` controls weekly digests; only explicit `enabled:true` opts in and the day defaults to Monday.

Protocol references: [Nodemailer SMTP](https://nodemailer.com/smtp), [Brevo transactional API](https://developers.brevo.com/reference/send-transac-email), [Scaleway TEM send](https://www.scaleway.com/en/developers/api/transactional-email/emails), [Mailgun send](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages).

## Authz & tenancy

- **The admin API is admin-only.** `server/routes/api/email-templates.js`
  resolves the session itself and returns `unauthorized` unless
  `user.isAdmin`, for every verb including preview and test-send.
- **Overrides are instance-level**, not per organization: one admin's edit
  changes the mail every organization on the instance sends. This is a deliberate
  simplification, not an oversight, but it does mean template editing is _not_
  covered by the tenancy rules in
  [`tenant-isolation.md`](tenant-isolation.md) — there is no scope to narrow.
- **Recipient addresses come from the triggering flow**, which has already done
  its own authorization: an invite route has checked the inviter may invite, the
  comment notifier has checked subscription and permission. The email layer
  itself performs no access check and will send to any address it is handed —
  so a call site that skips its check is the vulnerability, not the sender.
- **Test-send goes to the calling admin's own address**, so the admin API cannot
  be used to mail arbitrary third parties.

## Implementation status (as of 2026-10-26)

Implemented: SMTP, Brevo, Scaleway TEM and Mailgun transports, all three sender families plus export,
the code-default builders in two locales' worth of translator strings (`en`,
`nl` — the list used to claim nine, see B379), the Postgres override store with
its migration off disk, the resolver's custom → default → `en` chain, and the
admin panel with preview and test-send.

Honest gaps:

- **The export mail and the two digests have no admin-customizable
  template.** `senders-export.js` renders a bespoke stats table through
  `buildExportReadyEmail` and deliberately does not ask
  `trySendCustomTemplate`; `exportReady` is absent from `TEMPLATE_METADATA` to
  match. (It used to ask, and every export mail silently threw
  `Invalid template type` into a catch-all — removed in #659.) The two digest
  senders likewise never attempt a custom template. So these three mails can
  be translated but not edited in the admin panel.
- **No delivery observability.** No send log, no retry, no bounce handling, no
  queue: a transient transport failure loses the message. Most call sites do not even
  await the result. For password reset and magic link that is the intended
  privacy stance (do not leak whether an address exists), but it is the same
  silence when the API key is simply missing.
