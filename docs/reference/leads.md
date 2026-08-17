# Lead capture & privacy

The lead-capture slide collects a viewer's **name and e-mail address** on a
published deck — anonymous visitor PII, the same category of data as
[analytics](analytics-privacy.md), plus an outbound export path
([the `lead.submitted` webhook](webhooks.md)). This doc covers what is
stored, who can read it, where it leaves the instance, how it is retained and
erased, and the honest state of the GDPR self-service flow. Written
2026-08-16 against HEAD.

## Purpose & scope

A deck author drops a `lead-capture-slide` into a published deck; a visitor
who fills it in leaves their name and e-mail with explicit consent. The
subsystem is DB-only (`lead_submissions` table; file-mode storage answers
empty/no-op) and instance-spanning on submit: the visitor has no session, so
the public submit path deliberately looks the deck up across organizations.

## Module map

- `shared/slide-types/types/lead-capture-slide.js` — the slide type;
  `client/lib/slide-runtime/lead-capture-runtime.js` posts the form from the
  public viewer.
- `server/routes/api/leads.js` (408 lines) — the whole route surface: the
  public submit, the per-deck reads, the GDPR self-service, the admin delete,
  and the in-memory GDPR token store.
- `server/storage/leads.js` (433) — storage: create/read/export plus the four
  anonymizers (single lead, by e-mail, retention-expired, old IPs).
- `server/jobs/analytics-cleanup.js` — the retention sweep. Leads have no job
  of their own: the *analytics* cleanup job also anonymizes expired leads and
  old lead IPs, on the analytics schedule.
- `server/utils/webhooks.js` — `maybeFireLeadWebhook` (`lead.submitted`);
  `server/integrations/email/senders-leads.js` — the owner-notification
  e-mail.
- `client/views/analytics/leads-tab.js` — where an author sees and exports
  the collected leads.

## What is stored

One row per submission: `name`, `email` (lowercased), `consent_given`,
`consent_text`, `privacy_url`, `ip_address`, `user_agent`, `submitted_at`,
`retention_expires_at`, plus the deck/slide/organization ids. Submission
requires `consentGiven: true` **and** a non-empty `consentText` — the row
records what the visitor agreed to, not just that they agreed.

"Deleting" a lead — by any path — is **anonymization in place**: `name` and
`email` become `[deleted]`, `ip_address` and `user_agent` become null, and
`anonymized_at` is stamped. The row (deck, slide, timestamps, consent text)
survives for counting; the person is gone from it.

## Endpoint surface

**Public** (no session; mounted before the auth gate):

| Method | Path | Does |
|---|---|---|
| POST | `/api/leads` | Submit a lead. Rate-limited per IP and globally (`LEAD_RATE_LIMITS`), consent required, deck must exist. Fires the webhook and the owner e-mail best-effort. |

**Authenticated** (session required — including, today, the my-data routes;
see *Implementation status*):

| Method | Path | Permission | Does |
|---|---|---|---|
| GET | `/api/presentations/:id/leads` | deck **read** | List (paginated, optional `slideId` filter). |
| GET | `/api/presentations/:id/leads/count` | deck **read** | Count. |
| GET | `/api/presentations/:id/leads/export` | deck **write** | CSV download — export is more sensitive than reading on screen. |
| DELETE | `/api/leads/:id` | deck **write** | Anonymize one lead. |
| POST | `/api/leads/my-data/request` | (session) | Mint a GDPR verification token for an e-mail address. |
| GET | `/api/leads/my-data` | token | Export every non-anonymized lead for that e-mail. |
| DELETE | `/api/leads/my-data` | token | Anonymize every lead for that e-mail; the token is single-use. |

The `my-data` literal routes are registered before the `DELETE /api/leads/:id`
pattern on purpose — `:id` matches any segment, so the reverse order would
swallow the erasure route.

## Where the data leaves the instance

Two outbound paths fire on every submit, both best-effort:

1. **The `lead.submitted` webhook** — carries the visitor's name and e-mail
   to whatever URL the instance admin configured. Payload shape and caveats in
   [`webhooks.md`](webhooks.md); configuring it is an act of data export.
2. **The owner-notification e-mail** — sent to the deck owner if their
   `notifications.leadEmails` preference is on, via the Brevo seam.

## Retention & the GDPR flow

- Each lead gets `retention_expires_at` stamped at creation from the
  instance-level `leads.retentionDays` app setting (default **365**,
  normalized to 1–730).
- The sweep lives in the **analytics** cleanup job: `anonymizeExpiredLeads()`
  anonymizes rows past their retention date, and lead IP addresses are
  additionally nulled after the *analytics* `ipAnonymizationDays` window —
  the same policy as view sessions, on the same schedule.
- Self-service (GDPR art. 15/17): `POST /api/leads/my-data/request` mints a
  `crypto.randomBytes(32)` token for the e-mail, valid 15 minutes, held in an
  **in-memory Map** (per-process; a code comment already notes multi-instance
  would need Redis). `GET`/`DELETE /api/leads/my-data` verify e-mail + token;
  the delete anonymizes everything for that address and burns the token.

## Implementation status

Normative target: **a visitor can see and erase what a deck collected about
them, without help from the instance operator.** Where the code stands, as of
2026-08-16 — the self-service flow does **not** deliver that today:

- **Token delivery is wired (B63, done).** `handleRequestMyData` now sends the
  verification link through the `sendEmail` seam
  (`sendDataRequestVerificationEmail`). When outgoing mail is unconfigured the
  endpoint answers an honest **501 `email_not_configured`** instead of claiming
  a link was sent — the same shape as the email test-send and Notion routes; an
  upstream provider failure is a 502. In `NODE_ENV === 'development'` with no
  mail provider it still echoes `devToken` so the flow stays testable locally.
  Delivery is attempted for any well-formed address with no existence check, so
  the response can't be used to probe which addresses are on file.
- **The my-data routes still sit behind the login gate (open).** `handleLeads`
  requires a session, but the data subject is an anonymous visitor with no
  account. Token delivery is fixed, but the flow still only works for people
  who happen to have an instance login; compare the analytics anon-erase, which
  is deliberately public. Moving the my-data routes public (with their own rate
  limit) is the remaining half — deliberately left out of the B63 mail fix.
- **The verification link lands on the raw JSON API (open).** The e-mail points
  at `GET /api/leads/my-data?email=…&token=…`, which returns the data as JSON
  and has no companion erase button — erasure is a `DELETE` a plain link can't
  issue. A friendly HTML landing page that renders the data and offers erase is
  future UI work, tracked with the login-gate item.
- **Leads retention has no admin UI.** `leads.retentionDays` exists, is
  normalized and enforced, but the admin settings tab only exposes the
  *analytics* retention knobs — the leads value can only be changed via
  `PUT /api/settings/app` by hand. Same gap shape as the `lead.submitted`
  webhook field (see [`webhooks.md`](webhooks.md) § Implementation status).
- **The retention sweep is a tenant of the analytics job.** It runs and is
  logged, but a leads sweep living in `analytics-cleanup.js` is easy to lose
  when analytics scheduling changes; noted here so it is a known oddity, not
  a surprise.
- **Deletion is anonymization.** No path hard-deletes a `lead_submissions`
  row. That is a deliberate counting choice, but "delete" in the UI and API
  names should be read as "remove the person, keep the event".
