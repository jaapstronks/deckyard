# Deckyard Roadmap

**Deckyard's public roadmap** — a high-level view of where the project is
heading. What has already shipped lives in the [CHANGELOG](CHANGELOG.md); this
file looks forward.

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

## Next — planned features

- **Portable `.deck` roundtrip proof** — verify a real fork-to-clean-instance import with notes, languages, theme assets and a custom slide type before declaring portability complete.

## Later — directional

- **Live-session robustness** — survive presenter refresh, companion
  auto-recovery, persistent join QR, unified follow codes, linked Q&A
  moderation, poll-open affordance.
- **Share unification** — add a Live tab for presenter and audience companion links, then route the presenter Tools menu to the same dialog.
- **Concurrent-editing hardening, part 2** — follow-ups to the stale-tab merge
  guard: order-preserving merges, client refresh on focus/online so a tab never
  grows stale, and a merge audit log with pre-merge snapshots.
- **AI generation: content-based live status** — a parallel fast-model prompt
  gives content-specific progress lines within seconds, instead of a generic
  "processing" message.
- **AI: recreate a slide from an image/PDF** — attach a screenshot/PDF in the AI
  add + refine flows; recognize the slide type + content and rebuild it as a
  native, editable slide.
- **Interactive behaviors** — add gallery links, click-to-reveal, hover states, follow-sync and analytics to content blocks.
- **Forker tooling improvements** - extend fork-safe forms and inline editing, and explore packaging for custom slide types. The scaffolder, validator and shared composition primitives are already available.
- **System clipboard interop for slides** — copy/paste of slides across
  browsers, devices and Deckyard installs via the async Clipboard API: the
  in-app buffer stays the fast path, with a web custom format
  (`application/vnd.deckyard.slides+json`) plus a plain-text outline written
  to the system clipboard as a progressive enhancement.
- **SSO expansion** — add SAML alongside OIDC.
