#!/usr/bin/env node

/**
 * Verify downloaded edition packages offline (T1.4).
 *
 * A package is what `/p/<publication>/<version>/edition.zip` serves: the
 * edition record, the manifest and the input, with font faces replaced by
 * their hash (D367). This script needs no database, no network and no
 * installation: only the zip files and, optionally, the font files.
 *
 * It reports three things apart, because they mean different things:
 *
 *   1. **Bytes.** Per package: valid, or the named problems (a corrupt input,
 *      a manifest that does not match, a record that names another manifest).
 *   2. **Withheld fonts.** The fonts the package names by hash only. Pass the
 *      font files with `--font` to check them and the input hash as a whole.
 *   3. **Chain.** Each record names its predecessor's manifest hash. Between
 *      the packages given: complete, a missing link (that version was not
 *      supplied: incomplete evidence), or a mismatch.
 *
 * A hash proves equality with the bytes received, not who published them or
 * when.
 *
 * Usage:
 *   node scripts/verify-edition.js edition-…-v2.zip [edition-…-v1.zip …]
 *   node scripts/verify-edition.js edition.zip --font Inter.woff2 --font …
 *   node scripts/verify-edition.js edition.zip --json
 *
 * Exit 0: every package valid and the chain between them complete. Exit 1:
 * a package is corrupt or the chain has a mismatch. Exit 2: the bytes are
 * valid but the chain has a missing link.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { isCli } from './lib/is-cli.js';
import {
  readEditionPackage,
  verifyEditionPackages,
} from '../server/export/edition-package.js';

/**
 * @param {string[]} argv
 * @returns {Promise<number>} exit code
 */
export async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      font: { type: 'string', multiple: true, default: [] },
      json: { type: 'boolean', default: false },
    },
  });
  if (!positionals.length) {
    console.error(
      'usage: node scripts/verify-edition.js <package.zip>… [--font <file>]… [--json]',
    );
    return 1;
  }

  const packages = [];
  for (const file of positionals) {
    packages.push({
      name: path.basename(file),
      ...(await readEditionPackage(await readFile(file))),
    });
  }
  const fonts = await Promise.all(values.font.map((f) => readFile(f)));
  const report = verifyEditionPackages(packages, { fonts });

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    for (const p of report.packages) {
      const label = `${p.name}${p.version ? ` (version ${p.version})` : ''}`;
      if (p.valid) {
        console.log(
          `bytes   ${label}: valid${p.inputHashChecked ? ', input hash checked' : ', every part but the withheld fonts checked'}`,
        );
      } else {
        console.log(`bytes   ${label}: CORRUPT`);
        for (const problem of p.problems) {
          console.log(`          ${problem.code}: ${problem.message}`);
        }
      }
      for (const w of p.withheld) {
        console.log(
          `fonts   ${label}: withheld ${w.mediaType} sha256 ${w.sha256}${w.bytes ? ` (${w.bytes} bytes)` : ''}`,
        );
      }
    }
    if (report.chain.complete) {
      console.log('chain   complete between the packages given');
    }
    for (const m of report.chain.missing) {
      console.log(
        `chain   missing link: version ${m.version} (manifest ${m.manifestHash ?? 'unknown'}) was not supplied`,
      );
    }
    for (const m of report.chain.mismatched) {
      console.log(`chain   MISMATCH: ${m.message}`);
    }
  }

  const corrupt =
    report.packages.some((p) => !p.valid) || report.chain.mismatched.length;
  if (corrupt) return 1;
  if (report.chain.missing.length) return 2;
  return 0;
}

if (isCli(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
