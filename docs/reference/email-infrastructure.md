# Email infrastructure

## Purpose & scope

Every email Deckyard sends — password resets, magic links, invitations,
collaborator and guest invites, comment notifications, export-ready notices and
the weekly digest — goes through **one transport function** over the
Brevo transactional API, and gets its body from **one of two places**: a code
default (a builder function in `server/integrations/email-templates/`) or an
admin's customized override stored in Postgres. The resolver in front decides
which, per template type and locale.

This document covers that stack: transport, senders, template builders, the
override store, the admin API, and what happens when nothing is configured. The
notification _preferences_ that decide whether a comment even warrants an email
live with the notification system; this doc covers the sending half.

## Module map

Transport and senders (`server/integrations/email/`, 7 modules):

- `server/integrations/email/index.js` — the barrel; re-exports the transport,
  the template-builder helpers and the three sender families.
- `server/integrations/email/core.js` — `sendEmail({to, toName, subject,
htmlContent, textContent, senderOverride})` (a `POST` to
  `https://api.brevo.com/v3/smtp/email` with a 10 s abort), `getSenderIdentity()`
  and `BREVO_API_URL`. **Never throws**: it returns `{ok:false, error}`.
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

Template bodies (`server/integrations/email-templates/`, 7 modules):

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
- `shared/constants/email-templates.js` — `TEMPLATE_TYPES`, `SUPPORTED_LOCALES`
  (9: en, nl, de, fr, es, pt, da, sv, no), `DEFAULT_LOCALE` (`en`),
  `TEMPLATE_FIELDS` (`subject`, `greeting`, `body`, `buttonLabel`, `footer`).

Routes and UI:

- `server/routes/api/email-templates.js` — the admin API under
  `/api/admin/email-templates`.
- `client/views/settings/email-templates/` (5 modules: `index.js`, `builders.js`,
  `state.js`, `actions.js`, `labels.js`) — the admin panel.

Compatibility shim:

- `server/integrations/brevo.js` — a 10-line `export * from './email/index.js'`.
  Ten call sites still import through it; new code should import
  `integrations/email/index.js`.

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
delivery-status table** — a send either returns `{ok:true}` from Brevo or it does
not, and that result is discarded by most call sites.

## Flows

- **Sending one email** — a sender function (a) resolves the sender identity
  (app settings → `BREVO_SENDER_EMAIL`/`BREVO_SENDER_NAME` → a hardcoded
  fallback with `APP_NAME` as the display name), (b) calls
  `trySendCustomTemplate()` for its template type and locale; if an override
  exists the interpolated custom body is sent and the function returns, (c)
  otherwise falls through to the code default builder and calls `sendEmail()`.
  Every sender takes an optional `repoRoot`; without it there is no override
  lookup and no settings-based sender identity.
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
- **Digest** — `scheduleDigestEmailJob()` starts in `server/server.js` and runs
  **daily**, sending only to users whose configured `digest.dayOfWeek` matches
  today (default Monday). It pulls the week's numbers from
  `server/storage/analytics/weekly-summary.js`, has
  `server/services/digest-generation.js` write the prose with an LLM, and sends
  through `sendWeeklyDigestEmail` / `sendTeamDigestEmail`.
- **Export ready** — the bulk-export worker
  (`server/jobs/queue/workers/bulk-export-worker.js`) dynamically imports
  `senders-export.js` when a job finishes and mails the download URL.
- **Unconfigured instance** — with no `BREVO_API_KEY`, `sendEmail` returns
  `{ok:false, error:'BREVO_API_KEY not configured'}`. Nothing throws, nothing
  retries, and callers that fire-and-forget (password reset, magic link, comment
  notification) do not surface it — the flow looks successful and no mail
  arrives. Self-hosting guidance: [`../ops/self-hosting.md`](../ops/self-hosting.md).

## Config & flags

| Name                 | Where                               | Purpose                                                                                                 |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `BREVO_API_KEY`      | `server/integrations/email/core.js` | The only credential. Absent = every send fails softly.                                                  |
| `BREVO_SENDER_EMAIL` | idem                                | Fallback sender address when app settings carry none. Default `noreply@example.com`.                    |
| `BREVO_SENDER_NAME`  | idem                                | Fallback sender name; defaults to `getAppName()` so a white-label deployment sends under its own brand. |
| `APP_NAME`           | `server/config/branding.js`         | Feeds the sender-name default.                                                                          |

Settings, not env: `settings.emailSender.{email,name}` (admin-set sender
identity, takes precedence over the env vars) and the instance default locale in
`email_template_settings`. Per user, `settings.digest.{enabled, dayOfWeek}`
controls the weekly digest (`enabled` defaults to true, day defaults to Monday).

There is **no feature flag that disables email as a whole** — the switch is
whether `BREVO_API_KEY` is set.

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

## Implementation status (as of 2026-08-21)

Shipped and in use: the Brevo transport, all three sender families plus export,
the code-default builders in nine locales' worth of translator strings, the
Postgres override store with its migration off disk, the resolver's
custom → default → `en` chain, and the admin panel with preview and test-send.

Honest gaps:

- **`exportReady` is not a real template type.** `senders-export.js` asks
  `trySendCustomTemplate` for `templateType: 'exportReady'`, but
  `TEMPLATE_METADATA` has no such key, so `resolveTemplate` throws
  `Invalid template type` on every export mail. The throw is swallowed by
  `trySendCustomTemplate`'s catch-all, which returns `null` and falls back to the
  code default — so the mail is correct, the customization path is dead, and
  nothing reports it. Same for the two digest senders, which do not attempt a
  custom template at all.
- **`integrations/brevo.js` is a shim** with ten live importers — the module move
  was made but the call sites were not followed through.
- **No delivery observability.** No send log, no retry, no bounce handling, no
  queue: a transient Brevo failure loses the message. Most call sites do not even
  await the result. For password reset and magic link that is the intended
  privacy stance (do not leak whether an address exists), but it is the same
  silence when the API key is simply missing.
- **One provider, hardcoded.** There is no SMTP path and no provider seam; Brevo
  is `core.js`. A self-hoster without a Brevo account cannot send mail at all.
