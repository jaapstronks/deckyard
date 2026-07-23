#!/usr/bin/env node
// Interactive .env onboarding for Deckyard.
//
//   npm run setup            # ask a few questions, write .env
//   npm run setup -- --yes   # non-interactive: safe local defaults, no prompts
//
// The wizard never regenerates .env from a hardcoded schema — it upserts the
// handful of keys it asks about on top of your existing .env (or a fresh copy
// of .env.example), so keys it doesn't know about are preserved and .env.example
// stays the single source of truth for the full option list.

import { readFile, writeFile, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { constants, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_PATH = join(ROOT, '.env');
const EXAMPLE_PATH = join(ROOT, '.env.example');

/**
 * Upsert `KEY=value` pairs into an existing dotenv text, in place.
 *
 * For each key: if a line `KEY=…` or a commented `# KEY=…` exists, that line is
 * replaced (uncommented) with `KEY=value`; otherwise the pair is appended under
 * a generated footer. Only the given keys are touched — every other line,
 * including comments and unrelated values, is preserved verbatim. This keeps
 * `.env.example` as the canonical schema and avoids drift when new options are
 * added there.
 *
 * @param {string} content - existing .env (or .env.example) text
 * @param {Record<string,string>} updates - keys to set
 * @returns {string} the updated text
 */
export function upsertEnv(content, updates) {
  const lines = content.split('\n');
  const remaining = new Map(Object.entries(updates));

  const out = lines.map((line) => {
    for (const [key, value] of remaining) {
      // Match `KEY=`, optionally commented (`# KEY=`), anchored so KEY is exact
      // (OPENAI_API never matches OPENAI_COMPAT_API).
      const re = new RegExp(`^#?\\s*${key}=`);
      if (re.test(line)) {
        remaining.delete(key);
        return `${key}=${value}`;
      }
    }
    return line;
  });

  if (remaining.size > 0) {
    if (out.length > 0 && out[out.length - 1] !== '') out.push('');
    out.push('# Added by scripts/setup.js');
    for (const [key, value] of remaining) out.push(`${key}=${value}`);
  }

  return out.join('\n');
}

/** A cryptographically strong AUTH_SECRET (>= 32 chars, base64). */
export function generateSecret() {
  return randomBytes(48).toString('base64');
}

const AI_PROVIDERS = {
  none: null,
  openai: { key: 'OPENAI_API', label: 'OpenAI' },
  claude: { key: 'CLAUDE_API', label: 'Claude (Anthropic)' },
  mistral: { key: 'MISTRAL_API', label: 'Mistral' },
  deepseek: { key: 'DEEPSEEK_API', label: 'DeepSeek' },
  ollama: { key: null, label: 'Ollama / OpenAI-compatible (local, no key)' },
};

// The natural-guess env names for AI keys and the names Deckyard actually
// reads. A user hand-adding `OPENAI_API_KEY` (the industry-standard name) to
// `.env` is silently ignored, because the app reads `OPENAI_API`. Detect that
// and warn at setup instead of leaving the AI features mysteriously off.
const AI_KEY_ALIASES = [
  { stray: 'OPENAI_API_KEY', canonical: 'OPENAI_API', label: 'OpenAI' },
  { stray: 'ANTHROPIC_API_KEY', canonical: 'CLAUDE_API', label: 'Claude (Anthropic)' },
];

/**
 * Whether an env `KEY=value` line is present with a non-empty, non-commented
 * value in the given .env content.
 * @param {string} content
 * @param {string} key
 * @returns {boolean}
 */
export function hasEnvValue(content, key) {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, 'm');
  const m = String(content || '').match(re);
  return !!(m && m[1].trim());
}

/**
 * Build warnings for stray AI-key names: a natural-guess variable is set but the
 * canonical one Deckyard reads is not, so the key would be silently ignored.
 * @param {string} content - .env content to inspect
 * @returns {string[]} human-readable warning lines
 */
export function strayAiKeyWarnings(content) {
  const warnings = [];
  for (const { stray, canonical, label } of AI_KEY_ALIASES) {
    if (hasEnvValue(content, stray) && !hasEnvValue(content, canonical)) {
      warnings.push(
        `⚠ Found ${stray} in .env, but Deckyard reads ${canonical} for ${label}. ` +
          `Rename it to ${canonical}= or the key is ignored.`
      );
    }
  }
  return warnings;
}

async function exists(p) {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function baseContent() {
  if (await exists(ENV_PATH)) return readFile(ENV_PATH, 'utf8');
  if (await exists(EXAMPLE_PATH)) return readFile(EXAMPLE_PATH, 'utf8');
  return '# Deckyard .env\n';
}

/**
 * Parse `--flag value` / `--flag=value` pairs into a plain object. A flag with
 * no value (end of args, or followed by another flag) becomes `'true'`. Used
 * for the non-interactive/agent path so a coding agent can pass a user's
 * choices without driving the prompts.
 *
 * @param {string[]} argv - args after the script name
 * @returns {Record<string,string>}
 */
export function parseFlags(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq !== -1) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
    } else {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

/**
 * Build the .env updates for the non-interactive path from parsed flags. With
 * no relevant flags this is the safe local default (auth off, no AI provider) —
 * identical to what a bare `--yes` produces.
 *
 * Recognised: `--ai <provider>` + `--ai-key <key>` (openai|claude|mistral|
 * deepseek|ollama), `--ollama-endpoint`/`--ollama-model`, `--auth on|off`,
 * `--admin-email`, `--port`, `--theme`.
 *
 * @param {Record<string,string>} flags
 * @returns {Record<string,string>}
 */
export function flagUpdates(flags = {}) {
  const port = flags.port || '4177';
  const updates = { PORT: port };

  const ai = String(flags.ai || 'none').toLowerCase();
  const provider = AI_PROVIDERS[ai];
  if (provider?.key && flags['ai-key']) {
    updates[provider.key] = flags['ai-key'];
  } else if (ai === 'ollama') {
    updates.OPENAI_COMPAT_ENDPOINT =
      flags['ollama-endpoint'] || 'http://localhost:11434/v1/chat/completions';
    if (flags['ollama-model']) updates.OPENAI_COMPAT_MODEL = flags['ollama-model'];
  }

  const auth = String(flags.auth || 'off').toLowerCase();
  const authOn = auth === 'on' || auth === 'true';
  if (authOn) {
    updates.AUTH_SECRET = generateSecret();
    if (flags['admin-email']) updates.AUTH_ADMIN_EMAIL = flags['admin-email'];
    // Leave AUTH_ENABLED unset → defaults to enabled when a secret is present.
  } else {
    updates.AUTH_ENABLED = 'false';
  }

  // APP_URL powers absolute links (MCP edit/present URLs, exports, share links).
  // An explicit --app-url always wins; otherwise the local (auth-off) profile
  // defaults to localhost so `get_presentation_url` works out of the box. For an
  // auth-on (production) install we leave it unset so the operator sets APP_URL
  // or DOMAIN to the real public origin.
  if (flags['app-url']) updates.APP_URL = flags['app-url'];
  else if (!authOn) updates.APP_URL = `http://localhost:${port}`;

  if (flags.theme && flags.theme !== 'deckyard') updates.DEFAULT_THEME = flags.theme;

  return updates;
}

async function runWizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (q, def) => {
    const a = (await rl.question(def ? `${q} [${def}]: ` : `${q}: `)).trim();
    return a || def || '';
  };
  const askYesNo = async (q, def = false) => {
    const a = (await rl.question(`${q} [${def ? 'Y/n' : 'y/N'}]: `)).trim().toLowerCase();
    if (!a) return def;
    return a === 'y' || a === 'yes';
  };

  const updates = {};
  try {
    console.log('\nDeckyard setup — Enter accepts the default in brackets.\n');

    updates.PORT = await ask('Port', '4177');

    // --- AI provider ---
    console.log('\nAI wizard (optional). Pick a provider, or none:');
    const keys = Object.keys(AI_PROVIDERS);
    keys.forEach((k, i) => console.log(`  ${i + 1}) ${AI_PROVIDERS[k]?.label || 'None'}`));
    const pick = await ask('Provider number', '1');
    const chosen = keys[(parseInt(pick, 10) || 1) - 1] || 'none';
    const provider = AI_PROVIDERS[chosen];
    if (provider?.key) {
      const apiKey = await ask(`${provider.label} API key (blank to skip)`, '');
      if (apiKey) updates[provider.key] = apiKey;
    } else if (chosen === 'ollama') {
      updates.OPENAI_COMPAT_ENDPOINT = await ask(
        'OpenAI-compatible endpoint',
        'http://localhost:11434/v1/chat/completions',
      );
      updates.OPENAI_COMPAT_MODEL = await ask('Model', 'qwen2.5:72b');
    }

    // --- auth ---
    console.log('\nAuthentication. Leave off for a local single-user try; turn');
    console.log('on for anything reachable from the internet.');
    const authOn = await askYesNo('Enable authentication?', false);
    if (authOn) {
      updates.AUTH_SECRET = generateSecret();
      updates.AUTH_ADMIN_EMAIL = await ask('Admin email (gets the admin role)', '');
      // Leave AUTH_ENABLED unset → defaults to enabled when a secret is present.
      console.log('  Generated a strong AUTH_SECRET for you.');
      const publicUrl = await ask(
        'Public URL (APP_URL, e.g. https://slides.example.com; blank to set later)',
        '',
      );
      if (publicUrl) updates.APP_URL = publicUrl.replace(/\/+$/, '');
    } else {
      updates.AUTH_ENABLED = 'false';
      // Local single-user profile: default APP_URL so MCP edit/present links and
      // exports resolve without extra configuration.
      updates.APP_URL = `http://localhost:${updates.PORT || '4177'}`;
    }

    // --- theme ---
    const theme = await ask('\nDefault theme id', 'deckyard');
    if (theme && theme !== 'deckyard') updates.DEFAULT_THEME = theme;
  } finally {
    rl.close();
  }
  return updates;
}

async function main() {
  const nonInteractive =
    process.argv.includes('--yes') ||
    process.argv.includes('-y') ||
    !process.stdin.isTTY;

  const updates = nonInteractive
    ? flagUpdates(parseFlags(process.argv.slice(2)))
    : await runWizard();
  const content = upsertEnv(await baseContent(), updates);
  await writeFile(ENV_PATH, content, 'utf8');

  console.log(`\n✓ Wrote ${ENV_PATH}`);
  for (const warning of strayAiKeyWarnings(content)) console.log(`  ${warning}`);
  if (nonInteractive) {
    console.log('  (non-interactive defaults: auth disabled, no AI provider)');
    console.log('  Run `npm run setup` interactively to add an API key or enable auth.');
  }
  console.log('  Start Deckyard with: npm run start');
}

// Only run the wizard when executed directly (not when imported by tests).
// pathToFileURL + realpathSync make this robust to spaces in the path and to
// symlinked temp dirs, which a naive `file://${argv[1]}` comparison mangles.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

if (invokedDirectly()) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
