import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { customDirFor } from '../../shared/custom-root.js';

/** One installation name, used only for provenance and never authorization. */
export async function installationExtensionName(repoRoot) {
  let raw;
  try {
    raw = await readFile(
      join(customDirFor(repoRoot), 'extension.json'),
      'utf8',
    );
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new Error('custom/extension.json must be valid JSON');
  }
  if (
    !record ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    Object.keys(record).length !== 1 ||
    typeof record.name !== 'string' ||
    !record.name.trim() ||
    record.name !== record.name.trim()
  ) {
    throw new Error('custom/extension.json must contain one non-empty name');
  }
  return record.name;
}

/** Refuse a running code extension without its installation name. */
export async function assertExtensionDeclared(repoRoot) {
  const root = customDirFor(repoRoot);
  const candidates = [
    ['slide-types', '.js'],
    ['styles', '.css'],
    ['ai', '.js'],
  ];
  let codePresent = false;
  for (const [directory, suffix] of candidates) {
    const files = await readdir(join(root, directory)).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    if (
      files.some(
        (name) =>
          !name.startsWith('.') &&
          !name.startsWith('_') &&
          name.endsWith(suffix),
      )
    ) {
      codePresent = true;
      break;
    }
  }
  if (!codePresent) {
    for (const name of ['fonts.js', 'mcp-tools.js']) {
      try {
        await readFile(join(root, name));
        codePresent = true;
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  const extension = await installationExtensionName(repoRoot);
  if (codePresent && !extension) {
    throw new Error(
      'custom/extension.json with one name is required when custom code is loaded',
    );
  }
  return extension;
}
