import fs from 'node:fs/promises';
import { envStr, envBool } from '../config/utils.js';

let browserPromise = null;

async function firstExistingPath(paths) {
  for (const p of paths) {
    const t = String(p || '').trim();
    if (!t) continue;
    try {
      await fs.access(t);
      return t;
    } catch {
      // continue
    }
  }
  return '';
}

/**
 * Normalize bytes coming back from Puppeteer into a Node Buffer.
 *
 * `page.pdf()` and `page.screenshot()` return "a Buffer or a Uint8Array
 * depending on the environment": Puppeteer prefers `Uint8Array.fromBase64()`
 * when that exists and only falls back to `Buffer.from()` otherwise. So the
 * return type flips to a plain Uint8Array the moment anything in the process
 * polyfills `fromBase64` — which pdf.js (pulled in by `pdf-parse` for PDF
 * import) does on load, and which Node will eventually do natively.
 *
 * That mattered: a plain Uint8Array has no base64 `toString()`, so
 * `bytes.toString('base64')` in the PPTX export silently produced
 * "137,80,78,71,…" instead of image data, and the export failed deep inside
 * the zip writer. Every consumer of these renders expects a Buffer, so the
 * conversion belongs here at the boundary rather than at each call site.
 *
 * @param {Buffer|Uint8Array} bytes
 * @returns {Buffer}
 */
export function toNodeBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  // Views the same memory — no copy of a multi-megabyte render.
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Locate the Chrome/Chromium binary the export chain will drive.
 *
 * `puppeteer-core` deliberately ships without a browser, so the binary comes
 * either from an env override or from a well-known install location. Exported
 * separately from {@link getPuppeteerBrowser} so callers can ask "is a browser
 * available?" without paying for a launch — the export smoke test uses it to
 * tell "no Chrome on this machine" apart from "Chrome is there and the export
 * chain is broken".
 *
 * @returns {Promise<string>} Absolute path to the browser, or '' if none found.
 */
export async function resolveChromeExecutablePath() {
  const envPath = envStr('PUPPETEER_EXECUTABLE_PATH') || envStr('CHROME_BIN');

  return firstExistingPath([
    envPath,
    // Linux (Debian/Ubuntu/Alpine)
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    // macOS
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    // Windows (common installs)
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]);
}

export async function getPuppeteerBrowser({ featureName = 'Export' } = {}) {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = await import('puppeteer-core');
    } catch {
      const err = new Error(
        `${featureName} requires puppeteer-core. Install it with: npm i puppeteer-core`
      );
      err.code = 'PUPPETEER_MISSING';
      throw err;
    }

    const executablePath = await resolveChromeExecutablePath();
    if (!executablePath) {
      const err = new Error(
        `${featureName} needs a Chrome/Chromium executable. Install Chrome (locally) or Chromium (in Docker), or set PUPPETEER_EXECUTABLE_PATH to the browser binary.`
      );
      err.code = 'CHROME_MISSING';
      throw err;
    }

    // Sandbox posture. See docs/reference/security-posture.md
    // § Headless-browser sandbox posture.
    //
    // The container image runs Chromium as a non-root user, so the old
    // "renderer escape == root in the container" risk is gone. Chromium's own
    // sandbox stays OFF by default because its namespace sandbox needs syscalls
    // that Docker's DEFAULT seccomp profile blocks (CLONE_NEWPID/NEWNET); with
    // the stock profile a sandboxed launch fails outright, breaking export.
    //
    // Operators who harden the runtime (e.g. `--cap-add=SYS_ADMIN` or a
    // Chromium seccomp profile) can re-enable the in-browser sandbox for
    // defense-in-depth by setting PUPPETEER_SANDBOX=true.
    const enableSandbox = envBool('PUPPETEER_SANDBOX');
    const args = ['--disable-dev-shm-usage'];
    if (!enableSandbox) {
      args.unshift('--no-sandbox', '--disable-setuid-sandbox');
    }

    return puppeteer.launch({
      headless: true,
      executablePath,
      args,
    });
  })();
  return browserPromise;
}

/**
 * Close the shared browser and drop the cached launch promise.
 *
 * The long-lived server never calls this — the browser is reused for the
 * process lifetime on purpose. It exists so short-lived processes (tests,
 * one-shot scripts) can exit instead of hanging on a live Chrome child.
 *
 * @returns {Promise<void>}
 */
export async function closePuppeteerBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    // A browser that never launched (or already died) needs no closing.
  }
}
