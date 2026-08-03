/**
 * The Prism language tables shared by every surface that loads language packs
 * conditionally: the standalone export/render heads (server/utils/prism-katex.js)
 * and the app shell's lazy loader (client/lib/slide-runtime/prism-katex-loader.js).
 * One canonical map — a language added here becomes highlightable everywhere.
 */

/**
 * The language set loaded when a caller does not say which languages a deck
 * uses. Kept as-is for the render paths (PNG/PDF/print) that still emit one
 * fixed head for every deck.
 */
export const PRISM_DEFAULT_LANGUAGES = [
  'markup',
  'css',
  'javascript',
  'typescript',
  'python',
  'java',
  'json',
  'sql',
  'bash',
  'markdown',
];

/**
 * Languages the base Prism bundle already ships with. Requesting a component
 * script for one of these would be a wasted request. (The CDN `prism.min.js`
 * and the vendored base set both cover exactly these: markup + css + clike +
 * javascript and their aliases.)
 */
export const PRISM_CORE_LANGUAGES = new Set([
  'markup',
  'html',
  'xml',
  'svg',
  'mathml',
  'ssml',
  'atom',
  'rss',
  'css',
  'clike',
  'javascript',
  'js',
]);

/**
 * The components that together replicate the CDN `prism.min.js` bundle
 * (core + these four, in this order). The app shell's lazy loader and the
 * vendor script both build on this base so `PRISM_CORE_LANGUAGES` stays an
 * accurate description of what is always available once Prism is loaded.
 */
export const PRISM_BASE_COMPONENTS = ['markup', 'css', 'clike', 'javascript'];

/**
 * Language name (as written in a fenced code block) → the Prism component
 * scripts it needs, in load order. Components with dependencies list them
 * first, because the scripts are plain (non-module) tags that run in order.
 *
 * A language that is not in this map simply gets no component script: it
 * renders as an unhighlighted code block, exactly as an unknown language did
 * when the head hardcoded ten packs.
 */
export const PRISM_LANGUAGE_COMPONENTS = {
  bash: ['bash'],
  sh: ['bash'],
  shell: ['bash'],
  zsh: ['bash'],
  c: ['c'],
  cpp: ['c', 'cpp'],
  csharp: ['csharp'],
  cs: ['csharp'],
  diff: ['diff'],
  docker: ['docker'],
  dockerfile: ['docker'],
  go: ['go'],
  golang: ['go'],
  graphql: ['graphql'],
  ini: ['ini'],
  java: ['java'],
  json: ['json'],
  jsx: ['jsx'],
  kotlin: ['kotlin'],
  kt: ['kotlin'],
  markdown: ['markdown'],
  md: ['markdown'],
  php: ['markup-templating', 'php'],
  python: ['python'],
  py: ['python'],
  r: ['r'],
  ruby: ['ruby'],
  rb: ['ruby'],
  rust: ['rust'],
  rs: ['rust'],
  sass: ['sass'],
  scss: ['scss'],
  sql: ['sql'],
  swift: ['swift'],
  toml: ['toml'],
  tsx: ['jsx', 'typescript', 'tsx'],
  typescript: ['typescript'],
  ts: ['typescript'],
  yaml: ['yaml'],
  yml: ['yaml'],
};

/**
 * Resolve deck language names to the Prism component names to load.
 *
 * @param {string[]|null} languages Language names as written in the deck, or
 *   null for "unknown, load the default set".
 * @returns {string[]} Prism component names, deduped, in dependency order.
 */
export function resolvePrismComponents(languages) {
  if (!Array.isArray(languages)) return PRISM_DEFAULT_LANGUAGES.slice();
  const out = [];
  for (const raw of languages) {
    const name = String(raw || '').toLowerCase().trim();
    if (!name || PRISM_CORE_LANGUAGES.has(name)) continue;
    const components = PRISM_LANGUAGE_COMPONENTS[name];
    if (!components) continue;
    for (const c of components) if (!out.includes(c)) out.push(c);
  }
  return out;
}
