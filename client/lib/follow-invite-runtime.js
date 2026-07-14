import { createQrDataUrl, renderQrToCanvas } from './poll.js';

const followCodeCache = new Map();

function absUrlFor(relOrAbs) {
  const s = String(relOrAbs || '').trim();
  if (!s) return '';
  try {
    return new URL(s, location.origin).href;
  } catch {
    return s;
  }
}

async function getOrCreateFollowCode(followUrl) {
  const key = String(followUrl || '').trim();
  if (!key) return '';
  if (followCodeCache.has(key)) return await followCodeCache.get(key);
  const p = (async () => {
    const res = await fetch('/api/follow-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followUrl: key }),
    });
    if (!res.ok) return '';
    const data = await res.json().catch(() => ({}));
    const code = String(data?.code || '').trim().toUpperCase();
    return code;
  })();
  followCodeCache.set(key, p);
  return await p;
}

export function initFollowInviteSlides(
  rootEl,
  { enableResize = true, interactive = true } = {}
) {
  if (!rootEl?.querySelectorAll) return () => {};
  const cleanups = [];

  // Fill any "/go" link UI to absolute URL.
  try {
    const goEls = [];
    if (rootEl.matches?.('[data-follow-go-url="1"]')) goEls.push(rootEl);
    goEls.push(...Array.from(rootEl.querySelectorAll('[data-follow-go-url="1"]')));
    const goAbs = absUrlFor('/go');
    for (const el of goEls) {
      try {
        if (el.tagName === 'A') {
          el.setAttribute('href', goAbs);
          if (!String(el.textContent || '').trim()) el.textContent = goAbs;
          else if (String(el.textContent || '').trim() === '/go') el.textContent = goAbs;
        } else {
          el.textContent = goAbs;
        }
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  const canvases = [];
  try {
    if (rootEl.matches?.('canvas[data-follow-qr="1"]')) canvases.push(rootEl);
  } catch {}
  canvases.push(
    ...Array.from(rootEl.querySelectorAll('canvas[data-follow-qr="1"]'))
  );

  for (const canvas of canvases) {
    if (canvas.dataset.followInit === '1') continue;
    canvas.dataset.followInit = '1';

    const rel = String(canvas.dataset.followUrl || '').trim();
    const url = absUrlFor(rel);
    if (!url) continue;

    const rerender = () => {
      try {
        const isFollowInviteQr =
          !!canvas?.classList?.contains?.('sfi-qr');

        // Ensure the canvas never visually exceeds its card width.
        try {
          // For the follow-invite slide we size the QR via CSS (big-screen layout).
          // Don't override with inline styles (they win over CSS and can cause clipping).
          if (!isFollowInviteQr) canvas.style.width = '100%';
          else canvas.style.width = '';
          canvas.style.maxWidth = '100%';
          canvas.style.height = 'auto';
          canvas.style.display = 'block';
        } catch {}

        const cardW =
          Number(canvas?.parentElement?.clientWidth || 0) ||
          Number(canvas?.getBoundingClientRect?.().width || 0) ||
          0;
        const maxPx = Math.min(
          560,
          Math.max(160, Math.floor((cardW || window.innerWidth) - 28))
        );
        const ok = renderQrToCanvas(canvas, url, {
          maxPx,
        });
        if (ok) return;
        // Fallback: canvas rendering can fail in some contexts; use data URL image.
        const img = document.createElement('img');
        img.alt = 'QR code';
        img.src = createQrDataUrl(url, { size: Math.min(420, Math.max(220, maxPx)) });
        if (isFollowInviteQr) img.className = 'sfi-qr';
        img.style.maxWidth = '100%';
        img.style.height = 'auto';
        img.style.display = 'block';
        canvas.replaceWith(img);
      } catch {
        // ignore
      }
    };

    // Also fill the visible text URL if present
    try {
      const wrap = canvas.closest('.slide') || rootEl;
      const local =
        canvas?.parentElement?.querySelector?.('[data-follow-url-text="1"]') ||
        null;
      const txt = local || wrap?.querySelector?.('[data-follow-url-text="1"]');
      if (txt) txt.textContent = url;
    } catch {}

    rerender();
    if (enableResize) {
      window.addEventListener('resize', rerender);
      cleanups.push(() => window.removeEventListener('resize', rerender));
    }
  }

  // Fill 4-letter code for the follow-invite slide when not provided via render context.
  // (Some views render slides without a presenter session context.)
  try {
    const codeEls = Array.from(rootEl.querySelectorAll('.sfi-code'));
    const placeholders = codeEls.filter((el) =>
      String(el?.textContent || '').trim().replace(/-/g, '') === ''
    );
    if (placeholders.length) {
      const anyCanvas =
        rootEl.querySelector('canvas[data-follow-qr="1"]') ||
        rootEl.querySelector('img.sfi-qr') ||
        null;
      const followUrl =
        String(anyCanvas?.dataset?.followUrl || '').trim() ||
        String(rootEl.querySelector('canvas[data-follow-qr="1"]')?.dataset?.followUrl || '').trim();
      if (followUrl) {
        getOrCreateFollowCode(followUrl)
          .then((code) => {
            if (!code) return;
            for (const el of placeholders) {
              try {
                el.textContent = code;
              } catch {
                // ignore
              }
            }
          })
          .catch(() => {});
      }
    }
  } catch {
    // ignore
  }

  return () => {
    for (const fn of cleanups) {
      try {
        fn();
      } catch {}
    }
  };
}
