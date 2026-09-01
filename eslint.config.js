// Flat ESLint config (ESLint 9+). The repo has no bundler; this is the first
// linter it has ever had. Two intents live here:
//
//   1. A GATING baseline (this file, run via `npm run lint`): high-signal rules
//      that catch real bugs — unused vars, undefined refs, duplicate keys,
//      unreachable code. Kept green so CI can block regressions.
//   2. A DISCOVERY pass for dead exports + import cycles lives in
//      `eslint.deadcode.config.js` (run via `npm run lint:deadcode`). It
//      over-reports on dynamically-loaded entry points (routes, migrations,
//      registries), so it is advisory only and never gates CI.
//
// See docs/developer/linting.md for the rationale and the triage workflow.

import js from '@eslint/js';
import globals from 'globals';
import importX from 'eslint-plugin-import-x';

// Every `t()` call must carry its English fallback: `t(key, fallback)`.
// The fallback is what Tier-2 locales degrade to when a key is missing
// (client/lib/ui-i18n.js) — the whole reason tiering is safe. Written as
// `t(key)` alone, a missing key renders the raw key string instead of
// English, which is the one way that safety net breaks. See
// docs/reference/i18n-locale-tiers.md.
//
// Hoisted into a const because flat-config rule entries replace rather than
// merge per rule name: the overlay-gate burndown block below must re-state
// these when it drops the overlay-class restriction, and a drifted copy would
// silently un-gate t()/fetch()/control-class for those files.
// Node builtins are imported with the `node:` prefix, always.
//
// Both spellings resolve, which is exactly why the repo grew both: four i18n
// scripts wrote `node:fs`, two wrote `fs`, and side by side the difference
// looked like it meant something. It does not — it is a second spelling for one
// meaning, the shape B147 exists to remove. The prefix is also the unambiguous
// one: `fs` is a package name a dependency could take, `node:fs` cannot be
// anything else.
//
// Listed rather than derived from `module.builtinModules` so the rule reads as
// a decision and a new entry is a deliberate line in a diff. Hoisted into a
// const because flat-config rule entries replace rather than merge per rule
// name: the zod block below restates these alongside its own path, and the
// schemas directory it exempts needs its own copy.
const nodeBuiltinImports = [
  'assert',
  'buffer',
  'child_process',
  'crypto',
  'dns',
  'events',
  'fs',
  'http',
  'https',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'timers',
  'tls',
  'url',
  'util',
  'worker_threads',
  'zlib',
].map((name) => ({
  name,
  message: `Import Node builtins with the node: prefix — 'node:${name}'.`,
}));

// The subpath spellings ('fs/promises', 'timers/promises', …) resolve bare
// too, and `paths` matches exact specifiers only — without this a bare
// subpath import would slip past the rule the list above exists to enforce.
const nodeBuiltinImportPatterns = [
  {
    group: nodeBuiltinImports.map(({ name }) => `${name}/*`),
    message: "Import Node builtins with the node: prefix — 'node:<name>/…'.",
  },
];

// --- The silent-failure gate (B106/B111, extended to the client by B150) ---
//
// A failure that lands in an empty catch is the one thing you cannot debug:
// no log line, no stack, no trace that anything went wrong. On the server
// that risks an invisible broken background job; on the client it is worse —
// a client-side failure in a beta product is exactly what a bug report cannot
// reconstruct, and at the point this gate arrived ~270 of 849 client catch
// sites swallowed without a stated reason.
//
// Three shapes of the same swallow, hence three selectors:
//   1. `.catch(() => {})` — the silent *promise* swallow.
//   2. `try { … } catch {}` — the silent *sync* swallow. The selector matches
//      on the AST, so a comment-only body (`catch { /* ignore */ }`) is still
//      empty: a bare "ignore" states no reason, which is the drift this gate
//      exists to stop. A real reason is a body that records the failure, or
//      an eslint-disable with a reason after the `--` separator.
//   3. `void doThing()` — the *absent* catch: discards the promise without
//      attaching anything, so a rejection is unhandled. (On the server,
//      under Node's default --unhandled-rejections=throw, that kills the
//      process — strictly worse than hiding the error. It was also a false
//      signal half the time: 16 of the 50 sites B111 retired applied `void`
//      to a synchronous call, where there was no promise to discard.)
//
// The selectors are shared between the two variants below so the two sides
// cannot drift apart on what counts as a swallow; only the remedy in the
// message differs, because the helpers live in different trees
// (server/utils/fire-and-forget.js vs client/lib/dom/disposal.js +
// client/lib/util/debug.js). Hoisted into consts because flat-config rule
// entries replace rather than merge per rule name: the exemption blocks
// below re-state their rule lists, and a drifted copy would un-gate this.
const emptyPromiseCatchSelector =
  "CallExpression[callee.property.name='catch']" +
  '[arguments.0.body.body.length=0]';
const emptyTryCatchSelector = 'CatchClause > BlockStatement[body.length=0]';
const voidCallSelector = "UnaryExpression[operator='void'] > CallExpression";

const serverSilentFailureRules = [
  {
    selector: emptyPromiseCatchSelector,
    message:
      'Empty .catch(() => {}) swallows the rejection without a trace. Use ' +
      'fireAndForget(promise, label) from server/utils/fire-and-forget.js, or ' +
      'give the catch a body that says why the failure is ignorable (B106).',
  },
  {
    selector: emptyTryCatchSelector,
    message:
      'An empty catch {} (a comment-only body counts as empty) swallows the ' +
      'failure without a trace. Give the catch a body that records the ' +
      'failure or handles it, or an eslint-disable with the reason after ' +
      '`--` (B106/B150).',
  },
  {
    selector: voidCallSelector,
    message:
      'void doThing() discards a promise without a catch — an unhandled ' +
      'rejection can kill the process. Use fireAndForget(promise, label) from ' +
      'server/utils/fire-and-forget.js (or .catch(ignoreRejection) where the ' +
      'rejection is expected and frequent). If the callee is synchronous, ' +
      'drop the `void` — there is no promise to discard (B111).',
  },
];

const clientSilentFailureRules = [
  {
    selector: emptyPromiseCatchSelector,
    message:
      'Empty .catch(() => {}) swallows the rejection without a trace. Give ' +
      'the catch a body that records the failure — debugLog(label, err) from ' +
      'client/lib/util/debug.js at minimum — or says why it is ignorable ' +
      '(B106/B150).',
  },
  {
    selector: emptyTryCatchSelector,
    message:
      'An empty catch {} (a comment-only body counts as empty) leaves a ' +
      'client failure with no trace — the one thing a bug report cannot ' +
      'reconstruct. For disposal/teardown, call disposeAll([...]) from ' +
      'client/lib/dom/disposal.js; otherwise give the catch a body that ' +
      'records the failure (debugLog from client/lib/util/debug.js) or an ' +
      'eslint-disable with the reason after `--` (B150).',
  },
  {
    selector: voidCallSelector,
    message:
      'void doThing() discards a promise without a catch, so the rejection ' +
      'surfaces as an unhandled rejection with no context. Attach a .catch ' +
      'that records the failure (debugLog from client/lib/util/debug.js). ' +
      'If the callee is synchronous, drop the `void` — there is no promise ' +
      'to discard (B111/B150).',
  },
];

// `shared/**` runs in BOTH environments, so the remedy differs from the two
// sets above: it cannot reach for server/utils/fire-and-forget.js or
// client/lib/dom/disposal.js — neither import resolves on the other side.
// What shared/ does have is `console`, which is what its existing traces use
// (registry.js's shadow warnings, sanitize.js, custom-loader.js), plus the
// option that removed most of this tree's burndown: stop throwing in the
// first place. parseUrl() in shared/url-host.js is that shape — a throwing
// parser converted to a `null` return once, so ten call sites branch instead
// of catching.
const sharedSilentFailureRules = [
  {
    selector: emptyPromiseCatchSelector,
    message:
      'Empty .catch(() => {}) swallows the rejection without a trace. Give ' +
      'the catch a body that records the failure (console.warn with a ' +
      '`[module]` prefix, as shared/slide-types/registry.js does) or says ' +
      'why it is ignorable — shared/ runs in both environments, so the ' +
      'server and client fire-and-forget helpers are not available (B178).',
  },
  {
    selector: emptyTryCatchSelector,
    message:
      'An empty catch {} (a comment-only body counts as empty) swallows the ' +
      'failure without a trace. Prefer removing the throw: wrap the ' +
      'throwing call in a helper that returns a sentinel, the way parseUrl() ' +
      'in shared/url-host.js does for new URL(). Otherwise give the catch a ' +
      'body that records the failure (console.warn) or an eslint-disable ' +
      'with the reason after `--` (B178).',
  },
  {
    selector: voidCallSelector,
    message:
      'void doThing() discards a promise without a catch — an unhandled ' +
      'rejection kills the process on the server side and surfaces without ' +
      'context on the client. Attach a .catch that records the failure. If ' +
      'the callee is synchronous, drop the `void` — there is no promise to ' +
      'discard (B111/B178).',
  },
];

const clientRestrictedSyntax = [
  {
    selector: "CallExpression[callee.name='t'][arguments.length<2]",
    message:
      't() needs an English fallback: t(key, fallback). Without it a ' +
      'missing key renders the raw key, defeating Tier-2 fallback ' +
      '(docs/reference/i18n-locale-tiers.md).',
  },
  // Every request to our own /api/* surface goes through api() from
  // client/lib/api.js — one network layer, one error shape (A7.16
  // cluster 2; the same one-canonical-form stance as the t() rule).
  // A raw fetch( is how the second network vocabulary starts: hand-
  // rolled res.ok parsing, a second error envelope reading, no shared
  // 401/429 branching. Legitimate exceptions — streaming-body readers
  // (SSE), binary/blob downloads, presigned uploads to external
  // storage, static-asset JSON — carry an inline disable directive
  // with the reason at the call site.
  {
    selector: "CallExpression[callee.name='fetch']",
    message:
      'Use api() from client/lib/api.js instead of raw fetch() — one ' +
      'network layer, one error shape (A7.16). Genuinely raw cases ' +
      '(SSE stream, blob download, presigned upload, static asset) ' +
      'get an inline eslint-disable-next-line stating the reason.',
  },
  {
    selector:
      "CallExpression[callee.property.name='fetch']" +
      '[callee.object.name=/^(window|globalThis|self)$/]',
    message:
      'window.fetch/globalThis.fetch is still raw fetch — use api() ' +
      'from client/lib/api.js (A7.16).',
  },
  // One class name per control (A7.16 cluster 10). `form-input` is the
  // canonical text-input/select/textarea class; `.form-input` in
  // client/styles/app/components.css is the only place the control is
  // actually drawn. The rejected spellings — `input`, `select`,
  // `form-select`, `input-sm`, `form-select-xs` — were never defined as
  // control styles anywhere, so a view that reached for one shipped a
  // browser-default control next to styled neighbours. Size and role
  // modifiers keep riding along (`form-input form-input-sm font-mono`).
  //
  // Written as a syntax rule rather than a greptest because it can bind
  // to the `class:` property of an h() attrs object and match whole
  // tokens only: `input-group` or `select-all` are untouched, and the
  // error lands on the construction site instead of a file:line list.
  // Boundary: classList.add('select') / className assignment are not
  // covered — there are none, and `.add('select')` is ambiguous with
  // Set#add, so a rule there would cost false positives for no burndown.
  {
    selector:
      "Property:matches([key.name='class'],[key.value='class']) > " +
      'Literal[value=/(^|\\s)(input|select|form-select|input-sm|form-select-xs)(\\s|$)/]',
    message:
      'Use the canonical control class `form-input` (plus `form-input-sm`/' +
      '`form-input-xs` for size) — `input`/`select`/`form-select` have no ' +
      'control styling anywhere and render a browser-default control (A7.16 ' +
      'cluster 10, docs/developer/linting.md).',
  },
  // `h()` — the hyperscript element factory — has exactly one implementation,
  // `client/lib/dom.js`. It used to travel the client as a hand-threaded
  // parameter in three spellings at once: positional (`createModal(h, opts)`),
  // an opt-in option with a default (`h = defaultH`), and ~400 lines of
  // `{ h, … }` pass-through. Every module now imports it, so `h` arriving as
  // an argument is the fourth spelling starting over (A7.33).
  //
  // Whole-token by construction (`[name='h']` / `[key.name='h']`), so `height`,
  // `hue` and `hsl` are untouched, and the allowlist is empty: `client/lib/dom.js`
  // needs no exemption because the factory is a function *declaration* there,
  // never a parameter. A geometry `{ h: rowH }` stays legal — only the
  // shorthand `{ h }`, which can mean nothing but the factory, is restricted.
  {
    selector:
      ":function > Identifier.params[name='h']," +
      ":function > ObjectPattern.params > Property[key.name='h']," +
      ":function > AssignmentPattern.params > ObjectPattern > Property[key.name='h']," +
      "VariableDeclarator > ObjectPattern.id > Property[key.name='h']," +
      "ObjectExpression > Property[key.name='h'][shorthand=true]",
    message:
      'Import `h` from client/lib/dom.js instead of taking or passing it: ' +
      "`import { h } from '…/lib/dom.js'`. It has one implementation and " +
      'threading it by hand is what A7.33 removed from ~200 files.',
  },
  // Same shape, same singleton: `nav` is one exported function in
  // `client/lib/state/router.js`, and it travelled as an option through 55
  // files to reach 54 call sites in four spellings at once — `nav?.(x)`,
  // `if (typeof nav === 'function') nav(x)`, `if (nav) nav(x)` and bare
  // `nav(x)`. The optional chaining was not caution, it was the tell: three
  // of the threading paths in `app.js` handed `{ nav }` to views that never
  // destructured it, so `nav?.` was covering for a wire that was already cut
  // (B150). Everything imports it now, so `nav` arriving as an argument is
  // the fifth spelling starting over.
  //
  // Parameter- and destructuring-shaped rather than a whole-token identifier
  // ban, because `nav` is also a legitimate *local* name for a `<nav>`
  // element (`const nav = h('nav', …)` in list/sidebar.js, share-viewer and
  // bulk-edit-modal). Those are plain declarators and stay legal; only taking
  // or passing `nav` — the thing that can mean nothing but the router — is
  // restricted. The allowlist is empty: `router.js` declares it as a function
  // declaration, never a parameter.
  {
    selector:
      ":function > Identifier.params[name='nav']," +
      ":function > ObjectPattern.params > Property[key.name='nav']," +
      ":function > AssignmentPattern.params > ObjectPattern > Property[key.name='nav']," +
      "VariableDeclarator > ObjectPattern.id > Property[key.name='nav']," +
      "ObjectExpression > Property[key.name='nav'][shorthand=true]",
    message:
      'Import `nav` from client/lib/state/router.js instead of taking or ' +
      "passing it: `import { nav } from '…/lib/state/router.js'`. It is a " +
      'module singleton and threading it by hand is what B150 removed from ' +
      '55 files.',
  },
  // The other half of A7.33: the overlay-closer set. It used to be the
  // optional 4th positional argument of openModal/confirmModal/promptModal and
  // travelled as ~200 pass-through lines through 55 files — and being
  // optional, forgetting one silently dropped that overlay out of close-all,
  // invisibly at the call site. `client/lib/dom/modal.js` now keeps the
  // register itself (`registerOverlayCloser` / `closeAllOverlays`, keyed per
  // document), so registration happens where the overlay is built and cannot
  // be forgotten.
  //
  // Restricted as a whole-token *identifier* rather than a parameter shape,
  // because the old spelling appeared as a parameter, an options property, a
  // destructured binding and a shorthand pass-through all at once — the name
  // itself is the thing that must not come back. The allowlist is empty:
  // `modal.js` needs no exemption because its internals are named
  // `overlayClosersByDocument`, and a caller that genuinely needs the register
  // imports the two functions instead of threading a set.
  {
    selector:
      "Identifier[name='overlayClosers'],Identifier[name='openOverlayClosers']",
    message:
      'The overlay-closer set is not passed around any more: modal.js keeps ' +
      'the register (registerOverlayCloser / closeAllOverlays, keyed per ' +
      'document). createOverlay registers itself, so overlays need nothing; ' +
      'a hand-rolled popover calls registerOverlayCloser(el, close) (A7.33).',
  },
  ...clientSilentFailureRules,
];

// One overlay vocabulary (A7.16 cluster 1). Overlays are built by
// createModal()/createOverlay() from client/lib/dom/modal.js — backdrop,
// focus trap, Escape, aria-modal, focus restore and closers registration come
// free there, and a hand-rolled backdrop is how six of eight sampled overlays
// shipped without any of them. The five class names below are the overlay
// vocabularies that grew next to the helper; written as a raw `class:`
// literal outside modal.js, each means a hand-built overlay. Same whole-token
// boundary as the control-class rule above.
const overlayClassRestriction = {
  selector:
    "Property:matches([key.name='class'],[key.value='class']) > " +
    'Literal[value=/(^|\\s)(modal-backdrop|modal-overlay|ps-modal-overlay|ie-modal-backdrop|share-viewer-modal-overlay)(\\s|$)/]',
  message:
    'Build overlays with createModal()/createOverlay() from ' +
    'client/lib/dom/modal.js instead of a hand-rolled backdrop — one overlay ' +
    'vocabulary, with focus trap/Escape/aria-modal included (A7.16 cluster 1, ' +
    'docs/developer/linting.md).',
};

// `user.isAdmin` is the **instance-wide** role from `users.role`; it says
// nothing about the organization the session is currently in. Reading it raw
// for a UI gate means an admin of organization A keeps every destructive
// affordance the moment they switch to organization B — exactly what
// `isOrganizationAdmin()` in shared/organization-role.js exists to close
// (B144). Ten gates read it raw against four that used the helper, so the
// drift was the majority, not the exception.
//
// MemberExpression only, so the shapes that are *not* a gate stay legal:
// `{ isAdmin }` destructuring, a jsdoc `@param {boolean} isAdmin`, and a
// prop-threading `isAdmin: isOrganizationAdmin(user)` all pass. The one
// exemption is organization-role.js itself, where the helper reads the
// instance flag before narrowing it — and since B171 that file sits in
// `shared/`, so the gate covers `shared/**` too rather than leaving the
// helper's new home outside the rule it enforces.
const instanceAdminRestriction = {
  selector: "MemberExpression[property.name='isAdmin']",
  message:
    'Gate UI on isOrganizationAdmin(user) from ' +
    'shared/organization-role.js, not on the raw instance-wide ' +
    '`user.isAdmin` — the latter follows an admin into workspaces where they ' +
    'are a plain member (B144, docs/developer/linting.md).',
};

// `h()` from client/lib/dom.js is CLAUDE.md's first frontend rule, and the one
// client convention that had no mechanical backing: `h` was imported in 302
// files while `document.createElement` survived in 14, mostly as one
// head-asset recipe written five times over (B150). Where the gate is missing,
// a second form grows — and here the second form had already drifted on the
// detail that matters, the `id` the dedupe hangs on, so the same Google font
// stylesheet was fetched twice under two spellings of the same name.
//
// The head-asset recipe now lives in client/lib/dom/head-assets.js
// (ensureStyle/ensureStylesheet/ensureScript) and the font-provider table in
// client/lib/theme/font-assets.js. Everything else builds elements with `h()`,
// including `<canvas>`: `h('canvas', { width, height })` sets the same
// reflected content attributes the two offscreen-canvas sites used to assign.
//
// Boundary: `document.createElementNS` is untouched. `h()` itself calls it for
// SVG tags, and slide-runtime/likert.js builds SVG through a local `svgEl()`
// helper for the shape attributes h() does not model. Exempt files (each with
// its own re-statement block below): client/lib/dom.js, where the factory
// lives, and client/embed-sdk.js, the standalone IIFE served to third-party
// pages, which has no module graph to import from.
// One teardown word and one element word (B150). A client factory hands back a
// handle: the DOM node it built, and the function that unwires it again. Both
// halves had grown a second spelling — `detach` 24 / `destroy` 17 / `teardown`
// 4 / `cleanup` 1 for the disposer, `el` 121 / `element` 29 for the node — and
// inside a single directory, `views/editor/modals/share-modal/`, one section
// returned `{ element, detach }` while its siblings returned `{ el, detach }`.
//
// `detach` wins on plurality and because it is the exact antonym of the verb
// that already names the other half of the lifecycle: `attachThumbScale`,
// `attachSwipeNavigation`, `attachMentions`, `attachStageScale` — plus the
// `detachers` array idiom the views already collect into. `el` wins 121 to 29.
//
// Key-shaped, not a whole-token identifier ban, because both words are
// legitimate elsewhere: `element` as a local variable or a DOM-spec noun, and
// `.destroy()` as a *third-party* method — yjs's UndoManager and
// WebsocketProvider and hls.js all expose one, and those calls are their
// vocabulary, not ours. A MemberExpression is not a Property, so the selector
// leaves them alone by construction.
//
// `close` and `stop` are deliberately NOT gated: `close` is a user action on a
// modal (37 sites) and `stop` names halting a stream or timer. Both mean
// something a caller can undo; a teardown does not.
const teardownKeyRestriction = {
  selector:
    "Property[key.name='destroy'][computed=false]," +
    "Property[key.name='teardown'][computed=false]," +
    "Property[key.name='cleanup'][computed=false]," +
    "Property[key.name='element'][computed=false]",
  message:
    'One teardown word and one element word: a client factory returns ' +
    '`{ el, detach }`. `destroy` / `teardown` / `cleanup` and `element` are ' +
    'retired spellings (B150). A third-party `.destroy()` call is a member ' +
    'access, not a key, and is unaffected.',
};

const createElementRestriction = {
  selector:
    "CallExpression[callee.object.name='document']" +
    "[callee.property.name='createElement']",
  message:
    'Build elements with h() from client/lib/dom.js. Head assets ' +
    '(<style>/<link>/<script> in document.head) go through ensureStyle/' +
    'ensureStylesheet/ensureScript in client/lib/dom/head-assets.js, and the ' +
    'three font providers through client/lib/theme/font-assets.js (B150, ' +
    'docs/developer/linting.md).',
};

// --- The deck-language literal ratchet (B149/D61) ---
//
// The deck-language axis has one definition site — `TRANSLATION_LANGS` in
// `shared/i18n-utils.js` — and one membership test, `normalizeLang()`. Before
// D61 it was a two-value enum declared in five places with a sixth hardcode,
// and **206** bare `'nl'` / `'en-GB'` literals across 62 client files answered
// "is this a language" and "what is the default" privately, each free to
// disagree with the accessor and with each other.
//
// A literal cannot say which of the two it means, so both are restricted and
// the remedies are named in the message. The burndown took the axis-shaped
// ones (defaults, membership tests, re-declarations, `?lang=` validation) to
// roughly fifty in 21 files; `deckLangLiteralAllowlist` below names what is
// left and why — 14 files now — and it may only shrink.
//
// Whole-token by construction — the selector matches the string literal value
// exactly, so `nl-NL`, `en-GB-oxendict` in a locale tag, or the substring in a
// class name are untouched. Note this restricts the *deck* axis: `'nl'` as a
// **UI locale** (`client/i18n/nl/`) is a different vocabulary that happens to
// share a spelling, which is why the UI-locale modules sit on the allowlist
// rather than being rewritten.
const deckLangLiteralRestriction = {
  selector: "Literal[value='nl'], Literal[value='en-GB']",
  message:
    'Do not spell a deck language inline. Use `normalizeLang()` to test ' +
    'membership, `DEFAULT_DECK_LANG` for the fallback, `TRANSLATION_LANGS` to ' +
    'iterate and `DEFAULT_SUPPORTED_DECK_LANGS` for the shipped subset — all ' +
    'from shared/i18n-utils.js. The axis has one definition site (B149/D61, ' +
    'docs/developer/linting.md).',
};

// Files that still carry bare deck-language literals, with the reason each is
// not burned down yet. **This list may only shrink** —
// `tests/deck-language-axis.test.js` fails when an entry stops matching a real
// literal, so a file that is cleaned up cannot quietly stay exempt.
//
// Two reasons appear, and only two:
//   * *bilingual chrome* — the paired alt-text inputs and the viewer's fixed
//     NL/EN link pair. Widening these to N languages is a UI design job, not a
//     rename: B182. (The editor's NL⇄EN toggle is gone — it is a language menu
//     over every version the deck has since B182 fase 2 — and the translate
//     modals name their source and target off the axis since fase 3.)
//   * *UI-locale axis* — `'nl'` there is a locale directory
//     (`client/i18n/nl/`), a different vocabulary that shares a spelling.
const deckLangLiteralAllowlist = [
  // bilingual chrome (B182)
  'client/views/editor/image-library/detail.js',
  'client/views/editor/image-library/upload.js',
  'client/views/editor/imagekit-picker.js',
  'client/views/editor/media/apply-pick.js',
  'client/views/presenter/follow-codes-pill.js',
  // the axis↔locale seam: these name `en-GB` precisely because it is the one
  // code the two axes spell differently
  'client/views/follow/i18n.js',
  'client/views/editor/slide-type-sample-content.js',
  'client/views/list/views/sandbox-examples.js',
  // UI-locale axis, not the deck axis
  'client/lib/ui-i18n.js',
  'client/views/editor/editor-form/text-element-card.js',
  'client/views/editor/fields/background.js',
  'client/views/settings/tabs/integrations-tab.js',
  'client/views/settings/tabs/preferences-tab.js',
  // the standalone embed IIFE: no imports at all by design
  'client/embed-sdk.js',
];

export default [
  {
    // Vendored bundles, generated assets, data dirs, gitignored drop-ins, and
    // local working docs — none of it is hand-authored source we lint.
    ignores: [
      'node_modules/**',
      'server/data/**',
      'server/uploads/**',
      'client/vendor/**',
      'vendor/**',
      'assets/**',
      'themes/**',
      'custom/**',
      'docs/**',
      'skills/**',
      '.claude/**',
      'coverage/**',
      '**/*.min.js',
    ],
  },

  {
    // The codebase already carries `eslint-disable-next-line no-console` /
    // `no-bitwise` directives from before this config existed. Those rules are
    // not enabled here, so the directives are technically unused — but removing
    // them is out of scope for standing up the linter and would leave the tree
    // full of trailing-whitespace churn. Leave them dormant and forward-compatible.
    linterOptions: {
      reportUnusedDisableDirectives: 'off',
    },
  },

  js.configs.recommended,

  // Browser-side source.
  {
    files: ['client/**/*.js'],
    ignores: ['client/vendor/**'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        ...clientRestrictedSyntax,
        overlayClassRestriction,
        instanceAdminRestriction,
        createElementRestriction,
        teardownKeyRestriction,
        deckLangLiteralRestriction,
      ],
    },
  },

  // The deck-language burndown allowlist: same client rule set, minus the
  // literal ratchet. Placed after the base client block so it wins for these
  // files, and before the three single-file blocks below so those keep their
  // own exemptions (rule entries replace rather than merge per rule name,
  // hence the re-statement).
  {
    files: deckLangLiteralAllowlist,
    rules: {
      'no-restricted-syntax': [
        'error',
        ...clientRestrictedSyntax,
        overlayClassRestriction,
        instanceAdminRestriction,
        createElementRestriction,
        teardownKeyRestriction,
      ],
    },
  },

  // modal.js is the overlay vocabulary's one permanent home, so the
  // overlay-class restriction is off there — and nowhere else. Every other
  // client restriction stays in force (rule entries replace per rule name,
  // hence the re-statement).
  {
    files: ['client/lib/dom/modal.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...clientRestrictedSyntax,
        instanceAdminRestriction,
        createElementRestriction,
        teardownKeyRestriction,
        deckLangLiteralRestriction,
      ],
    },
  },

  // dom.js is where `h()` is implemented, so it is allowed to call
  // `document.createElement`. Every other client restriction stays in force
  // (rule entries replace per rule name, hence the re-statement).
  {
    files: ['client/lib/dom.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...clientRestrictedSyntax,
        overlayClassRestriction,
        instanceAdminRestriction,
        teardownKeyRestriction,
        deckLangLiteralRestriction,
      ],
    },
  },

  // embed-sdk.js is the standalone IIFE served to third-party pages: no
  // imports at all by design (hence `document.createElement`), and the handle
  // it returns is a **public contract** — `destroy()` sits beside `next()`,
  // `prev()`, `goToSlide()` and `getState()` in an embed-SDK vocabulary that
  // an external page wrote against. Renaming it to `detach` would break every
  // embedder to make one file agree with an internal convention it does not
  // participate in, so the teardown-key gate is off here — and only here.
  {
    files: ['client/embed-sdk.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...clientRestrictedSyntax,
        overlayClassRestriction,
        instanceAdminRestriction,
      ],
    },
  },

  // Node-side source and tooling.
  {
    files: [
      'server/**/*.js',
      'scripts/**/*.js',
      'test-suite/**/*.js',
      '*.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
  },

  // Every server-side env read goes through the one accessor family in
  // server/config/utils.js (envStr/envBool/envInt/envList), so a flag means
  // the same thing wherever it is read — `1`/`true`/`yes`/`on` all count as
  // true, values are trimmed, defaults live at the read site. A raw
  // `process.env.X` is how the second boolean vocabulary starts (B64; the
  // same one-canonical-form stance as the t() rule above).
  //
  // Exempt: `server/config/**` (where the accessors live and dotenv loads),
  // and the two runtime-environment markers that are not Deckyard config —
  // NODE_ENV (the environment switch itself) and NODE_TEST_CONTEXT (set by
  // the node:test runner).
  {
    files: ['server/**/*.js'],
    ignores: ['server/config/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[object.object.name='process'][object.property.name='env']" +
            ":not([property.name='NODE_ENV']):not([property.name='NODE_TEST_CONTEXT'])",
          message:
            'Read env via envStr/envBool/envInt/envList from server/config/utils.js — ' +
            'one accessor family, one flag vocabulary (B64). Only NODE_ENV and ' +
            'NODE_TEST_CONTEXT may be read raw.',
        },
        {
          selector:
            "VariableDeclarator[init.object.name='process'][init.property.name='env']",
          message:
            'Do not alias or destructure process.env — read each variable via ' +
            'envStr/envBool/envInt/envList from server/config/utils.js (B64).',
        },
        ...serverSilentFailureRules,
      ],
    },
  },

  // server/config/** is exempt from the env accessors (it *is* the accessor
  // family) but not from the two promise-guard rules — a dropped rejection is
  // no more debuggable in config than anywhere else.
  {
    files: ['server/config/**/*.js'],
    rules: {
      'no-restricted-syntax': ['error', ...serverSilentFailureRules],
    },
  },

  // Docs screenshot runner: Node scripts that also carry browser-context
  // callbacks (page.evaluate / waitForFunction run inside Chromium), so both
  // global sets are legitimately in play.
  {
    files: ['capture/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Tests run under node:test but exercise client code through jsdom, which
  // injects browser globals at runtime — so they need both global sets.
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Shared modules run in both environments; give them both global sets so
  // no-undef does not false-positive on env-specific references.
  //
  // Two gates ride along. The instance-admin one because
  // `isOrganizationAdmin()` moved here in B171, and a rule that stopped at
  // `client/**` would have left the raw flag readable in exactly the tree the
  // helper now lives in. The silent-failure one for the same reason
  // generalized: `client/**` and `server/**` have been gated since
  // B106/B111/B150, so every module that moved into `shared/` (B171, B177)
  // fell out of the gate on arrival — the tree was the one hole in a rule
  // that covers the whole app (B178).
  {
    files: ['shared/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        instanceAdminRestriction,
        ...sharedSilentFailureRules,
      ],
    },
  },

  // shared/organization-role.js is where the instance flag is *allowed* to be
  // read: isOrganizationAdmin() starts from `user.isAdmin` and narrows it with
  // the membership role. The exemption is for that rule only — re-stated
  // rather than switched 'off', because flat-config entries replace per rule
  // name, so `'off'` here would have dropped the silent-failure rules for
  // this file too (the same drift the hoisted selectors above guard against).
  {
    files: ['shared/organization-role.js'],
    rules: {
      'no-restricted-syntax': ['error', ...sharedSilentFailureRules],
    },
  },

  // Every relative import must resolve to a file that exists.
  //
  // There is no bundler here, so a moved module is not a build error — ESM only
  // fails at *runtime*, on the import that never loads. A behaviour-preserving
  // reorganisation therefore passes `npm test` while the app no longer boots.
  // That is not hypothetical: splitting `client/lib/` into sub-folders left a
  // fork's `client/app.js` importing `./lib/branding.js`, green suite and all,
  // and it was found by a hand-written scan after the fact (fork-upgrade
  // finding B1; the same lesson as #425 on our own side).
  //
  // It rides the existing lint gate rather than being its own test:
  // `eslint-plugin-import-x` is already a devDependency (the dead-code pass uses
  // it), so this costs no extra CI minutes and adds no new mechanism.
  //
  // `custom/` is in `ignores` above — a fork's drop-in tree, absent upstream —
  // so it cannot be covered here. `tests/custom-imports-resolvable.test.js`
  // covers it instead, and is the half a fork actually needs.
  {
    files: [
      'client/**/*.js',
      'server/**/*.js',
      'shared/**/*.js',
      'scripts/**/*.js',
      'capture/**/*.js',
      'test-suite/**/*.js',
      'tests/**/*.js',
      '*.config.js',
    ],
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver': {
        node: {
          extensions: ['.js', '.mjs'],
        },
      },
    },
    rules: {
      // Relative imports must point at a file that exists; bare specifiers are
      // checked against what is actually installed, which is why `npm run lint`
      // needs a complete `npm ci` (a missing dependency turns the gate red).
      'import-x/no-unresolved': 'error',
      // `no-unresolved` alone is not enough, because the node resolver is more
      // forgiving than the ESM loader: it does extension and index resolution,
      // so `import './foo'` (for `foo.js`) and `import './bar'` (for
      // `bar/index.js`) both resolve here and both throw ERR_MODULE_NOT_FOUND at
      // runtime. Requiring the extension closes that gap — the resolver's
      // leniency can no longer certify an import Node will refuse. Packages keep
      // their bare, extensionless form (`node:fs`, `es-module-lexer`).
      'import-x/extensions': ['error', 'ignorePackages'],
    },
  },

  // `zod` is for LLM *output* schemas, nothing else.
  //
  // It sits in `dependencies` on the strength of a single import
  // (`server/utils/ai/schemas/`), where it parses what a model hands back —
  // genuinely untyped, genuinely worth a schema library. Reaching for it on
  // request bodies is the standing temptation, and it would make
  // `server/utils/request-validators.js` the *second* validation vocabulary
  // instead of the first, with `docs/openapi.yaml` as a third place the same
  // contract is written down. A7.19 B2 decided against that (see
  // docs/reference/versioning.md § the beta stance: one canonical form per
  // concept); this is that decision with teeth instead of a note in a brief.
  //
  // The narrow allowance below is the whole permitted surface. Widening it is a
  // design decision, not a lint fix — if a second place genuinely needs schema
  // parsing, argue that in a PR rather than adding a path here.
  {
    files: ['**/*.js'],
    ignores: ['server/utils/ai/schemas/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...nodeBuiltinImports,
            {
              name: 'zod',
              message:
                'zod is for LLM output schemas only (server/utils/ai/schemas/). ' +
                'Validate request bodies with server/utils/request-validators.js — ' +
                'a second validation vocabulary is a second place the contract drifts ' +
                '(A7.19 B2).',
            },
          ],
          patterns: nodeBuiltinImportPatterns,
        },
      ],
    },
  },

  // The directory the zod block exempts still gets the node: prefix rule; a
  // flat-config block that does not match leaves the rule unset rather than
  // inherited.
  {
    files: ['server/utils/ai/schemas/**/*.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: nodeBuiltinImports, patterns: nodeBuiltinImportPatterns },
      ],
    },
  },

  // Baseline rule tuning. Starts from eslint:recommended; the deltas below keep
  // the gate green on a large never-linted codebase without silencing real bugs.
  {
    rules: {
      'no-unused-vars': [
        'error',
        {
          // Don't flag unused function arguments. In this codebase they are
          // dominated by interface-conformance params (every storage-adapter
          // method carries `ctx` so implementations stay swappable; slide-type
          // `renderHtml(content, slide, ctx)` and route handlers share a fixed
          // shape) — structurally required, semantically unused, not dead code.
          // Deleting them breaks the contracts; `_`-prefixing 200+ sites is pure
          // churn that also splits param names across sibling implementations.
          // Unused *variables* and *imports* are still errors — that's where the
          // real dead-code signal lives (see the burndown in docs/developer/linting.md).
          args: 'none',
          varsIgnorePattern: '^_',
          // Catch-block bindings are often intentionally unused (log-and-move-on).
          caughtErrors: 'none',
          ignoreRestSiblings: true,
        },
      ],
      // Intentional in this codebase (dev logging, server diagnostics).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The control-char matches in this repo are deliberate \x00 sanitizers
      // (input/filename cleaning), not mistakes — the rule is pure noise here.
      'no-control-regex': 'off',
    },
  },
];
