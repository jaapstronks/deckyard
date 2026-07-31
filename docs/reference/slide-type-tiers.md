# Slide-type tiers, and the `fallback` facet

Deckyard publishes its slide types as a format. Every name in that publication is
a promise, and until this page existed the promise had no boundary: 36 built-in
types, and no statement about which of them a second implementation actually
owes.

That is a fair question to ask of the set, because it was not designed as a spec.
The CIIIC fork came first and upstream Deckyard was abstracted out of it, so the
types grew as one organisation's product line — six diagram geometries, three
ways to show a set of cards, a handful of types that exist because one deck
needed them. Good product surface; too much spec surface.

**The fix is not "which types do we remove" but "which types do we promise".**
Removing is destructive and irreversible once a name is published. A tier is free
and reversible. So nothing was removed and nothing moved to the fork.

## The three tiers

| Tier | What | The promise |
|---|---|---|
| **1 — Core profile** | the nine types below | **Normative.** What a conforming implementation must render. Covered by the existing stability promise. |
| **2 — Deckyard set** | every other core type | We ship, publish and document them, but they version with the app and may walk the removal ladder. |
| **3 — Extension** | fork types (`custom/slide-types/`), org types from the builder UI, third-party types later | The declarant's. We promise nothing about them, and we do not ignore them. |

The tier is **a property of the name, not of the definition**. A fork that
overrides `title-slide` answers a tier-1 name and takes on the tier-1 promise —
that is what choosing the name means. A fork type under a new name is tier 3
however good it is. `slideTypeTier()` therefore resolves off the name alone.

## The nine

`title-slide`, `chapter-title-slide`, `content-slide`, `list-slide`,
`quote-slide`, `image-slide`, `image-text-slide`, `table-slide`, `end-slide`.

The choice is a criterion, not a taste: **the minimal set that expresses an
ordinary presentation without loss** — title, section break, prose, enumeration,
quotation, image, image-with-text, table, closing. Everything outside it adds
expressiveness that has an acceptable degradation inside it, and the `fallback`
declaration is where each type writes that degradation down.

`chart-slide` is deliberately outside. It needs a charting library, and the
success criterion for a second implementation is a weekend of work. A profile
that demands a charting runtime is no longer an entry threshold. Its data still
survives: chart falls back to `table-slide`, so only the encoding is lost.

## The rule that makes the tiers enforceable

> **Every tier-2 type declares a `fallback` to a tier-1 type.**

One extra declarative key on the definition, the same shape as `structure` and
`runtime`, served through `/api/slide-types`, resolved through
`shared/slide-types/tiers.js`. It buys four things:

1. A core-profile-only reader renders **every** Deckyard deck without dropping
   content: a funnel degrades to a list, a KPI grid to a list, a gallery to
   images. That is what "good citizen" means in practice.
2. The removal ladder gets a `successor` candidate for free
   ([`slide-type-removal.md`](./slide-type-removal.md)).
3. The conformance kit gets a testable expectation per type, not just a fixture.
4. "Should this be its own type?" gets a second test beside the
   type-versus-variant rule: **a type with no sensible tier-1 degradation is
   probably a theme variant, not a slide type.**

A tier-1 type declares no fallback. It is the floor.

### It names a contract, not a slide swap

`gallery-slide` falls back to `image-slide`. That does not mean "render nine
photos as one photo" — it means *this content is images, render it the way you
render images*, and a reader is free to emit more than one slide.

Which contract a type points at is decided by **what holds its content without
losing any**, not by family resemblance. The two entries that look wrong at a
glance and are not:

- **`video-slide` → `content-slide`,** not `image-slide`. It carries a title and
  a URL and no image field at all, so the image contract would hold none of it.
- **`comparison-slide` → `table-slide`,** not `content-slide`. Two labelled
  columns with a body each is two-dimensional content even though the fields are
  scalars, and the pairing is the whole point of a comparison.

For a `chrome` type there is no authored content to preserve, so the fallback is
about which tier-1 slide keeps the beat it occupies: `payoff-slide` → `end-slide`
(a closing slide), `follow-invite-slide` → `content-slide` (it sits anywhere).

The full per-type mapping is generated into
[`slide-type-inventory.md`](./slide-type-inventory.md).

### What it is not

- **Not `extends`.** `fallback` is a degradation hint, not a type relation, and
  it carries no fields. Inheritance stays rejected.
- **Not the unknown-type render contract.** A reader meeting a type it has never
  heard of renders the structure plus the text and shows the type name. That is
  about *unknown* types; `fallback` is about types that are known but not
  implemented. The two ran together in conversation once and are kept apart here.

## Declaring without building

`DECLARED_SLIDE_TYPES` in `shared/slide-types/tiers.js` holds names that are part
of the published format with no implementation behind them. Declaring is
deliberately decoupled from building: a reserved name pointed at a tier-1
fallback costs nothing to honour — a reader degrades it exactly as it would any
other tier-2 type — and it stops the same gap being rediscovered later and filled
ad hoc under a worse name.

Today there is exactly one: **`code-slide`** (tier 2, fallback `content-slide`).
A code/monospace slide is genuinely missing; without it the options are
`custom-html-slide` or a text slide, and in both cases the semantics are gone —
nothing says "this is source, render it monospaced, do not reflow it". The
fallback loses the monospacing, not the code.

**And nothing else**, written down so the question does not return every quarter.
The temptation to declare a wishlist is precisely how a set ends up at 36 again.
The bar for a new published name is now a question with an answer: *which tier-1
type is the fallback, and why is that loss unacceptable?*

A declared name must not be in the registry. The moment something renders it, it
is a normal type declaring its own `fallback` and its entry here goes.

## Where it lives

| Fact | Where |
|---|---|
| the tier vocabulary, the nine names, the lookups | `shared/slide-types/tiers.js` |
| a type's `fallback` | `fallback: 'list-slide'` on the definition, beside `structure` |
| names declared but not built | `DECLARED_SLIDE_TYPES` in `tiers.js` |
| `tier` + `fallback` for a browser consumer | `GET /api/slide-types` |
| the per-type table | `docs/reference/slide-type-inventory.md` (generated) |
| the guardrail | `tests/slide-type-tiers.test.js` |

The lookups follow the aggregator-seam rule from
[`slide-type-directory.md`](./slide-type-directory.md): one lookup per facet in
the facet module (`coreProfileContract()`), definition first so a fork type's own
declaration is heard, and an unrecognised value degrades to "no declaration"
rather than throwing.

## What is still open

The tiers are declared and enforced in code; publishing them as normative text on
`/spec/`, in both languages, belongs to the same track (A8.2/A8.3) as opening the
JSON Schema and the reverse-DNS type ids. Until that lands, this page and the
generated inventory are where the boundary is written down.
