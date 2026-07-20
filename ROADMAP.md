# Deckyard Roadmap

**Updated: 2026-07-19.** This is the single overview for ongoing development.
The previous roadmap (Feb 2026, "Type System → Intelligence → Agentic Platform")
is retired: all three layers shipped (39 typed slide types, AI pipeline with
validation/iteration, MCP server with 27 tools + SSE transport).

## How this file works

- **One line per project here**, linked to an elaborated briefing in
  `docs/plans/<slug>.md` (goal / problem / scope / done-when).
- `docs/plans/` is **gitignored** — plans are local working docs, like the old
  `docs/planning/` was. This file stays high-level enough to be public.
- **The operational worklist is `docs/plans/TODO.md`** — in progress / queue /
  done, always current. Start there when deciding what to do; this file is the
  coarse public overview and changes less often.
- **When a plan ships**: delete the plan file (or move the durable "how it
  works" parts to `docs/reference/`), and remove the line here.
  `docs/plans/done/` is a temporary parking spot for finished plans that still
  need that conversion; empty it periodically.
- New idea? Add a line under **Later**. Picking it up? Write the briefing in
  `docs/plans/`, move the line to **Now**.

## Now — UX improvement track (from the 2026-07-10 UX research)

In recommended working order (rationale in `docs/plans/TODO.md`); each is a
self-contained project.

1. **Live-session robustness** — `docs/plans/ux-live-session-robustness.md`
   Survive presenter refresh, companion auto-recovery, persistent join QR,
   unify follow codes, link Q&A moderation, poll-open affordance.
2. **Share unification** — `docs/plans/ux-share-unification.md`
   PR 1/2 shipped (PR #110): guarded the presenter-control link, inline share
   link, reconciled the permission model. Remaining = **PR 2**: the unified
   3-tab Share dialog (live audience / link / workspace).

_(The first two projects of this track — i18n & copy cleanup, onboarding &
discoverability — shipped in July 2026 except for one decision-blocked
leftover each: the page-`<title>` brand choice and the in-app help/docs
link, both tracked in `docs/plans/TODO.md` under "Blocked on a decision".)_

_(The editor-UI track — wysiwyg-first editing, "Edit all text" bulk modal,
the right-side Inspector rail with settings + comments panes, responsive
convergence — shipped in full on 2026-07-16, followed on 2026-07-17 by the
editor-chrome redesign: deck-only topbar zones, pane tabs on the slide
toolbar, presenter notes as a third pane, inline icon picker and a comments
scope switch. How it works is documented in
`docs/reference/editor-inspector.md`.)_

_(The create-flow track — a two-column "New presentation" view, library-first
reuse consolidation (Duplicate a whole deck / compose from library slides / a
named, ordered **Collection**), retired starter kits, and a workspace-default
theme picker — shipped in full on 2026-07-18 (Slices 1-4). How it works is
documented in `docs/reference/deck-creation-and-reuse.md`.)_

_(The **Theme Studio** — the guided layer over the `--t-*` token system —
shipped on 2026-07-19 across 17 PRs. A brand theme can now be built two ways: a
file theme in git (`custom/themes/<id>/theme.json`, documented in
`docs/developer/themes.md`) or a database theme in the browser, with colours,
fonts, an uploaded logo, surface scales, heading treatment, background imagery,
named background options and per-property override locks. The database shape and
its validation are documented in `docs/reference/theme-config.md`. Ejecting a
database theme to file-JSON was dropped: both audiences are served directly, so
it would only have been a second path to something that already works.)_

## Next — existing feature plans

- **Selection-aware inspector + direct image layout** —
  `docs/plans/selection-aware-inspector.md` — focal point becomes a draggable
  point on the image (replacing the 3×3 grid), a Cover/Contain toggle on the
  image, and the inspector becomes selection-aware: slide-only selection shows
  slide-wide settings, selecting an image/card shows just that one in a "This
  element" tab. Text stays edit-first. Starts with images; cards follow.
- **Concurrent-editing hardening, part 2** — follow-ups to the stale-tab
  merge guard that shipped 2026-07-17 (staleness cap + per-slide conflict
  detection via base fingerprints): order-preserving merges, client refresh
  on focus/online so a tab never grows stale, a merge audit log with
  pre-merge snapshots, and a decision on the admin If-Match bypass.
  Worklist entry in `docs/plans/TODO.md`.
- **AI generation: content-based live status** — `docs/plans/ai-generation-live-status.md`
  — a parallel fast-model prompt gives content-specific progress lines within
  seconds, instead of the generic "processing" message.
- **AI: recreate a slide from an image/PDF** — `docs/plans/ai-slide-from-image.md`
  — attach a screenshot/PDF in the AI add + refine flows; recognize the slide
  type + content and rebuild it as a native editable slide.
- **Interactive behaviors** — `docs/plans/interactive-behaviors.md` —
  click/hover interactions on content blocks.
- **Export pipeline DRY cleanup, P3-4** — `docs/plans/code-quality-dry-cleanup.md`
  (P1-2 done).
- **Forker slide-type toolkit** — `docs/plans/forker-slide-type-toolkit.md`
  — a scaffolder and validator for the file-JS custom-slide-type seam, plus a
  reusable building-block layer (eyebrow, highlight, badge, CTA) that core and
  custom types both compose. Split out of the theme track when the Theme Studio
  shipped.

## Later — cloud / multi-tenant track

- **Custom domains** — `docs/plans/custom-domains.md`
- **SSO (Google OAuth + SAML)** — `docs/plans/sso-integration.md`
- **Multi-tenancy (white-label hosting)** — briefing in progress
  (part 2, the build plan, still to be written; depends on the two above)

## Ideas (no briefing yet)

- **Slide alternatives** — a slide can carry one or more alternative
  versions (possibly a different slide type), one being the default; try a
  different form of slide 6 without losing the original or polluting the
  deck. Sketch: alternatives nested under the slide (deck stays a flat
  array; exports/presenter/API see only defaults unless asked), slide-list
  badge/stack, promote-to-default, side-by-side compare with per-variant
  comment threads. Early decisions locked 2026-07-16: per-slide only (no
  multi-slide alternative sets), presenter picks variants at start (no
  live switching for now), alternatives are editor/collaborator-facing
  only (shared/published views see defaults). **Caution: idea only** — the
  concept still has to be thought through properly, and Jaap is not yet
  convinced it should be built at all (nor on what timescale). Needs a
  real design session first; if it goes ahead, build only after careful
  sequencing with the collab data model (it touches the CRDT codec).
  Explicitly not near the top of the list.
- `content-columns-slide` → `columns[]` migration (last remaining dual-read
  migration from the type-system layer).
- Constraint calibration: review maxLength values against real decks.
- MCP extras: `compare_versions`, `batch_operations` (`export_presentation`
  shipped 2026-07-12 — PDF/PPTX/HTML/JSON/PNG download URLs).
