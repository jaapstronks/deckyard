# Deckyard Roadmap

**Deckyard's public roadmap** — a high-level view of where the project is
heading. What has already shipped lives in the [CHANGELOG](CHANGELOG.md); this
file looks forward.

The previous roadmap (Feb 2026, "Type System → Intelligence → Agentic Platform")
is retired: all three layers shipped — 39 typed slide types, an AI pipeline with
validation/iteration, and an MCP server with 27 tools + SSE transport.

## How this file works

- **One line per project**, grouped by horizon: **Now** (in active development),
  **Next** (planned), **Later** (directional). The roadmap stays high-level;
  detailed design happens per project before it starts.
- **When something ships**, it moves out of here and into the
  [CHANGELOG](CHANGELOG.md), with the durable "how it works" captured under
  `docs/reference/`.
- This is a direction, not a contract — priorities shift as the project learns.

## Now — UX improvement track (from the 2026-07-10 UX research)

Each is a self-contained project, in recommended working order.

1. **Live-session robustness** — survive presenter refresh, companion
   auto-recovery, persistent join QR, unified follow codes, linked Q&A
   moderation, poll-open affordance.
2. **Share unification** — a unified 3-tab Share dialog (live audience / link /
   workspace). PR 1 shipped (guarded presenter-control link, inline share link,
   reconciled permission model); the 3-tab dialog is what remains.

_Shipped in this track: i18n & copy cleanup, onboarding & discoverability, the
editor-UI overhaul (wysiwyg-first editing, the Inspector rail, responsive
convergence, editor-chrome redesign), the create-flow track, the Theme Studio,
and the editing-surfaces track. How each works is documented under
`docs/reference/` and `docs/developer/`._

## Next — planned features

- **Concurrent-editing hardening, part 2** — follow-ups to the stale-tab merge
  guard: order-preserving merges, client refresh on focus/online so a tab never
  grows stale, a merge audit log with pre-merge snapshots, and a decision on the
  admin If-Match bypass.
- **AI generation: content-based live status** — a parallel fast-model prompt
  gives content-specific progress lines within seconds, instead of a generic
  "processing" message.
- **AI: recreate a slide from an image/PDF** — attach a screenshot/PDF in the AI
  add + refine flows; recognize the slide type + content and rebuild it as a
  native, editable slide.
- **Interactive behaviors** — click/hover interactions on content blocks.
- **Export pipeline DRY cleanup** — remaining phases.
- **Forker slide-type toolkit** — a scaffolder and validator for the file-JS
  custom-slide-type seam, plus a reusable building-block layer (eyebrow,
  highlight, badge, CTA) that core and custom types both compose.
- **Editorial slide types** — a themed callout family (key-insight / warning /
  definition / note / tip) plus comparison sub-variants (versus / before-after /
  pros-cons / tradeoff), each shipping with matching AI-catalog / MCP logic so
  agents reach for the right block.

## Later — cloud / multi-tenant track

- **Custom domains**
- **SSO** — Google OAuth + SAML
- **Multi-tenancy** — white-label hosting; depends on the two above
