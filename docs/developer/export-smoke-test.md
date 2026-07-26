# Export smoke test

`tests/export-chrome-smoke.test.js` is the only test in the suite that starts a
real browser. It exists because the export chain — PDF, PNG, PPTX, deck
thumbnails, the sandbox OG image, the capture recipes — runs entirely through
headless Chrome, and until this test landed nothing in CI ever launched one.
During the puppeteer-core 24 → 25 bump (#275) CI was green, and that said
nothing at all about whether export still worked; the bump was verified by
hand. A habit is not a gate.

## What it asserts

| Path | Check |
| --- | --- |
| `renderSlidesToPdfBuffer` | `%PDF-` magic, one page per slide, and extractable page text containing the slide's title and subheading |
| `renderSlideToPngBuffer` | PNG at 3200×1800 (1600×900 at `scale: 2`), and non-blank: ≥ 64 distinct colours with no single colour covering ≥ 98% of the frame |
| `buildPptxBuffer` | a real zip container holding `ppt/slides/slide1.xml` plus a non-trivial embedded media image |
| `renderSandboxOgImagePng` | a 1200×630 PNG that is likewise non-blank |

Both render functions are also asserted to return a Node `Buffer`. That is not
pedantry — see [Why the Buffer assertion](#why-the-buffer-assertion) below.

"Non-blank" is checked by counting distinct RGB values and the share of the
most common one. A blank frame collapses to a single colour covering
everything; a rendered slide spreads over hundreds of colours through
antialiasing alone. A byte-length check would not catch a white page.

## What it deliberately does not assert

It does not catch a *silent visual* regression — a webfont failing to load and
falling back to a system font, a gradient quietly disappearing. Catching that
needs pixel comparison against recorded baselines, which is a separate decision
(form 2 of the B14 planning item). Pixel comparison is notoriously brittle
across platforms: the ubuntu CI runner rasterises differently from a Mac, so
the baselines would have to be produced in CI or the test is red by
construction. Form 1 — "Chrome starts and produces a real, non-empty
PDF/PNG" — is far more coverage per line, and it is what ships here.

## How Chrome gets into CI

`puppeteer-core` deliberately ships **without** a browser; that is the whole
difference from `puppeteer`. So a browser has to come from somewhere, and that
missing step is the reason this gap existed in the first place.

**The choice made here:** `.github/workflows/ci.yml` installs the exact Chrome
build that the *installed* `puppeteer-core` pins, via `@puppeteer/browsers`,
and exports the resulting path as `PUPPETEER_EXECUTABLE_PATH`:

```yaml
- name: Install Chrome for the export smoke test
  run: |
    set -euo pipefail
    CHROME_VERSION="$(node -e "import('puppeteer-core').then(m => console.log(m.PUPPETEER_REVISIONS.chrome))")"
    INSTALL_LOG="$(npx --no-install @puppeteer/browsers install "chrome@$CHROME_VERSION" --path "$RUNNER_TEMP/chrome")"
    CHROME_PATH="$(printf '%s\n' "$INSTALL_LOG" | tail -n1 | cut -d' ' -f2-)"
    test -x "$CHROME_PATH"
    echo "PUPPETEER_EXECUTABLE_PATH=$CHROME_PATH" >> "$GITHUB_ENV"
```

Why this one:

- **It tracks the dependency, not the runner.** Bumping `puppeteer-core`
  automatically pulls the Chrome that version expects, so the smoke test
  exercises the exact pairing that broke trust in #275.
- **No extra dependency, no third-party action.** `@puppeteer/browsers` is
  already installed as a `puppeteer-core` dependency, so `npx --no-install`
  finds it after `npm ci`.

Alternatives that were rejected:

- **Rely on the preinstalled system Chrome** at `/usr/bin/google-chrome` on the
  ubuntu runner image. Zero config, and `resolveChromeExecutablePath()` would
  find it — but it is an implicit dependency on the runner image's contents,
  and its version drifts independently of `puppeteer-core`, which defeats the
  point.
- **`browser-actions/setup-chrome`.** Convenient, but it adds a third-party
  action to the supply chain for something a first-party dependency already
  does.

## Running it locally

```sh
node --test tests/export-chrome-smoke.test.js
```

It uses whatever Chrome or Chromium `resolveChromeExecutablePath()` finds:
`PUPPETEER_EXECUTABLE_PATH` or `CHROME_BIN` first, then the usual
Linux/macOS/Windows install locations. To pin the same build CI uses, run the
snippet above and export the path yourself.

Two rules about skipping:

- **Locally**, the tests skip when no browser is installed, so a contributor
  without Chrome does not get a false red.
- **In CI** (`CI` is set), a missing browser is a hard failure. A smoke test
  that silently skips itself is worse than no smoke test.

Run it in a **normal checkout, not a git worktree**. `assets/fonts/google/` is
gitignored and populated by the `postinstall` hook, so a fresh worktree has no
font assets and the export tests go falsely red.

## Why the Buffer assertion

Writing this test surfaced a live bug, which is the clearest argument for
having it.

Puppeteer's `page.pdf()` and `page.screenshot()` return "a Buffer or a
Uint8Array depending on the environment". Concretely, `stringToTypedArray()`
prefers `Uint8Array.fromBase64()` when it exists and only falls back to
`Buffer.from()` otherwise. `pdf-parse` loads pdf.js, and **pdf.js polyfills
`Uint8Array.fromBase64` on load** — so once a PDF has been imported, every
subsequent render in that process comes back as a plain `Uint8Array`.

A plain `Uint8Array` has no base64 `toString()`. So `bytes.toString('base64')`
in the PPTX export produced `"137,80,78,71,…"` instead of image data, and the
export died deep inside the zip writer with `Invalid base64 input, bad content
length` — meaning **PPTX export silently broke for the rest of the server
process after any PDF import**. Node will eventually ship `fromBase64`
natively, at which point the failure becomes unconditional.

The fix is `toNodeBuffer()` in `server/utils/puppeteer-browser.js`, applied at
every point where bytes leave Puppeteer. The smoke test keeps it honest twice
over: it asserts the return type directly, and it runs the PPTX case *after*
the PDF case in the same process, so the poisoned-globals path stays covered.
