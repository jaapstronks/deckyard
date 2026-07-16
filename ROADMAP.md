# Deckyard Roadmap

**Updated: 2026-07-10.** This is the single overview for ongoing development.
The previous roadmap (Feb 2026, "Type System → Intelligence → Agentic Platform")
is retired: all three layers shipped (38 typed slide types, AI pipeline with
validation/iteration, MCP server with 22 tools + SSE transport).

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

## Next — existing feature plans

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
- **WYSIWYG + sidebar overhaul for row/block types** —
  `docs/plans/wysiwyg-blocks-overhaul.md` — text-blocks (+ `col{N}` family) onto
  the icon-card-grid add/remove/reorder pattern in sidebar + WYSIWYG; backwards
  compatible.
- **Interactive behaviors** — `docs/plans/interactive-behaviors.md` —
  click/hover interactions on content blocks.
- **Export pipeline DRY cleanup, P3-4** — `docs/plans/code-quality-dry-cleanup.md`
  (P1-2 done).
- **Comments via public API v1 + MCP write** — `docs/plans/comments-api-mcp.md`
  — expose comments in the public v1 API (read + reply/resolve, new key
  scopes) and add MCP write tools + slide-context/snapshot enrichment, so
  agents can triage and answer reviewer feedback. MCP read tools shipped
  2026-07-15 (PR #5).
- **Theme-owned background presets** — `docs/plans/theme-background-presets.md`
  — make `theme.backgroundPresets` the single source of default background
  imagery and remove the deprecated hardcoded fallback list.

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
  only (shared/published views see defaults). Needs a design session
  first; build after the collab track lands (touches the CRDT codec).
- `content-columns-slide` → `columns[]` migration (last remaining dual-read
  migration from the type-system layer).
- Constraint calibration: review maxLength values against real decks.
- MCP extras: `compare_versions`, `batch_operations` (`export_presentation`
  shipped 2026-07-12 — PDF/PPTX/HTML/JSON/PNG download URLs).
- Finish or trim the 10 stub locales (manifest advertises 12, only en/nl are
  populated — see the i18n cleanup plan).
