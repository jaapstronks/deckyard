# HTML escaping and `innerHTML` in the client

How user-authored text reaches the DOM safely, and why every current
`innerHTML` write in `client/` is safe. Written so the next contributor does not
have to re-classify the whole surface.

## The rule

Any user-provided text rendered into HTML must be **escaped** or passed through
the **sanitizer** — never interpolated raw into an HTML sink (`innerHTML`,
`insertAdjacentHTML`, `outerHTML`). The sanctioned tools:

- **`esc()` / `escapeHtml()`** — `shared/slide-types/helpers.js`. HTML-escapes a
  string. Use for single values interpolated into a template.
- **`markdownToSafeHtml()`** — `shared/markdown.js`. Renders markdown and runs
  the result through `sanitizeHtmlSync()` (`shared/sanitize.js`). This is the
  only sanctioned path for rich text.
- **`h()`** — `client/lib/dom.js`. Builds DOM from data; text passed as
  `{ text }` or children becomes text nodes, never markup. Prefer this over an
  `innerHTML` template when the content is data-driven.

Do not hand-roll a new HTML sink for user data. If you need markup from
untrusted input, it goes through `markdownToSafeHtml()` or `h()`.

### The precondition: a DOMPurify instance must exist

The sync sanitizers (`sanitizeHtmlSync`, `sanitizeSlideHtmlSync`,
`sanitizeInlineSync`) cannot load DOMPurify themselves — loading it is async. In
the browser the page loads the vendored bundle (`client/index.html` →
`client/app.js`). **In Node every process that can reach a render path must call
`initSanitizer()` at boot** — `server/server.js` and `server/mcp/index.js` both
do.

Without it the sanitizers fall back to escaping. That is safe (nothing unsafe is
injected) but wrong-looking: the slide renders its own markup as visible text.
The fallback warns once per process so the miss is diagnosable from a log; the
uninitialized path is pinned by `tests/sanitizer-fallback-path.test.js`.

## Why `innerHTML` is still used in places (and is safe)

A full sweep of `client/` (B8) classified every `innerHTML` occurrence. The
counts below are a snapshot; the **categories** are the durable part — a new
write is safe only if it falls into one of them.

| Category | What it is | Why safe |
|---|---|---|
| Clears (`= ''`) | Emptying a node before re-render | No markup written |
| Comparisons (`=== ''`) | Reads, not writes | Not a sink |
| Static SVG / entity strings | Icon markup, `&larr;`, `&#8942;` — string **literals** in source | No runtime data; author-controlled constants |
| Icon maps | `ICONS[name]`, `VIEW_ICON[mode]`, `dom/icons.js` `svg.innerHTML` | Values are module-level static SVG constants, keys are internal enums |
| `escapeHtml`-guarded interpolation | e.g. `app.js` fatal screen, `share-viewer/guest-join.js` email confirmation | Every interpolated value passes through `escapeHtml()` first |
| `markdownToSafeHtml` output | `notes/index.js`, `presenter/console.js` speaker notes | Sanitized by the sanctioned renderer |
| Round-trip / parse buffers | `inline-edit/inline-editor.js` restore (`el.innerHTML` captured then restored), `slide-authoring/markdown-serialize.js` scratch div | Restores the element's own prior trusted DOM, or parses into a **detached** node never attached to the page |
| Slide-render contract boundary | `lib/slide-runtime/slide-render.js` parsing `renderSlideHtml()` output | Per **`AGENTS.md`**, escaping is the slide-type's responsibility at render time; this is the sanctioned handoff |
| Self-escaping renderer | `modals/json-debug-modal.js` `renderSchemaAsHtml()` | Escapes `& < >` before applying its mini-markdown transforms |
| Intentional trusted HTML | `settings/email-templates/actions.js` template preview | Server-generated, admin-only; rendered verbatim by design (re-verified, see below) |

The last row is the only one whose safety rests on an authorization claim rather
than on escaping, so it was re-checked in full (2026-08-04):

- `POST /api/admin/email-templates/:type/preview` is gated on `user.isAdmin`
  before any branch dispatches — `server/routes/api/email-templates.js:55-63`,
  covering every path under `/api/admin/email-templates`. `isAdmin` here is the
  instance-wide role, not an organization role.
- `buildPreviewHtml()` escapes the greeting (via `emailWrapper`), the button
  label and URL (via `emailButton`) and the footer. Exactly one field, `body`,
  is interpolated raw — deliberately, because the shipped defaults themselves
  contain markup (`<strong>{inviter}</strong>`). Its `{placeholder}` values in
  preview mode are hard-coded sample data.
- The only writer of `body` is `PUT /api/admin/email-templates/:type/:locale`,
  behind the same instance-admin gate, into an instance-global store. Writer and
  reader therefore hold identical privilege. That is what distinguishes this from
  the comment `author_email` leak, where an unprivileged guest wrote into a
  privileged reader's view — the shape that made *that* one a real vector.

## The gate

`tests/no-unsanitized-innerhtml.test.js` keeps the classification above true.
It scans every non-vendor `.js` file under `client/` and fails on any `innerHTML`
assignment whose right-hand side is not a single string or template literal
without interpolation or concatenation — unless the site is on the test's inline
allowlist with a written verdict.

The allowlist is grouped by the argument that justifies each entry:

- **`USER_TEXT_SITES`** — the six places where the value derives from text a
  person typed, and escaping or sanitizing is the only thing making them safe.
  A seventh entry is a security decision; a separate assertion pins the count at
  six so growing it is a visible, reviewable edit.
- **`INDIRECT_STATIC_SITES`** — icon-map lookups and static-SVG ternaries: no
  runtime data, only a literal the mechanical rule cannot see past.
- **`DOM_ROUNDTRIP_SITES`** — detached parse buffers, the cancel-edit restore,
  and the `renderSlideHtml()` contract boundary.

A second assertion fails on **stale** entries, so a site that moves or is
converted to `h()` takes its verdict with it instead of leaving a standing
exemption. Entries match on the whole normalized right-hand side, which means
broadening the expression expires the entry rather than silently inheriting its
verdict.

Adding client code: prefer `h()` and you need no entry at all. If it must be
`innerHTML`, route the value through `escapeHtml()`, `markdownToSafeHtml()` or
`sanitizeHtml()` — not a fourth mechanism — and add an entry stating which.

### The one genuine XSS that was fixed

Slice 1 (PR #370) found exactly **one** real vulnerability: the slide-list
**drag ghost** interpolated the slide title (user-authored) raw into an
`innerHTML` div appended to `document.body`, so a slide titled
`<img src=x onerror=…>` executed on drag — a cross-user vector in a shared deck.
It plus two lower-risk editor sinks (`json-debug-modal.js`, `import-slides-tab.js`)
were converted to `h()`.

## Adding new client code

- Data-driven markup → `h()`.
- A single user value in a template → wrap it in `escapeHtml()`.
- Rich text → `markdownToSafeHtml()`.
- A static icon → a string literal or an icon map is fine; don't convert
  existing static SVG to nested `h()` calls just to avoid `innerHTML` — that adds
  noise without a security gain. "Safe" here means *verified escaped*, not
  *`innerHTML`-free*.
