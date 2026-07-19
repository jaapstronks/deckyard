# AI slide review: deck grid, batch review, section refine

Shipped 2026-07-14 (PR #111, plus review fixes in the same PR). How the AI
review layer over slide generation works and where the pieces live.

## Deck grid (light table)

`client/views/editor/deck-grid.js` — reusable overview grid of a deck's slides
with truthful thumbnails (same lazy IntersectionObserver + per-tile
`--thumb-scale` pattern as the insert-slide picker). The module itself is
AI-free; the AI review modals are this grid plus an annotation layer.

Interaction is configurable per consumer:

- `annotationFor(slide, index)` — hook that renders extra content under a tile
  (the AI "why + alternatives" layer).
- `previewOnClick` — clicking a tile opens the peek lightbox (the AI-review
  default: preview is the common action). Keyboard on a focused tile: Enter →
  preview, Space → toggle selection. When off, a tile click picks/toggles and
  a per-tile magnifier button opens the peek instead.
- `selectable` — multi-select. In `previewOnClick` mode, selection is a corner
  **checkbox** (hover-revealed, kept visible while checked); otherwise the
  whole tile toggles with an `is-selected` checkmark.
- `peekNoteFor(slide, index)` — extra info rendered inside the peek preview
  (the AI rationale, so you don't have to close the preview to read the why).

The **peek lightbox** navigates the whole deck without closing — ‹ › buttons
plus ArrowLeft / ArrowRight, a `n / total` counter, and (capture-phase Escape
so the host modal survives) closes back to the grid. Selection state is
untouched while navigating.

Consumers:

- `modals/deck-overview-modal.js` — plain overview, opened from the topbar
  "Slide overview" button (`layout-grid` icon). Click a tile (or peek → "Go to
  slide") to jump to that slide in the editor.
- `modals/ai-batch-review-modal.js` — add-slides batch review (below):
  `previewOnClick`, click a tile to preview with its rationale.
- `modals/ai-deck-review-modal.js` — whole-deck review (below):
  `previewOnClick` + `selectable`, so click previews and the corner checkbox
  selects for section refine.

Shared annotation layer: `ai-review-annotations.js` renders the per-slide "why
this type" line + swappable alternative-type chips (via the existing
`/api/ai/convert-slide`); only how a swapped slide is committed differs per
modal (`replaceSlide`).

## Add-slides batch review

"AI: add slides" results with N≥2 open `ai-batch-review-modal.js` *before*
anything is inserted. Shows the AI's batch rationale, per-slide why,
alternatives, and Accept / Adjust / Discard. **Adjust** re-generates
server-side from the original request + prior batch + feedback (revision mode
in `server/utils/openai/append.js`: `priorSlides` + `feedback` params). N=1
inserts directly. Insert position is computed at insert time so the review
step can't go stale. Closing the modal implicitly (Esc, backdrop, header
Close) asks for confirmation — the batch only exists in the modal until
accepted.

After insertion: `ai-added-highlight.js` flashes the new slide-list rows
(`is-ai-new`), scrolls the first into view, and fires an "Added N slides"
toast whose Review action opens the deck overview.

`/api/ai/append-slides` returns `{ slides, rationale }`; per-slide
`why`/`alternatives` are re-attached after normalization as
`_aiReasoning`/`_aiAlternatives` (normalization strips unknown slide keys;
both arrays map 1:1 by index).

## Whole-deck review + section refine

After AI deck generation the editor opens `ai-deck-review-modal.js`
(`?aiReview=1`, stripped from the URL so refresh doesn't reopen it). Wizard V2
routes re-attach `_aiReasoning`/`_aiAlternatives` before saving
(`reattachAiMeta` in `server/routes/api/ai.js`), so the review grid can show
them after the editor loads the deck.

- **Section refine**: select one or more tiles (the revision spans first→last
  selected, gaps included), describe a change, "Adjust section" →
  `/api/ai/refine-section` (`server/utils/ai/refine-section.js`). The prompt
  sees the deck summary, 2 neighbour slides on each side, the selected slides
  in full, the type catalog, and the feedback; the response replaces the range
  in place (slide count may change; editor undo covers revert).
- **Discard deck** (post-generation only): create-then-review model — the deck
  already exists, so discard moves it to the trash and navigates back.
- Real progress: `refineAllSlideGroups` reports per-group completion
  (`onGroupDone`), the wizard-v2 SSE stream emits phase `refine-progress`
  ("Wrote section 2 of 5…"), and the loading modal switches from rotating
  placeholder messages to real progress.

## Model configuration (Claude vendor)

`server/utils/llm/config.js`: default `claude-sonnet-5` for generation/fill;
the outline/plan step requests `getLlmConfig({ role: 'plan' })` →
`claude-opus-4-8`. A pinned `CLAUDE_MODEL` applies everywhere;
`CLAUDE_MODEL_PLAN` overrides the plan step separately. Other vendors ignore
`role`.

`server/utils/llm/providers/claude.js`: models with sampling params removed
(sonnet-5, opus-4.7+, fable/mythos, and any major ≥ 5) get `temperature`
omitted — sending it returns a 400; unknown future models therefore degrade to
default sampling instead of hard-failing.
