import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../config/storage-paths.js';
import { sandboxEnabled } from '../config/sandbox.js';

const CODES_FILE = 'follow-codes.json';

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

function generateCode() {
  // Use only letters that are visually distinct from numbers and each other
  // Avoid: O (looks like 0), I (looks like 1), Q (looks like O), S (looks like 5), Z (looks like 2)
  const chars = 'ABCDEFGHJKLMNPRTUVWXY';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
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