/**
 * Shared author-CSS filter.
 *
 * Author-supplied CSS is injected inside a `<style>` block (custom-html slide,
 * custom slide types), so the threat surface is: breaking out of the style tag,
 * JavaScript-in-CSS (legacy `expression()`, `javascript:` URLs), and external
 * resource loads / data-exfil via `@import`. Strip/defang those. This is not a
 * full CSS parser — it neutralises the known-dangerous constructs.
 *
 * @param {string} css
 * @returns {string}
 */
export function filterCssText(css) {
  return String(css || '')
    .replace(/<\/style/gi, '<\\/style') // can't break out of the <style> block
    .replace(/@import[^;]*;?/gi, '') // no external stylesheet loads
    .replace(/expression\s*\(/gi, 'expression​(') // legacy IE JS-in-CSS
    .replace(/javascript:/gi, 'javascript​:'); // defang url(javascript:...)
}
