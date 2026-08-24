/**
 * The i18n scripts' shared flag vocabulary, and the parser that enforces it.
 *
 * Four scripts had grown four vocabularies. Two words meant "plan without
 * writing" (`--dry-run` in `i18n-sync.js`, `--report` in `i18n-fill.js`), two
 * meant "give me JSON" (`--json` in `i18n-audit.js`, and nothing at all in
 * `i18n-fill.js`, whose report was JSON because it happened to be), and only
 * one of the four rejected an argument it did not recognise — so
 * `node scripts/i18n-audit.js --orphan` printed the short report and exited 0,
 * which reads exactly like the long report being empty.
 *
 * The vocabulary, in three words:
 *
 *   - **reading is the default.** Run a script with no write flag and it tells
 *     you what it would do. Nothing writes by accident.
 *   - **`--apply` writes.** One word, every script, and it is the only way to
 *     touch a file.
 *   - **`--json` is machine output.** Without it a script talks to a human.
 *
 * `parseArgs` is the mechanical half: it rejects anything outside the spec, so
 * a fifth vocabulary cannot be added by accident — only deliberately, by
 * editing a script's spec.
 *
 * @module scripts/lib/cli-args
 */

/**
 * @typedef {object} ArgSpec
 * @property {string} usage            one-line usage string, printed on error
 * @property {string[]} [flags]        accepted `--flags`, without values
 * @property {number} [maxPositional]  how many bare arguments are allowed (0)
 */

/**
 * Parse `argv` against a spec, exiting non-zero on anything it does not name.
 *
 * The exit is the point. A typo in a flag used to be indistinguishable from a
 * clean run, which is the one failure mode a checking tool must not have.
 *
 * @param {string[]} argv - arguments after the script name
 * @param {ArgSpec} spec
 * @returns {{flags: Set<string>, positional: string[]}}
 */
export function parseArgs(argv, spec) {
  const allowed = new Set(spec.flags || []);
  const maxPositional = spec.maxPositional || 0;
  const flags = new Set();
  const positional = [];

  const fail = (message) => {
    console.error(message);
    console.error(`Usage: ${spec.usage}`);
    process.exit(1);
  };

  for (const arg of argv) {
    if (arg.startsWith('-')) {
      if (!allowed.has(arg)) fail(`Unknown option: ${arg}`);
      if (flags.has(arg)) fail(`Repeated option: ${arg}`);
      flags.add(arg);
    } else {
      positional.push(arg);
    }
  }

  if (positional.length > maxPositional) {
    fail(
      `Unexpected argument: ${positional[maxPositional]}` +
        (maxPositional === 0 ? '' : ` (at most ${maxPositional} expected)`),
    );
  }

  return { flags, positional };
}
