import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../config/storage-paths.js';
import { sandboxEnabled } from '../config/sandbox.js';

const CODES_FILE = 'follow-codes.json';

// Follow codes are guessable live-session handles: a valid one resolves to a
// presenter's live follow URL. Use a CSPRNG (not Math.random, which is
// predictable) over a large-enough keyspace. 21 unambiguous letters ^ 5 chars
// ≈ 4.08M combinations, so the 60/hr/IP resolve throttle keeps guessing
// infeasible. See security audit M3.
const CODE_LENGTH = 5;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPRTUVWXY';

function codesFilePath(repoRoot) {
  return path.join(dataDir(repoRoot), CODES_FILE);
}

async function readCodes(repoRoot) {
  try {
    const content = await fs.readFile(codesFilePath(repoRoot), 'utf8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeCodes(repoRoot, codes) {
  const filePath = codesFilePath(repoRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(codes, null, 2), 'utf8');
}

export function generateCode() {
  // Alphabet excludes glyphs that are easy to misread: O/0, I/1, Q/O, S/5, Z/2.
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function isCodeExpired(entry, maxAgeMs = 24 * 60 * 60 * 1000) {
  const now = Date.now();
  return now - entry.created > maxAgeMs;
}

export async function createFollowCode(repoRoot, followUrl) {
  const filePath = codesFilePath(repoRoot);
  console.log(`[Follow Codes] Creating code, writing to: ${filePath}`);

  const codes = await readCodes(repoRoot);

  // Clean up expired codes first
  const now = Date.now();
  for (const [code, entry] of Object.entries(codes)) {
    if (isCodeExpired(entry)) {
      delete codes[code];
    }
  }
  
  // Generate a unique code
  let code;
  let attempts = 0;
  do {
    code = generateCode();
    attempts++;
    if (attempts > 100) {
      throw new Error('Unable to generate unique follow code');
    }
  } while (codes[code]);
  
  // Store the code mapping
  codes[code] = {
    followUrl,
    created: now,
  };
  
  await writeCodes(repoRoot, codes);
  return code;
}

export async function resolveFollowCode(repoRoot, code) {
  const filePath = codesFilePath(repoRoot);
  console.log(`[Follow Codes] Reading codes from: ${filePath} (sandbox: ${sandboxEnabled()})`);

  const codes = await readCodes(repoRoot);
  const upperCode = code.toUpperCase();
  const entry = codes[upperCode];

  console.log(`[Follow Codes] Looking up code: ${upperCode}, found: ${!!entry}, total codes in file: ${Object.keys(codes).length}`);

  if (!entry) return null;
  if (isCodeExpired(entry)) {
    // Clean up expired code
    console.log(`[Follow Codes] Code ${upperCode} is expired (created: ${entry.created}, age: ${Date.now() - entry.created}ms)`);
    delete codes[upperCode];
    await writeCodes(repoRoot, codes);
    return null;
  }

  return entry.followUrl;
}

export async function cleanupExpiredCodes(repoRoot) {
  const codes = await readCodes(repoRoot);
  let cleaned = 0;
  
  for (const [code, entry] of Object.entries(codes)) {
    if (isCodeExpired(entry)) {
      delete codes[code];
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    await writeCodes(repoRoot, codes);
  }
  
  return cleaned;
}