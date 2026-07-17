# Deckyard Roadmap

**Updated: 2026-07-17.** This is the single overview for ongoing development.
The previous roadmap (Feb 2026, "Type System → Intelligence → Agentic Platform")
is retired: all three layers shipped (38 typed slide types, AI pipeline with
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

1. **i18n & copy cleanup** — `docs/plans/ux-i18n-copy-cleanup.md`
   Hardcoded NL/EN mix in presenter/companion surfaces, `en.json` artifact,
   locale manifest, date formats, UUID-as-theme-name.
2. **Onboarding & discoverability** — `docs/plans/ux-onboarding-discoverability.md`
   Empty states with CTAs, first-run Home, shortcut help, visible undo/redo,
   surface API/MCP in-product, WYSIWYG coach mark.
3. **Live-session robustness** — `docs/plans/ux-live-session-robustness.md`
   Survive presenter refresh, companion auto-recovery, persistent join QR,
   unify follow codes, link Q&A moderation, poll-open affordance.
4. **Share unification** — `docs/plans/ux-share-unification.md`
   One Share dialog (live audience / link / workspace), guard the
   presenter-control link, reconcile the permission model.

_(The editor-UI track — wysiwyg-first editing, "Edit all text" bulk modal,
the right-side Inspector rail with settings + comments panes, responsive
convergence — shipped in full on 2026-07-16, followed on 2026-07-17 by the
editor-chrome redesign: deck-only topbar zones, pane tabs on the slide
toolbar, presenter notes as a third pane, inline icon picker and a comments
scope switch. How it works is documented in
`docs/reference/editor-inspector.md`.)_

## Next — existing feature plans

- **Concurrent-editing hardening, part 2** — follow-ups to the stale-tab
  merge guard that shipped 2026-07-17 (staleness cap + per-slide conflict
  detection via base fingerprints): order-preserving merges, client refresh
  on focus/online so a tab never grows stale, a merge audit log with
  pre-merge snapshots, and a decision on the admin If-Match bypass.
  Worklist entry in `docs/plans/TODO.md`.
- **Image + text layout catalogue** — `docs/plans/image-text-layouts.md` —
  more fixed compositions for image-text (width series 1/3-1/2-2/3, image
  rows above/below the text with 2-3 equal-height images, stacked duo,
  corner image) behind a layout switcher in the WYSIWYG slide toolbar;
  content survives every switch, "text without image" is the zeroth
  variant. Deliberately a curated catalogue, not free-form placement.
  Phase 0 is `docs/plans/wysiwyg-image-add-remove.md` — "add an image" on
  a text slide and "remove the image area" on an image-text slide, with
  the existing convert seam doing the type switch under water.
- **AI generation: content-based live status** — `docs/plans/ai-generation-live-status.md`
  — a parallel fast-model prompt gives content-specific progress lines within
  seconds, instead of the generic "processing" message.
- **AI review grid: click-to-preview, hover-select, modal nav** —
  `docs/plans/ai-review-grid-ux.md` — clicking a tile opens the preview modal
  (selection moves to a hover checkbox); modal shows the AI's why-text and
  navigates with buttons + arrow keys.
- **AI: recreate a slide from an image/PDF** — `docs/plans/ai-slide-from-image.md`
  — attach a screenshot/PDF in the AI add + refine flows; recognize the slide
  type + content and rebuild it as a native editable slide.
- **Interactive behaviors** — `docs/plans/interactive-behaviors.md` —
  click/hover interactions on content blocks.
- **Export pipeline DRY cleanup, P3-4** — `docs/plans/code-quality-dry-cleanup.md`
  (P1-2 done).
- **Theme-owned background presets** — `docs/plans/theme-background-presets.md`
  — make `theme.backgroundPresets` the single source of default background
  imagery and remove the deprecated hardcoded fallback list.
- **Comments & notifications UX rethink** —
  `docs/plans/comments-notifications-ux.md` — in busy review rounds the
  comments list doubles as a personal inbox: "Resolve" archives the whole
  thread for everyone, while what you often want is "done for me" without
  hiding it from a colleague who still has to read it. Analysis + candidate
  scenarios (per-user dismiss, Notion-style events inbox, split
  answered/resolved, unread markers) are in the plan; parked until a design
  session picks a direction — do not build before that.

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
- Finish or trim the 10 stub locales (manifest advertises 12, only en/nl are
  populated — see the i18n cleanup plan).
