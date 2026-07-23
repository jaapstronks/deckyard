/**
 * Sandbox sample media.
 *
 * Uploads are off in the sandbox, so a guest can't add their own images — but
 * they still need something to place on a slide. This is a small curated set of
 * built-in sample images and fictional-brand logos (committed SVGs) that the
 * image-library list surfaces only in sandbox mode. Logos carry a "logo" tag so
 * they show under the Logos filter.
 *
 * These are illustrative placeholders (abstract SVG art + wordmarks), so there
 * is no licensing concern and nothing is fetched from a third party.
 */

const BASE = '/client/vendor/sandbox-media';

/** @returns {Array<{id:string,url:string,description:string,tags:string[],source:string}>} */
export function listSandboxMedia() {
  const now = '2026-01-01T00:00:00.000Z';
  const item = (file, description, tags) => ({
    id: `sandbox-${file}`,
    url: `${BASE}/${file}.svg`,
    description,
    tags,
    source: 'sandbox-sample',
    created: now,
  });

  return [
    // Fictional-brand logos (Logos filter).
    item('acme-logo', 'ACME logo', ['logo', 'acme', 'sample']),
    item('acme-corp-logo', 'ACME Corp logo', ['logo', 'acme', 'sample']),
    item('northwind-logo', 'Northwind logo', ['logo', 'northwind', 'sample']),
    // Sample imagery.
    item('sample-office', 'Sample office image', ['sample', 'office']),
    item('sample-team', 'Sample team image', ['sample', 'team', 'people']),
    item('sample-product', 'Sample product image', ['sample', 'product']),
  ];
}
