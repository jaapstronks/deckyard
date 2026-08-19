/**
 * Shared author-CSS filter.
 *
 * Author-supplied CSS is injected inside a `<style>` block (custom-html slide,
 * custom slide types), so the threat surface is: breaking out of the style tag,
 * JavaScript-in-CSS (legacy `expression()`, `javascript:` URLs), and external
 * resource loads / data-exfil via `@import`. Strip/defang those. This is not a
 * full CSS parser — it neutralises the known-dangerous constructs.
 *
 * `data:` is deliberately NOT defanged (CodeQL js/incomplete-url-scheme-check
 * flags its absence next to `javascript:`/`vbscript:`; dismissed with this
 * reasoning): inside a `<style>` block a `data:` URL has no script path — it
 * can only be an image/font/cursor payload for `url()`, and the one place it
 * could pull in CSS, `@import`, is already stripped above. Blocking it would
 * break legitimate inline-SVG backgrounds in author CSS for no gain.
 *
 * @param {string} css
 * @returns {string}
 */
export function filterCssText(css) {
  return String(css || '')
    .replace(/<\/style/gi, '<\\/style') // can't break out of the <style> block
    .replace(/@import[^;]*;?/gi, '') // no external stylesheet loads
    .replace(/expression\s*\(/gi, 'expression​(') // legacy IE JS-in-CSS
    .replace(/javascript:/gi, 'javascript​:') // defang url(javascript:...)
    .replace(/vbscript:/gi, 'vbscript​:'); // same family, legacy IE
}
