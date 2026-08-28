# Deckyard Roadmap

**Deckyard's public roadmap** — a high-level view of where the project is
heading. What has already shipped lives in the [CHANGELOG](CHANGELOG.md); this
file looks forward.

The previous roadmap (Feb 2026, "Type System → Intelligence → Agentic Platform")
is retired: all three layers shipped — <!--gen:slide-type-count-->34<!--/gen:slide-type-count--> typed slide types, an AI pipeline with
validation/iteration, and an MCP server with 27 tools + SSE transport.

## How this file works

- **One line per project**, grouped by horizon: **Now** (in active development),
  **Next** (planned), **Later** (directional). The roadmap stays high-level;
  detailed design happens per project before it starts.
- **When something ships**, it moves out of here and into the
  [CHANGELOG](CHANGELOG.md), with the durable "how it works" captured under
  `docs/reference/`.
- This is a direction, not a contract — priorities shift as the project learns.

## Now

- **Beta tightening: one canonical form per concept** — the standing pass that
  keeps reducing drift across the editor, CSS, storage and API surfaces while
  the beta badge is up: one spelling, one shape and one code path per meaning,
  with the guardrails pinned by tests. The stance and its rules are described
  in [`docs/reference/versioning.md`](docs/reference/versioning.md).

_The self-describing slide-type declarations project that stood here has
shipped: every slide type declares its structure, editor behaviour, cloning
rules and per-language defaults in one place, and the editor derives its
forms, element tabs and inspector sections from those declarations — the last
hand-built per-type editor code is gone. How the declaration system works is
documented in
[`docs/reference/slide-type-companions.md`](docs/reference/slide-type-companions.md)
and [`docs/reference/slide-type-directory.md`](docs/reference/slide-type-directory.md)._

_The one-spelling project that stood here has shipped (v1.11.0): every write
path validates and normalizes slide-type ids against the registry, export and
the API emit the canonical reverse-DNS id, and a storage migration folded the
historical spellings._

_The organizations project that stood here has shipped: several organizations
can share one instance, with identity resolved independently of any single
organization, every presentation query, authorization branch and route context
scoped to the organization the session actually works in, and a management UI on
top of it — an organization switcher, member management with invitations, and an
organization profile. What that leaves open, and why the shape is still marked
in development, is documented in
[`docs/reference/tenant-isolation.md`](docs/reference/tenant-isolation.md)._

_The UX improvement track that stood here (from the 2026-07-10 UX research) has
shipped its bulk: i18n & copy cleanup, onboarding & discoverability, the
editor-UI overhaul (wysiwyg-first editing, the Inspector rail, responsive
convergence, editor-chrome redesign), the create-flow track, the Theme Studio,
and the editing-surfaces track. Its two remaining projects moved to **Next**
below — they are planned, not in progress. How each shipped piece works is
documented under `docs/reference/` and `docs/developer/`._

## Next — planned features

- **Live-session robustness** — survive presenter refresh, companion
  auto-recovery, persistent join QR, unified follow codes, linked Q&A
  moderation, poll-open affordance.
- **Share unification** — the tabbed Share dialog has shipped (workspace /
  link / publish); what remains is a Live tab that brings the
  presenter/audience companion links into the same dialog, plus routing the
  presenter Tools menu there.
- **Concurrent-editing hardening, part 2** — follow-ups to the stale-tab merge
  guard: order-preserving merges, client refresh on focus/online so a tab never
  grows stale, and a merge audit log with pre-merge snapshots.
- **AI generation: content-based live status** — a parallel fast-model prompt
  gives content-specific progress lines within seconds, instead of a generic
  "processing" message.
- **AI: recreate a slide from an image/PDF** — attach a screenshot/PDF in the AI
  add + refine flows; recognize the slide type + content and rebuild it as a
  native, editable slide.
- **Interactive behaviors** — the remaining interactions on content blocks:
  gallery links, click-to-reveal, hover states, follow-sync and analytics. Card
  links, the shared link overlay, and the in-deck slide picker have shipped.
- **Forker slide-type toolkit** — a scaffolder and validator for the file-JS
  custom-slide-type seam, plus a reusable building-block layer (eyebrow,
  highlight, badge, CTA) that core and custom types both compose.

## Later — directional

- **SSO, part 2** — SAML, alongside the single-IdP OIDC that has shipped.

### Dropped: the cloud / multi-tenant track

This section used to promise custom domains, white-label hosting and a
shared multi-tenant cloud. That is no longer where Deckyard is going, and
leaving it here would misrepresent the project:

- **Resolving an organization from the hostname is a rejected model**, not
  deferred work. A hostname identifies an _instance_; an organization is a
  dimension _within_ one. A customer who wants their own domain gets their own
  deployment — DNS, a reverse proxy and `BASE_URL`, none of which the
  application needs to know about. The half-built subdomain and custom-domain
  resolution has been removed; the reasoning is recorded in
  [`docs/reference/tenant-isolation.md`](docs/reference/tenant-isolation.md)
  under _Why not the hostname_.
- **There will be no shared multi-tenant SaaS** — no subscriptions, no payment
  integration, no self-serve signup, no commercial plan limits in this
  codebase. Deckyard stays something you run yourself, and the isolation shapes
  it supports are documented rather than sold.
