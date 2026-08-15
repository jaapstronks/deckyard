# image-size stub (B59)

`pptxgenjs@4.0.1` pins `image-size@^1.2.1`, and every published release of
image-size (≤ 2.0.2, the latest) is flagged by two high-severity DoS
advisories with **no fixed version**:

- [GHSA-w3rx-r6r6-pgpr](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr) — ICNS parser infinite loop
- [GHSA-5p2g-fcmc-qvqq](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq) — JXL/HEIF parser infinite loops

pptxgenjs never actually calls the package: its only reference lives in a
commented-out helper in the shipped bundles (`getSizeFromImage`, marked
"FIXME: currently unused" upstream). Deckyard's PPTX export adds slide PNGs
with explicit width/height, so nothing needs image sizing on that path either.

The `overrides` entry in the root `package.json` maps `image-size` to this
directory, removing the unpatched code from `node_modules` entirely — that is
what makes `npm audit` clean. The stub's only export throws with a pointer
here, so any future *real* use of image-size fails loudly instead of silently
resurrecting the vulnerable parser.

**When pptxgenjs ships a release that drops or genuinely needs image-size:**
remove the override and this directory.
