import { getPuppeteerBrowser } from './puppeteer-browser.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';

export async function renderSandboxOgImagePng() {
  const W = 1200;
  const H = 630;
  const browser = await getPuppeteerBrowser({ featureName: 'OG image' });
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
    const title = 'Deckyard';
    const subtitle = 'Sandbox';
    const tagline = 'No login • Auto-deletes after 24h • Watermarked exports';

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; width: ${W}px; height: ${H}px; }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial;
        background: radial-gradient(900px 520px at 20% 20%, rgba(56, 189, 248, 0.35), rgba(0,0,0,0) 60%),
                    radial-gradient(900px 520px at 80% 35%, rgba(34, 197, 94, 0.28), rgba(0,0,0,0) 60%),
                    radial-gradient(900px 520px at 50% 95%, rgba(167, 139, 250, 0.22), rgba(0,0,0,0) 65%),
                    linear-gradient(135deg, #070b14 0%, #0b1220 55%, #090d16 100%);
        color: #fff;
        overflow: hidden;
      }
      .frame {
        position: absolute;
        inset: 0;
        padding: 56px 64px;
        box-sizing: border-box;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
        border: 1px solid rgba(255,255,255,0.14);
        backdrop-filter: blur(10px);
        font-size: 18px;
        color: rgba(255,255,255,0.92);
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 999px;
        background: #22c55e;
        box-shadow: 0 0 0 6px rgba(34,197,94,0.18);
      }
      .title {
        margin-top: 28px;
        font-weight: 800;
        letter-spacing: -0.03em;
        font-size: 84px;
        line-height: 1.0;
      }
      .sub {
        margin-top: 10px;
        font-weight: 700;
        letter-spacing: -0.01em;
        font-size: 44px;
        color: rgba(255,255,255,0.9);
      }
      .tagline {
        margin-top: 22px;
        font-size: 22px;
        line-height: 1.35;
        color: rgba(255,255,255,0.78);
        max-width: 860px;
      }
      .brandline {
        position: absolute;
        left: 64px;
        right: 64px;
        bottom: 46px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        color: rgba(255,255,255,0.68);
        font-size: 18px;
      }
      .mono {
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
        font-size: 16px;
        opacity: 0.85;
      }
      .glow {
        position: absolute;
        width: 520px;
        height: 520px;
        right: -180px;
        bottom: -220px;
        background: radial-gradient(circle at 40% 40%, rgba(56, 189, 248, 0.35), rgba(56, 189, 248, 0) 62%);
        filter: blur(2px);
      }
    </style>
  </head>
  <body>
    <div class="frame">
      <div class="pill"><span class="dot"></span><span>${escapeHtml(subtitle)}</span></div>
      <div class="title">${escapeHtml(title)}</div>
      <div class="sub">Try it instantly</div>
      <div class="tagline">${escapeHtml(tagline)}</div>
      <div class="brandline">
        <div class="mono">sandbox.deckyard.eu</div>
        <div>Deckyard</div>
      </div>
    </div>
    <div class="glow"></div>
  </body>
</html>`;

    await page.setContent(html, { waitUntil: 'load' });
    const buf = await page.screenshot({ type: 'png', fullPage: false });
    return buf;
  } finally {
    try {
      await page.close();
    } catch {
      // ignore
    }
  }
}
