# Deckyard Roadmap

**Deckyard's public roadmap** — a high-level view of where the project is
heading. What has already shipped lives in the [CHANGELOG](CHANGELOG.md); this
file looks forward.

The previous roadmap (Feb 2026, "Type System → Intelligence → Agentic Platform")
is retired: all three layers shipped — <!--gen:slide-type-count-->37<!--/gen:slide-type-count--> typed slide types, an AI pipeline with
validation/iteration, and an MCP server with 27 tools + SSE transport.

## How this file works

- **One line per project**, grouped by horizon: **Now** (in active development),
  **Next** (planned), **Later** (directional). The roadmap stays high-level;
  detailed design happens per project before it starts.
- **When something ships**, it moves out of here and into the
  [CHANGELOG](CHANGELOG.md), with the durable "how it works" captured under
  `docs/reference/`.
- This is a direction, not a contract — priorities shift as the project learns.

## Now — organizations on one instance

- **Organizations** — several organizations can share one instance, with
  identity resolved independently of any single organization and every
  presentation query, authorization branch and route context scoped to the
  organization the session actually works in. The backend has landed; the
  management UI (organization switcher, member management, invitations) is what
  remains. How isolation works is documented in
  [`docs/reference/tenant-isolation.md`](docs/reference/tenant-isolation.md).

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
- **Share unification** — a unified 3-tab Share dialog (live audience / link /
  workspace). PR 1 shipped (guarded presenter-control link, inline share link,
  reconciled permission model); the 3-tab dialog is what remains.
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
- **Editorial slide types** — a themed callout family (key-insight / warning /
  definition / note / tip) plus comparison sub-variants (versus / before-after /
  pros-cons / tradeoff), each shipping with matching AI-catalog / MCP logic so
  agents reach for the right block.

## Later — directional

- **SSO, part 2** — SAML, alongside the single-IdP OIDC that has shipped.

### Dropped: the cloud / multi-tenant track

This section used to promise custom domains, white-label hosting and a
shared multi-tenant cloud. That is no longer where Deckyard is going, and
leaving it here would misrepresent the project:

- **Resolving an organization from the hostname is a rejected model**, not
  deferred work. A hostname identifies an *instance*; an organization is a
  dimension *within* one. A customer who wants their own domain gets their own
  deployment — DNS, a reverse proxy and `BASE_URL`, none of which the
  application needs to know about. The half-built subdomain and custom-domain
  resolution has been removed; the reasoning is recorded in
  [`docs/reference/tenant-isolation.md`](docs/reference/tenant-isolation.md)
  under *Why not the hostname*.
- **There will be no shared multi-tenant SaaS** — no subscriptions, no payment
  integration, no self-serve signup, no commercial plan limits in this
  codebase. Deckyard stays something you run yourself, and the isolation shapes
  it supports are documented rather than sold.
