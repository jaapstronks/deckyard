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
| Intentional trusted HTML | `settings/email-templates/actions.js` template preview | Server-generated, admin-only; rendered verbatim by design |

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
