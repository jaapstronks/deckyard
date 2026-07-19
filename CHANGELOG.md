# Changelog

Notable changes to Deckyard. The format follows
[Keep a Changelog](https://keepachangelog.com/); given the project's pace,
entries are grouped per release rather than exhaustively listed.

## [Unreleased]

### Added

- **Custom slide types: a full template syntax reference.** The template field
  had a one-line hint naming four directives; `raw`, `bgClass`, `else`,
  `this`/`this.key` and `@index` existed in the compiler but appeared nowhere in
  the UI. It is now a collapsible reference covering every directive, plus the
  type's own field names as ready-to-paste `{{key}}` chips that update as you
  add or rename fields.

- **Custom slide types: drag-to-reorder in settings.** The `sortOrder` column
  had been read since it was added but never written, so the grid's order was
  effectively arbitrary. Cards are now draggable (the drop point is computed for
  the wrapping grid, so a row break lands where you expect), and the ⋮ menu
  gained "Move earlier" / "Move later" so reordering is reachable from the
  keyboard. Backed by a new `PUT /api/custom-slide-types/reorder`.

- **Required slide fields are flagged in the form.** A field a slide type
  declares `required` now carries an asterisk and `aria-required`, and turns red
  with "This field is required." once you leave it empty — previously that only
  failed server-side on save, as a toast that did not say which field. It stays
  quiet until a field has been visited, and clears on the first keystroke. Most
  useful for custom slide types, whose fields are author-defined.


- **"Someone worked on your deck" notifications, bundled.** When a collaborator
  adds slides to a deck you own or collaborate on, you now get one bundled bell
  notification instead of silence (previously deck edits only surfaced in the
  Activity feed). It coalesces per editor within a 60-minute window
  (`DECK_ACTIVITY_NOTIFY_WINDOW_MIN`): 40 edits in an hour is one unread
  "added N slides to <Deck>", not 40. Your own edits never notify you, and
  muting a deck (or `mentions_only`) opts out. See
  `docs/reference/comments-and-notifications.md`.

- **Video slides export to PDF as a "watch online" placeholder.** A video
  can't play in a PDF, so the server-rendered PDF export now renders a video
  slide as a laptop-framed still (with a play badge) plus deck-language copy
  and a live watch URL. The URL is resolved server-side: a deep-link into the
  published deck at that slide when the deck is published and a public base URL
  (`APP_URL`/`DOMAIN`) is set, otherwise the video's own provider URL
  (YouTube/Vimeo/Bunny). Autoplay follows the slide's own setting. See
  `docs/reference/video-slide-pdf-export.md`.

- **Home: a two-column canvas with a "from others" activity rail.** The Home
  view now opens with a full-width greeting over two columns: the main column
  carries the returning user's top job (resume recent work) plus discovery and
  a de-emphasized create affordance, and a persistent right rail carries the
  activity feed, so awareness is no longer buried at the bottom of a long
  scroll. The feed shows other people's activity instead of your own comments,
  and collapses consecutive same-person, same-deck events into one line with a
  count ("Heleen commented on X · 3"). Section headers gained an optional badge
  override so the rail reads "12 new" rather than the deck-oriented
  "N presentations". Collapses to a single column on narrow viewports. First
  phase of the Home redesign; no backend changes.

- **Home: a "building blocks" shelf and a consolidated Presentations view.**
  Phase 2 of the Home redesign. The theme-picker "start something new" zone in
  the main column became a shelf of reusable **building blocks** - slide
  collections (team first) plus recent team slides, with a dashed
  "Blank presentation" card always present; clicking one opens the creation
  view pre-seeded (a collection fills the compose tray, a loose slide seeds it
  directly). Separately, the sidebar collapsed from nine items to six: Recent,
  Workspace, My presentations and Shared-with-me merged into one filterable
  **Presentations** view with scope chips (All · Mine · Workspace · Shared,
  live counts), a sort control and a tag filter, all over a single list.

- **Home: a slide preview thumb next to comments in the "from others" rail.**
  When someone comments on a slide, the rail now shows a small live preview of
  that slide under the comment text, so you can see what they're pointing at
  without opening the deck. Rendered client-side with the same slide renderer
  the presentation cards use — no server-side image generation. Completes the
  Home redesign (phases 1-3).

- **Activity: "added N slides to a deck" now shows in the feed.** Adding slides
  to a deck used to disappear into a generic "updated" event (and only for
  workspace decks); it now records a dedicated `slide.added` event, bundled per
  save ("Riley added 3 slides to X"), for decks of any scope. The feed still
  filters by read access, so it only surfaces to people who can open the deck,
  and never echoes your own edits back to you. Makes the "from others" rail and
  the Activity view read as real collaboration rather than vague churn.

- **Home: comment text in the "from others" rail, and no empty Popular badge.**
  The activity rail now shows the comment body under the who-did-what line
  (the event data already carried a ≤100-char preview, so client-only). Popular's
  section header no longer renders a meaningless "0 presentations" badge on its
  curated top-few strip.

- **Home: a "New to you" badge on unused team building blocks.** Phase 3 of the
  Home redesign. A subtle corner badge now flags team-scope collections and
  reusable slides on the building-blocks shelf that you have never started a
  deck from; it clears (for you) after first use. Tracking is per-user: a new
  `slide_library_usage` store records when you use a library slide or collection
  as a starting point. Both v1 paths count - composing a deck from the library
  (recorded server-side on create, so MCP/agent composes are tracked too) and
  inserting a library slide into an existing deck. Personal items you made
  yourself never get the badge.

- **Image-text: optional two text columns in the row and duo layouts.**
  A new `textColumns` enum (1/2) on the image-text slide breaks the body
  into two balanced text columns while the composition stays one story -
  one title, one body field. The layout-switcher popover gains a
  "1 column / 2 columns" segmented toggle next to the mirror toggle,
  driven by a JSON-safe `layoutTextColumns` declaration on the type
  definition (forks control their own; the toggle only appears in the
  layouts it applies to). The same enum doubles in the Layout settings
  section, matching the existing double-control design. Outside the
  row/duo layouts a remembered value stays inert, so a split slide never
  inherits phantom columns; the auto-density runtime detects two-column
  overflow sideways (spillover flows into a cut-off extra column) and
  steps the text size down. Bijvangst from the phase-3 review: the
  popover toggles now guard against slides without a content object.
  5 new tests; browser-verified end to end including undo granularity,
  persistence and both export paths.

- **Image-text layout catalogue, phase 3: cross-type tiles, the mirror
  toggle and polish.** The layout switcher now crosses the type boundary
  in both directions. On image-text a new "Own text per column" tile
  converts to content-columns through the shared convert seam: each image
  becomes a column (per-image alt/fit/focus move along, item 0 keeps its
  slide-level fallbacks) and a flat-list body is distributed one bullet
  per column (extras collect in the last column; any other body lands
  whole in column 1). The text slide declares the full series the other
  way around: its own one/two-column tiles plus all seven image variants
  as cross-type tiles into image-text (convert + variant set in one
  click, one undo step). The popover gains an "Image left / Image right"
  toggle driven by a new JSON-safe `layoutMirror` declaration on the type
  definition (forks control their own; schematics flip live, rows stay
  put). Polish from the phase-2 review: the Images section shows a
  migrated slide's slide-level alt as a placeholder instead of a
  misleading empty field, and a per-image "Fill (crop)" now also removes
  the contain padding in single-cell layouts. Bug fix surfaced by the
  toggle (but reachable before): a row layout with a remembered
  right-hand image side pushed its media strip into a phantom second
  column. 10 new tests; browser-verified end to end including both
  export paths.

- **Image-text layout catalogue, phase 2: image rows, duo layout and the
  `images[]` migration.** The image-text slide now carries up to three
  images in a canonical `images[]` field (per-image alt, fit and focus);
  the legacy flat `image` keeps rendering identically and migrates into
  `images[0]` the first time the editor touches the slide, with the
  slide-level alt/fit/focus staying live as item-0 fallbacks (alt
  translations survive). Three new layout variants join the switcher:
  a row of 2-3 equal-height image cells above or below the text (the
  number of images sets the columns) and a duo of two images stacked
  beside the text (width series and mirroring keep applying). The WYSIWYG
  media popover works per cell (clicking an empty cell creates its item
  on the spot), and a new "Images" section in the inspector and form adds
  per-image alt/fit/focus, reordering and the row's third image. The AI
  catalogue, insert-picker preset ("Image row"), convert seam
  (image-slide → image-text now lands in `images[0]`; a filled `images[]`
  warns as lossy towards content-slide) and both export paths moved
  along; the export image-inliner learned to walk items arrays, which
  also fixes gallery images never being embedded in standalone HTML.
  Collab needs no codec change (items arrays are schema-driven).
  12 new tests; browser-verified end to end.

- **Image-text layout catalogue, phase 1: width series, corner layout and a
  layout switcher.** The image-text slide's width enum gains `wide` (63%);
  the existing `narrow` (37%) doubles as the catalogue's 1/3 split, so no
  fourth value or data migration was needed. A new `layout` enum adds the
  corner variant: the image sits only in the top corner and the space below
  stays deliberately empty (mirrors via the existing image-position toggle,
  which stays orthogonal to the variants). A new "Layout" chip in the slide
  toolbar opens a tile popover with mini-schematics per variant - current
  variant marked, one click switches while the content stays put, one undo
  step per switch. The "Text without image" tile is the zeroth variant and
  runs through the phase 0 convert seam. Variants are declared on the
  slide-type definition (`layoutVariants`, JSON-safe, served via
  `/api/slide-types`), so forks that override the type by name control
  their own set. Insert-picker presets, inspector enums (deliberately
  doubled), the AI catalogue (including a "little text room" hint for wide
  and corner) and both export paths (pdf-slides, standalone HTML) moved
  along; browser-verified end to end.

- **Add/remove an image directly in the WYSIWYG editor.** A text slide gets
  a "+ Add image" chip on the edit canvas: clicking it turns the slide into
  an image-text slide (same id, notes, comments and URL) and opens the media
  popover on the fresh placeholder. On an image-text slide, an empty image
  placeholder gets a hover-× that removes the reserved image area and turns
  the slide back into a text slide; a filled image must be cleared first, so
  removal is a deliberate two-step. Both affordances run through the existing
  convert seam, are declarable by custom slide types, and the lossy-fields
  confirm no longer fires on enum defaults (only on real content such as a
  filled image, caption or alt text). Phase 0 of the image-text layout
  catalogue.

- **Comments in the public API v1 + MCP write tools.** Agents/scripts with
  an API key can now read reviewer comments and respond to them: new
  endpoints `GET/POST /api/v1/presentations/:id/comments` and
  `POST /api/v1/comments/:id/status` behind new key scopes `comments:read`
  and `comments:write`; new MCP tools `add_comment`, `reply_to_comment` and
  `set_comment_status` (core tool count 24 → 27). Comment payloads carry
  current slide context, a `slideSnapshot` of the slide as it was when the
  comment was created (migration 041, `null` for older comments), a `since`
  filter and an `editUrl` deep link anchored to the commented slide. MCP
  edit links also got fixed to point at the real editor route (`/app/:id`;
  `/edit/:id` never existed). See `docs/reference/comments-api.md`.

- **Selected slide in the editor URL.** Navigating slides in the editor (and
  the view/comment viewer) now updates `?slideId=` via `replaceState`, so a
  refresh reopens the same slide and a copied URL is a shareable deep link
  to that slide. No history entry per slide; the deck language param is
  preserved.

- **Unified Background section in the slide form.** Background colour, custom
  background image (with focus/fit/overlay) and the theme corner logo now
  live in one "Background" section, instead of a loose colour dropdown at the
  top plus a separate collapsed "Background & logo" panel. Open by default
  (sticky per user). Also fixes the freeform slide's custom-colour input,
  which never rendered because the colour field renderer wasn't passed
  through to the form.
- **Logo wall: up to 30 logos, background colour.** The cap was 12; beyond 12
  the grid switches to fluid 7/8-wide columns so any count lays out cleanly,
  and small counts keep rendering larger (the 11-12 tier got a slight size
  bump). The slide also gained the standard background colour option
  (defaults to its historical mist look; theme background variants work too).

- **Editor loading skeleton.** Opening a deck used to show a blank white
  page until everything was fetched (seconds, on long decks). The editor
  route now mounts a shimmer skeleton of the real three-column layout
  immediately, with a spinner + "Loading presentation…" status in the
  canvas, honoring `prefers-reduced-motion`. Loading also got faster: the
  presentation is no longer fetched twice back-to-back, and theme /
  slide-type / asset requests now run in parallel.

- **Real-time collaboration (opt-in, feature-flagged).** With
  `COLLAB_ENABLED=true`, everyone with the same deck open sees live
  presence: topbar avatars, a name label + dot on the slide each person is
  viewing (gliding along when they move), and focus rings + name labels on
  the field someone is editing. With `COLLAB_LIVE_EDITS=true` on top, the
  deck becomes a shared CRDT document (Yjs/Hocuspocus over a `/collab`
  WebSocket on the same port): edits merge live at character level,
  undo/redo is per-user, presenter notes support genuine co-typing, and
  server-side writes (AI, MCP, public API, translate, theme change) appear
  live in open editors. Slide locks are retired while the flag is on;
  autosave and conflict modals are inert (the server persists debounced).
  Both flags default off; with them off, behavior is byte-for-byte
  unchanged. Postgres installs need migration 040 (`presentation_ydocs`).
  See `docs/reference/collab-presence.md`, `collab-deck-doc.md`,
  `collab-editor-binder.md` and ADR 001.

### Fixed

- **Countdown, freeform and end slides follow the theme.** Their CSS reads
  `--t-primary`, `--t-accent`, `--t-bg-dark`, `--t-brand-1` and `--t-brand-2`,
  but no theme file and no DB theme ever emitted those tokens — so those slides
  always painted the stylesheet's hardcoded purple/teal, whatever the deck's
  theme. The tokens are now derived from the theme's accent, dark surface and
  brand palette, and a theme that sets one explicitly still wins. **Visible
  change**: existing decks using a countdown/freeform slide on the extended
  background options (`accent`, `brand-1`, `brand-2`, `dark`) will change
  colour, as will the freeform editor's outline and handles.

- **One theme normalizer instead of two.** `normalizeTheme` existed as
  near-identical private copies in `client/lib/theme.js` and
  `server/utils/themes.js`, and had drifted: the client copy never gained the
  table-variant contrast derivation, so a themed table could read fine in an
  export and be unreadable in the editor. Both now import
  `shared/theme-normalize.js`. It also parses 3-digit hex on the client, which
  only the server handled before.

- **Icon-card "tiles" layout fills its grid again.** Tiles collapsed to small
  squares stranded at the top of the slide, showed a number prefix, and never
  rendered the per-card body text. The cards-layout row rules were not scoped to
  the cards layout, the always-rendered spare cards still claimed grid cells, and
  the square's size was derived circularly from its own row. Tiles now size from
  an explicit per-count column width, drop the numbering (which also leaked into
  the inline-editable title), show the body text under a centred title, and the
  cards layout is unchanged.

- **Icon cards no longer render blank cards from padded data.** Decks authored
  outside the editor sometimes pad `items[]` to a fixed length; trailing empty
  entries are now ignored instead of rendering as empty cards.

- **Comments: "This slide" no longer shows the whole deck.** On a deck with no
  slides — or in the moment before the first selection lands — the slide-scoped
  request went out unscoped and came back with every comment in the deck, under
  a switch that still read "This slide".

- **Standalone HTML export renders its fonts offline.** A downloaded deck still
  linked the shared UI font (Bricolage Grotesque) from `/assets/fonts/*.woff2`,
  so opening the file without a server fell back to system fonts (theme fonts,
  icons, and images were already embedded). The export now inlines the local
  font files it references as base64 data URLs — only the handful of small
  weights actually used (a few KB each), never the whole ~2.5 MB font library.
  See `docs/reference/standalone-html-export.md`.

- **Bilingual library slides keep both languages on database installs.** A slide
  saved to the library with NL + EN content (`i18n.versions`) silently lost its
  per-language content on Postgres (and, it turned out, on the active file
  adapter too) — composed decks fell back to single-language content. The
  storage layer now persists and returns `i18n` on both backends
  (migration `049`, no backfill needed).

- **@mentions render as inline chips everywhere, not raw markup.** A mention is
  stored in a comment body as `@[Name](user:email)`; the editor thread already
  showed it as a chip, but the share viewer, preview lightbox, and the
  activity-feed / home-rail previews leaked the raw marker. They now render the
  same subtle chip (via a shared renderer), and the server strips the marker to
  plain `@Name` in activity previews before truncation.

- **Placing a comment on a slide now works anywhere, and the affordance is
  visible.** "Add comment" is a labeled toolbar button (was a bare, easily
  missed pin glyph). In placement mode the inline WYSIWYG editor yields its
  click so a pin lands anywhere on the slide - including over editable text,
  which previously swallowed the click and started a text edit, so pins could
  only be dropped in the margins. The placement hint moved to an overlay
  banner on the slide (it used to wrap inside the toolbar row and unbalance
  it), and the positioned-comment composer got its missing styling (it had
  collapsed to a near-invisible bare textarea).

- **Stale browser tabs can no longer silently overwrite other users' work.**
  A tab that slept through remote saves (laptop lid, offline) used to
  autosave its days-old copy straight over newer edits: the slide-level
  merge let the stale client win per slide, adopted its slide order
  wholesale, and reported nothing. Fixed in two rounds (#45, #46):
  - a staleness cap on the merge route (`MERGE_MAX_REVISION_GAP`, default
    10) falls back to the existing 409 + conflict modal;
  - per-slide conflict detection via base fingerprints
    (`X-Slide-Base-Fingerprints`): a slide changed on both sides since the
    client's base now 409s with `conflictingSlides` instead of
    last-writer-wins;
  - the merge only applies the client's slide order when the client
    actually reordered (`X-Slides-Order-Changed`); otherwise the server
    order is authoritative — slides added by others stay at their position
    instead of being appended, client-new slides are woven in next to
    their neighbour;
  - waking tabs refresh themselves: on tab-visible/focus/online the editor
    probes the new lightweight `GET /api/presentations/:id/revision`
    endpoint and silently adopts the server state (clean) or saves through
    the normal merge/conflict flow (dirty) before the user can type into
    stale content;
  - every performed merge is audited as a `presentation.merged` activity
    event, and a merge by a client more than one revision behind first
    writes an automatic `pre_merge` snapshot to the version history for
    one-click restore.

- **Security: Home/overviews no longer leak decks without view access.**
  Three related fixes, all enforcing the same invariant (a deck card — title
  + first-slide thumbnail — is only visible when the user could also open
  the deck): (1) `GET /api/presentations` (and search) no longer shows
  ownerless "legacy" decks to every authenticated user; (2) the popular rail
  no longer surfaces private-but-published decks with dead links into the
  app view; (3) the activity unread badge now counts only events on decks
  the user can read (a fresh user used to see an org-wide count). The same
  legacy exception was removed from the public API's listing filter.

- **Security: per-deck authorization for machine clients (MCP + public
  API).** MCP tools that fetch a deck by id performed no per-deck check at
  all: any configured MCP session (or any API key, via the SSE transport)
  could read, edit or delete any deck by id. And the public API used an
  owner/workspace-only check with no read/write distinction that ignored
  the collaborator table. Both surfaces now use the same collaborator-aware
  `canRead`/`canWritePresentation` checks as the editor routes.
  **Breaking for integrations that leaned on the old, too-permissive
  behavior:**
  - API keys can no longer *write* to workspace decks that are view-only or
    starter kits, nor to private decks of other users (previously possible
    whenever the deck had `scope: workspace`, and via MCP for any deck).
  - MCP `delete_presentation` is now owner-only.
  - API keys of collaborators (view/comment/edit/admin) now get access to
    decks shared with them, matching their permission level — reads that
    previously returned 403 now succeed.
  - Unchanged: stdio MCP without `DECKYARD_MCP_OWNER_EMAIL` remains a
    trusted local session (no per-deck checks), and per-deck *listing*
    (`GET /api/v1/presentations`) still returns owned + workspace decks.
- Presentation owners can delete any comment on their own deck (#1)

### Changed

- **Home loads in a single request.** A new `GET /api/home` endpoint
  aggregates everything the Home view used to fetch separately after mount
  (popular presentations, the "from others" activity feed, the building-blocks
  shelf's collections and team slides, and your library-usage set) into one
  round-trip. The individual endpoints stay available for API/MCP callers, and
  the Home view falls back to them per section if the aggregate ever fails.
  No visible change; the phase-3 close-out of the Home redesign.

- **Editor chrome re-organized: slide-scoped vs. deck-scoped.** The right
  rail is now driven by an always-visible labeled pane switcher
  (Inspector / Comments) at the far right of the toolbar above the canvas;
  presenter notes live in a collapsible strip directly under the slide
  (Keynote / PowerPoint convention, with the Notes-QR companion flow in
  its header), filling the space beneath the 16:9 stage and reclaiming the
  full height when collapsed. Everything about
  the current slide (type chip, "All text", lock, the slide actions menu)
  sits in a toolbar above the canvas; the topbar keeps deck-level actions,
  with Companion tucked into a Present split-menu and utilities (AI
  analysis, settings, shortcut help) in the ⋯ menu. The legacy
  "collapse slide panel" mode - which could trap the editor in a
  super-wide inspector - is gone, removing a card in an icon-cards slide
  really removes it (a stale legacy count kept a ghost slot), and the
  "Edit all text" modal got substantially roomier.
- **The editor is now wysiwyg-first.** The slide canvas covers all content
  editing in place: inline text everywhere, add/remove of repeatable items
  (including text-blocks rows and blocks), drag-reorder via an overlay grip,
  and adding a first image to an empty slot. A new **"Edit all text" modal**
  shows every content field in one list next to a live preview, with
  prev/next navigation across the deck. The old form column became a slim
  **Inspector** on the right: a toggleable rail with a settings pane
  (background, layout/variant enums, accessibility; no more content text
  fields) and a comments pane that replaces the separate comments slide-over
  and the thread list under the slide. Below 1100px the editor converges on
  two columns with the inspector as a full-width row under the canvas.
  Slide locks are now also enforced server-side (423 on content writes to a
  locked slide). See `docs/reference/editor-inspector.md`.
- Stock background photos replaced with generated demo gradients
- CI and Docker on Node 22 (matches `engines`)

### Security

Pre-untrusted-exposure hardening pass (nine changes). Safe in the intended
self-hosted-behind-a-proxy, authenticated deployment already; these close
default-config foot-guns that matter the moment untrusted users are allowed.
See `SECURITY.md` for the deployment-facing summary and env vars.

- **Auth no longer fails open (BREAKING).** A deployment with no `AUTH_SECRET`
  used to run wide open with anonymous admin access. The server now refuses to
  start unless `AUTH_SECRET` is set or auth is explicitly disabled with
  `AUTH_ENABLED=false` (sandbox/demo modes still boot without auth). Existing
  fail-open deployments must set one of the two after upgrading.
- **Non-root container.** The Docker image runs the app and headless Chromium
  as a non-root user; Chromium's own sandbox is now opt-in via
  `PUPPETEER_SANDBOX` (off by default, since Docker's seccomp profile blocks the
  namespace sandbox). Existing bind mounts may need a one-time
  `chown -R 1000:1000 ./server/data ./server/uploads`. Also fixes a broken
  Docker build (`COPY` ordering).
- **SSRF guard on server-side render/export.** Remote images loaded during PDF
  and PNG rendering are resolved and blocked when they point at loopback,
  private, link-local or cloud-metadata addresses, for IPv4 and IPv6 including
  IPv4-mapped/compatible forms. Blocked images are stripped rather than fetched.
- **CSRF origin-check.** Cookie-authenticated state-changing requests must be
  same-origin (`Origin`/`Referer` host must match the app `Host`, `APP_URL` or
  `DOMAIN`); token and API-key clients are unaffected. Extra trusted origins via
  `CSRF_ALLOWED_ORIGINS`.
- **Login brute-force throttle** on password login, keyed per IP and per email;
  set `TRUST_PROXY=true` behind a reverse proxy so it keys on the real client IP.
- **Uploaded SVGs served inert** (`Content-Disposition: attachment`, `nosniff`
  and a script-blocking CSP) to close a stored-XSS vector.
- **`AUTH_DEV_BYPASS` gated on `NODE_ENV=development`**, so a leftover flag can
  never grant passwordless admin in staging/production.
- **Request-body size cap** (`MAX_REQUEST_BODY_BYTES`, default 25 MB) to prevent
  memory exhaustion from oversized requests.
- **Media keys confined to the uploads directory**, closing a path-traversal
  existence oracle in `/api/media/confirm`.

## [1.0.0] — 2026-07-14

### Added

- First public open-source release 🎉
- 38 typed slide types with a shared schema → render → editor pipeline
- AI deck generation, iteration, analysis and validation (BYO LLM: OpenAI,
  Claude, Mistral, DeepSeek, or any OpenAI-compatible endpoint)
- MCP server (22 tools, 6 guided prompts) over stdio and SSE
- Live presenting: speaker console, two-window presenter, audience
  follow-along with polls, Q&A and feedback
- Theming system with custom themes, custom slide types and fork-friendly
  `custom/` directories
- Exports: PDF, PPTX, standalone HTML, PNG; embed SDK
- i18n groundwork for 12 locales (en/nl fully populated)
