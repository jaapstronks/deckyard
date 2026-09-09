# The `fidelity` facet, and what an export can hand back

`structure` says what shape a slide type's content has. `runtime` says what the presenting session has to do for it. `fidelity` says how faithfully an **export target** can write it as something the receiving application can edit.

It is the fourth facet, and it exists earlier in its life than the others did. `server/export/pptx.js` carried one branch — `slide?.type === 'video-slide'` — to answer:

> does this type have a composition the export can write natively, or does it become a picture?

One name, so it stayed below the branching inventory's threshold of three and nobody had to account for it. But it is the same mistake `structure` and `runtime` retired, caught before it grew: the moment a second type gains a native mapper the branch becomes a list, and a list is a thing a new type falls out of in silence. The export would keep working and simply rasterise a type that could have been editable. So the question moved onto the type while it still had one answer.

## The vocabulary

Defined in `shared/slide-types/fidelity.js`; declared as `fidelity: { pptx: '…' }` on each type's definition.

| `fidelity` | Meaning                                                               | Types                    |
| ---------- | --------------------------------------------------------------------- | ------------------------ |
| `native`   | the whole slide is written as target-native, editable objects          | video                    |
| `mixed`    | the text is native; one part of the slide travels as an image          | none yet                 |
| `raster`   | the whole slide travels as one image                                   | every other core type    |

The line is drawn at **what the receiving application can edit**, not at how good it looks. A raster slide can be a pixel-perfect reproduction and is still `raster`; a native slide can be a plainer arrangement of the same content and is still `native`. Fidelity here means editability, because that is what the reader of the exported file gains or does not gain, and it is what "please send me the PowerPoint" is actually asking for.

`mixed` has no types today and is in the vocabulary on purpose. It is the shape a geometry type takes when its mapper arrives: a funnel or a cycle whose labels are real text boxes over a picture of the diagram. The words become editable, the drawing does not, and that is a third answer rather than a compromise between two.

## Why the value is an object

`fidelity: { pptx: 'native' }` rather than a bare string, because the answer belongs to a _pair_: this type, that target. PPTX is the only target with a mapper today; a second one (DOCX, Google Slides) gets its own key rather than a second facet with a second vocabulary. The three values are deliberately target-independent — they describe the relationship, not the file format — so a new target costs one declaration per type and nothing else. `FIDELITY_TARGETS` is what the coverage test iterates, so adding `docx` there makes every core type fail until it has said what it means.

## Implementation status (as of 2026-09-10)

**Everything except video exports as a picture.** That is not a plan being described in the present tense; it is the whole current state, and it is the same file the export produced before this facet existed. What changed is that the answer is now declared by the type instead of recognised from its name, and that the two can no longer drift apart without a test failing.

The tiers as declared are the honest starting state, not a design target. Which types eventually earn `native` follows from a real judgement about the exported files — poort A2.8 in the plan — rather than from the guesses in a table.

## Who declares, and who cannot

- **Core and file-JS types** declare on the definition. A file-JS fork type that does not gets a boot warning from `validateSlideTypeDefinition()` and resolves to `raster`. It is a warning rather than an error because the loss is exactly one editable export — the type still renders, still presents, still travels as a picture — but silence and `raster` look identical from outside and only one of them is a decision.
- **Database-backed types** (Settings > Slide Types) have nowhere to put a declaration, and no mapper could exist for arbitrary authored markup, so `toRuntimeSlideType()` writes `fidelity: { pptx: 'raster' }` onto the composed definition. That is a definition, not a default: the facet is present on every entry of every registry, whichever way the registry was built.

## The lookup

```js
import { exportFidelity } from 'shared/slide-types/fidelity.js';

const tier = exportFidelity(registry[slide.type], 'pptx'); // 'native' | 'mixed' | 'raster'
```

It takes a **definition**, not a type name, and the module imports nothing. Two reasons. The practical one: `validate-definition.js` checks the facet at boot and is itself pulled into the Settings bundle, so a registry import here would drag every core type into a bundle that wants nine strings. The one about the seam: a caller holding a def holds the _org-scoped_ registry, which is the only one a database-backed type is in. Resolving a name against the process-wide `SLIDE_TYPES` would answer `raster` for a custom type by accident rather than by declaration, and the accident would look identical to the truth.

An undeclared type, an unresolvable one and a value outside the vocabulary all resolve to `raster` — seam rule 5, unknown degrades and never breaks.

## The guardrail

`tests/slide-type-fidelity.test.js`, three gates:

1. **Completeness** — every core type answers for every target. Silence must not become a fourth value, or an undeclared type and a deliberately-rastered one stop being distinguishable.
2. **Truthfulness** — a type declaring anything but `raster` is claiming a composition exists. That claim is checked against `NATIVE_PPTX_HANDLERS` in `server/export/pptx.js`, in **both** directions. A declaration without a handler rasterises a slide while telling the user it is editable; a handler without a declaration never runs. Adding a native mapper is therefore two edits, on purpose: the claim lives with the type, where someone adding a type is looking, and the implementation lives in the export, where someone adding a mapper is looking.
3. **No second definition** — no module under `server/export/` may name a slide type, except the four listed with the question each is answering. `pptx.js` holds `NATIVE_PPTX_HANDLERS`, a table keyed by type name, which is where those names belong now and which gate 2 pins harder than a grep could. `print.js` is a per-type renderer table (already in the branching inventory). `pdf-slides.js` and `png-slides.js` ask something else entirely — a video has no still frame, so those two draw a poster instead of a player, which is about rasterising a video and not about fidelity tiers.

Gate 3 is an allow-list rather than a threshold, because the branch this facet retired was a single name and a count-based gate would never have seen it.

At export time the same claim is checked once more, and a fork type declaring `native` with no handler in this build gets its slide rastered **with a warning in the export's warning list** rather than silently. The export never refuses over this: a file with every slide in it beats no file, as long as the user is told which slide was not what it promised.

## See also

- `shared/slide-types/fidelity.js` — the vocabulary, the two lookups and the predicate an export branches on.
- `tests/slide-type-fidelity.test.js` — the guardrail.
- [`slide-type-runtime.md`](./slide-type-runtime.md) — the facet this one is modelled on.
- [`slide-type-structure.md`](./slide-type-structure.md) — the first facet, and why facets rather than a hierarchy.
- [`export-menu.md`](./export-menu.md) — where the exports live for the user.
