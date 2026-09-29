import fs from 'node:fs/promises';
import { once } from 'node:events';
import { envStr, envBool } from '../config/utils.js';

let browserPromise = null;

/**
 * Well-known browser locations, in order of preference.
 *
 * Google Chrome comes first on Linux, and `chromium-browser` last: on Ubuntu
 * since 19.10 that name is the transitional package's shell script, which
 * exists and is executable but only tells you to `snap install chromium` and
 * exits. Found first, it made every export and capture on a host that also has
 * Chrome installed fail at launch (B499). Where `chromium-browser` is the real
 * binary (Alpine, older Debian), the same package also installs `chromium`,
 * which is probed before it.
 */
export const CHROME_CANDIDATE_PATHS = Object.freeze([
  // Linux (Debian/Ubuntu/Alpine)
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  // macOS
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  // Windows (common installs)
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
]);

/**
 * @param {string} path
 * @returns {Promise<boolean>}
 */
async function isExecutableFile(path) {
  try {
    await fs.access(path, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Array<string|undefined>} paths
 * @param {(path: string) => Promise<boolean>} isExecutable
 * @returns {Promise<string>}
 */
async function firstExecutablePath(paths, isExecutable) {
  for (const p of paths) {
    const t = String(p || '').trim();
    if (!t) continue;
    if (await isExecutable(t)) return t;
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
 * @param {object} [options]
 * @param {(path: string) => Promise<boolean>} [options.isExecutable] Test
 *   seam: whether a candidate path is an executable file.
 * @returns {Promise<string>} Absolute path to the browser, or '' if none found.
 */
export async function resolveChromeExecutablePath({
  isExecutable = isExecutableFile,
} = {}) {
  const envPath = envStr('PUPPETEER_EXECUTABLE_PATH') || envStr('CHROME_BIN');
  return firstExecutablePath(
    [envPath, ...CHROME_CANDIDATE_PATHS],
    isExecutable,
  );
}

export async function getPuppeteerBrowser({ featureName = 'Export' } = {}) {
  if (browserPromise) return browserPromise;
  browserPromise = (async () => {
    let puppeteer;
    try {
      puppeteer = await import('puppeteer-core');
    } catch {
      const err = new Error(
        `${featureName} requires puppeteer-core. Install it with: npm i puppeteer-core`,
      );
      err.code = 'PUPPETEER_MISSING';
      throw err;
    }

    const executablePath = await resolveChromeExecutablePath();
    if (!executablePath) {
      const err = new Error(
        `${featureName} needs a Chrome/Chromium executable. Install Chrome (locally) or Chromium (in Docker), or set PUPPETEER_EXECUTABLE_PATH to the browser binary.`,
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

/** How long {@link shutDownBrowser} waits for a clean close before killing. */
export const BROWSER_CLOSE_TIMEOUT_MS = 5000;

/**
 * Close a launched browser so that nothing of it keeps the Node process alive.
 *
 * `browser.close()` alone does not promise that. Puppeteer resolves it on the
 * `exit` event of the Chrome process, but spawns that process with three
 * piped stdio streams, and a pipe stays open for as long as *any* process
 * holds its other end. A helper Chrome forks off (crashpad, an updater) that
 * inherited stdout/stderr and outlives the main process keeps those pipes -
 * and with them the event loop - alive. On macOS with Google Chrome that left
 * four `PipeWrap` handles behind and a test process that never ended (B549).
 * So after the close this drops our end of every stdio stream: whatever still
 * holds the other end can no longer hold us.
 *
 * The close itself is bounded too: a Chrome that has not exited after
 * `timeoutMs` (the same macOS case took over ten seconds) is killed.
 *
 * @param {import('puppeteer-core').Browser} browser
 * @param {object} [options]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<void>}
 */
export async function shutDownBrowser(
  browser,
  { timeoutMs = BROWSER_CLOSE_TIMEOUT_MS } = {},
) {
  const proc = browser.process();
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(true), timeoutMs);
  });
  try {
    const closed = browser.close().then(
      () => false,
      () => false,
    );
    const late = await Promise.race([closed, timedOut]);
    if (late && proc && proc.exitCode === null && proc.signalCode === null) {
      proc.kill('SIGKILL');
    }
  } finally {
    clearTimeout(timer);
  }
  await Promise.all(
    (proc?.stdio ?? []).map((stream) => {
      if (!stream || stream.closed) return undefined;
      const gone = once(stream, 'close');
      stream.destroy();
      return gone;
    }),
  );
}

/**
 * Close the shared browser and drop the cached launch promise.
 *
 * The long-lived server never calls this — the browser is reused for the
 * process lifetime on purpose. It exists so short-lived processes (tests,
 * one-shot scripts) can exit instead of hanging on a live Chrome child; see
 * {@link shutDownBrowser} for why that takes more than `browser.close()`.
 *
 * @returns {Promise<void>}
 */
export async function closePuppeteerBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (!pending) return;
  let browser;
  try {
    browser = await pending;
  } catch {
    // A browser that never launched needs no closing.
    return;
  }
  await shutDownBrowser(browser);
}
