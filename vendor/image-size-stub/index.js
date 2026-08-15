/**
 * Stub for `image-size` (B59).
 *
 * pptxgenjs declares image-size as a dependency but never calls it: the only
 * reference in its shipped bundles is a commented-out `getSizeFromImage`
 * helper (marked "FIXME: currently unused" upstream — and even that would
 * `require('sizeof')`, a different package). Meanwhile every published
 * image-size release (≤ 2.0.2) carries two high-severity DoS advisories
 * (GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) with no patched version.
 *
 * The `overrides` entry in package.json points the dependency here, taking
 * the vulnerable-and-unreachable code out of the tree entirely. If a future
 * pptxgenjs (or anything else) starts calling image-size for real, this throw
 * makes that loud and traceable instead of silently reintroducing the
 * unpatched parser — remove the override and re-evaluate then.
 */
module.exports = function imageSizeStubbed() {
  throw new Error(
    'image-size is stubbed out (vendor/image-size-stub, B59): the real package ' +
      'is unpatched against known DoS advisories and was unused by pptxgenjs. ' +
      'Something now calls it — remove the override in package.json and re-evaluate.'
  );
};
