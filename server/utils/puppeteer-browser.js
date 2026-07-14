import fs from 'node:fs/promises';

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

    const envPath = String(
      process.env.PUPPETEER_EXECUTABLE_PATH ||
        process.env.CHROME_BIN ||
        ''
    ).trim();

    const candidates = [
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
    ];

    const executablePath = await firstExistingPath(candidates);
    if (!executablePath) {
      const err = new Error(
        `${featureName} needs a Chrome/Chromium executable. Install Chrome (locally) or Chromium (in Docker), or set PUPPETEER_EXECUTABLE_PATH to the browser binary.`
      );
      err.code = 'CHROME_MISSING';
      throw err;
    }

    return puppeteer.launch({
      headless: true,
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });
  })();
  return browserPromise;
}
