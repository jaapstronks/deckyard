/**
 * Anchor consistency: one concept, one word — *within* one locale.
 *
 * The whole B133–B141 translation series leaned on an invariant nothing could
 * check: if `en/` says the same English under two keys, those two keys mean the
 * same thing, so every locale should spell them the same way. Nothing enforced
 * it, and the drift is real — `nl` ships `Export` under one key and
 * `Exporteren` under another, `de` ships `Workspace` beside `Arbeitsbereich`,
 * `fi` ships `7 päivää` beside `7 paivaa` (the diacritics simply dropped).
 *
 * The detector is deliberately blunt: group `en/`'s keys by their normalised
 * English text, keep the groups of two or more, and for each locale count the
 * distinct forms it uses across that group. Two forms is a finding. That is the
 * mechanical shape of "one concept, one word", and it is the only shape that
 * catches the *next* one — a new key reusing an existing English string either
 * matches the form already in use or fails.
 *
 * Not every finding is a defect. Three classes live in the output:
 *
 *  - **drift** — two words for one meaning (`Beheer` / `Beheerder`). Fix.
 *  - **agreement** — the locale's grammar forces two forms; `fr` `Sombre` /
 *    `Sombres` agrees with the noun it modifies. Legitimate, and it has to be
 *    written down as legitimate or the gate becomes noise.
 *  - **deliberate English** — one form *is* the English, on purpose: a product
 *    name, a cognate, a colour-slot name (`Mist`). Indistinguishable from an
 *    untranslated string without someone saying so.
 *
 * The detector cannot tell them apart — that is a translator's judgement — so it
 * reports all three and the allowlist carries the verdict, one reason per row.
 * `cohortOf()` exists only to *rank* the report for the human making those
 * calls; it never decides anything.
 *
 * @module scripts/lib/i18n-anchors
 */

/**
 * The comparison form of a string: trimmed, inner whitespace collapsed.
 *
 * Case is deliberately kept. "Button Label" beside "Button label" is exactly
 * the drift B166 measured by hand, and lowercasing here would hide it.
 * Punctuation is kept for the same reason: `Export` and `Export…` are two
 * different labels, and folding them would let a real difference through.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeText(value) {
  return String(value).trim().replace(/\s+/g, ' ');
}

/**
 * Strip diacritics and the Nordic/Polish letters NFD leaves alone, for the
 * *report only* — this is how `Wysyłanie…` / `Wysylanie…` get recognised as one
 * word typed twice rather than two words.
 *
 * @param {string} value
 * @returns {string}
 */
function foldDiacritics(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/[åÅ]/g, 'a')
    .replace(/[łŁ]/g, 'l')
    .toLowerCase();
}

/**
 * Group a reference dictionary's keys by their normalised English text, keeping
 * only the texts carried by two or more keys.
 *
 * A text under a single key has nothing to be inconsistent *with*, so it cannot
 * produce a finding and is dropped here rather than filtered later.
 *
 * @param {Record<string, unknown>} reference - the `en/` dictionary
 * @returns {Map<string, string[]>} normalised English -> sorted keys
 */
export function groupByEnglish(reference) {
  /** @type {Map<string, string[]>} */
  const byText = new Map();
  for (const [key, value] of Object.entries(reference)) {
    if (typeof value !== 'string') continue;
    const text = normalizeText(value);
    const keys = byText.get(text);
    if (keys) keys.push(key);
    else byText.set(text, [key]);
  }
  for (const [text, keys] of byText) {
    if (keys.length < 2) byText.delete(text);
    else keys.sort();
  }
  return byText;
}

/**
 * @typedef {object} AnchorFinding
 * @property {string} locale   the locale spelling one concept two ways
 * @property {string} concept  the normalised English text they share
 * @property {string[]} forms  the distinct forms, sorted
 * @property {string[]} keys   every key in the concept the locale defines, sorted
 */

/**
 * Every (locale, concept) pair where the locale uses more than one form.
 *
 * Pure — takes dictionaries rather than reading them — so the gate's negative
 * self-tests can drive it with hand-built input and prove it catches the thing
 * it exists for.
 *
 * Keys the locale does not define are skipped rather than counted as a form:
 * a missing key falls back to the English `t()` string, which is a *coverage*
 * gap and already has its own check. Counting it here would report every
 * partially translated concept as drift.
 *
 * @param {Record<string, unknown>} reference - the `en/` dictionary
 * @param {Record<string, Record<string, unknown>>} dicts - locale id -> dictionary
 * @returns {AnchorFinding[]} sorted by concept, then locale
 */
export function detectAnchorDrift(reference, dicts) {
  /** @type {AnchorFinding[]} */
  const findings = [];
  const concepts = [...groupByEnglish(reference)].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [concept, keys] of concepts) {
    for (const locale of Object.keys(dicts).sort()) {
      const dict = dicts[locale];
      /** @type {Map<string, string[]>} */
      const forms = new Map();
      for (const key of keys) {
        const value = dict[key];
        if (typeof value !== 'string') continue;
        const form = normalizeText(value);
        const owners = forms.get(form);
        if (owners) owners.push(key);
        else forms.set(form, [key]);
      }
      if (forms.size < 2) continue;
      findings.push({
        locale,
        concept,
        forms: [...forms.keys()].sort(),
        keys: [...forms.values()].flat().sort(),
      });
    }
  }
  return findings;
}

/**
 * The allowlist row identity for a finding: `"<locale>  <concept>"`.
 *
 * Two spaces, the separator every burndown in this repo uses. `normalizeText`
 * collapses runs of whitespace, so a concept can never contain the separator
 * and the row cannot be ambiguous.
 *
 * @param {{locale: string, concept: string}} finding
 * @returns {string}
 */
export function anchorRowKey(finding) {
  return `${finding.locale}  ${finding.concept}`;
}

/**
 * A ranking hint for the human deciding a row — never a verdict.
 *
 * - `diacritics` — the forms are the same word, one typed without its accents.
 *   The only cohort that is unambiguously a defect.
 * - `english-variant` — one form is the English concept verbatim: either an
 *   untranslated leftover or a deliberate anchor. The half-translated cohort.
 * - `same-stem` — the forms share a prefix, so this is probably inflection
 *   (gender, number, definiteness) rather than a different word.
 * - `distinct-words` — everything else: most likely two translators' choices.
 *
 * @param {AnchorFinding} finding
 * @returns {'diacritics'|'english-variant'|'same-stem'|'distinct-words'}
 */
export function cohortOf(finding) {
  const { forms, concept } = finding;
  const folded = new Set(forms.map(foldDiacritics));
  if (folded.size < forms.length) return 'diacritics';
  if (forms.includes(concept)) return 'english-variant';
  const shortest = Math.min(...forms.map((f) => f.length));
  const stem = Math.max(3, shortest - 2);
  if (new Set(forms.map((f) => foldDiacritics(f).slice(0, stem))).size === 1) {
    return 'same-stem';
  }
  return 'distinct-words';
}

/** Every cohort `cohortOf()` can return, in report order (worst first). */
export const COHORTS = /** @type {const} */ ([
  'diacritics',
  'english-variant',
  'same-stem',
  'distinct-words',
]);

/**
 * The prefix a reason carries while nobody has judged the row yet.
 *
 * The allowlist is a burndown, not a tolerance list, and this is what makes the
 * difference machine-readable: rows whose reason starts with this word are debt
 * that must reach zero, and the gate refuses to let their number grow. A judged
 * row states *why* the two forms are correct and stays.
 */
export const UNREVIEWED = 'unreviewed';

/**
 * Read an anchor allowlist into a `rowKey -> {forms, reason}` map.
 *
 * @param {{anchors?: Record<string, {forms?: string[], reason?: string}>}} allowlist
 * @returns {Map<string, {forms: string[], reason: string}>}
 */
export function allowlistRows(allowlist) {
  return new Map(
    Object.entries(allowlist.anchors || {}).map(([row, entry]) => [
      row,
      { forms: entry.forms || [], reason: String(entry.reason || '') },
    ]),
  );
}
