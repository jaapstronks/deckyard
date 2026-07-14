import { mountLikertHill } from '../../lib/likert.js';

function clamp0(n) {
  return Math.max(0, Number(n || 0) || 0);
}

function pct(count, total) {
  if (!total) return 0;
  return Math.round((clamp0(count) / clamp0(total)) * 100);
}

export function applyPollInteractionStateToStage(stageEl, interactionState) {
  const slideId = String(interactionState?.slideId || '').trim();
  if (!stageEl || !slideId) return;
  const esc =
    (globalThis.CSS && typeof globalThis.CSS.escape === 'function'
      ? globalThis.CSS.escape
      : (s) =>
          String(s)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')) || ((s) => String(s));
  const section = stageEl.querySelector?.(
    `.deck-slide[data-slide-id="${esc(slideId)}"]`
  );
  if (!section) return;
  const pollEl = section.querySelector?.('.slide-poll[data-interaction="poll"]');
  if (!pollEl) return;

  const totals = Array.isArray(interactionState?.totals) ? interactionState.totals : [];
  const total = clamp0(interactionState?.total);
  const open = interactionState?.open != null ? !!interactionState.open : String(interactionState?.status || '') !== 'closed';

  for (let i = 0; i < totals.length; i += 1) {
    const count = clamp0(totals[i]);
    const fill = pollEl.querySelector?.(`[data-poll-bar-fill="${i}"]`);
    const countEl = pollEl.querySelector?.(`[data-poll-count="${i}"]`);
    const pctEl = pollEl.querySelector?.(`[data-poll-pct="${i}"]`);
    if (fill) fill.style.width = `${pct(count, total)}%`;
    if (countEl) countEl.textContent = String(count);
    if (pctEl) pctEl.textContent = `${pct(count, total)}%`;
  }

  const totalEl = pollEl.querySelector?.('[data-poll-total="1"]');
  if (totalEl) totalEl.textContent = `Totaal: ${total}`;

  const statusEl = pollEl.querySelector?.('[data-poll-status="1"]');
  if (statusEl) statusEl.textContent = open ? 'Open' : 'Gesloten';
}

export function applyLikertInteractionStateToStage(stageEl, interactionState) {
  const slideId = String(interactionState?.slideId || '').trim();
  if (!stageEl || !slideId) return;
  const esc =
    (globalThis.CSS && typeof globalThis.CSS.escape === 'function'
      ? globalThis.CSS.escape
      : (s) =>
          String(s)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n/g, '\\n')) || ((s) => String(s));
  const section = stageEl.querySelector?.(
    `.deck-slide[data-slide-id="${esc(slideId)}"]`
  );
  if (!section) return;
  const likertEl = section.querySelector?.('.slide-likert[data-interaction="likert"]') ||
    section.querySelector?.('.slide-likert');
  if (!likertEl) return;

  const totals = Array.isArray(interactionState?.totals) ? interactionState.totals : [];
  const total = clamp0(interactionState?.total);
  const open =
    interactionState?.open != null
      ? !!interactionState.open
      : String(interactionState?.status || '') !== 'closed';

  const hillHost = likertEl.querySelector?.('[data-likert-hill="1"]');
  if (hillHost) {
    // Lazily mount once per slide DOM.
    if (!hillHost.__sbLikertHill) {
      try {
        hillHost.__sbLikertHill = mountLikertHill(hillHost, {
          optionCount: totals.length || Number(interactionState?.optionCount || 0) || 5,
        });
      } catch {
        // ignore
      }
    }
    try {
      hillHost.__sbLikertHill?.update?.({ counts: totals, total });
    } catch {
      // ignore
    }
  }

  const totalEl = likertEl.querySelector?.('[data-poll-total="1"]');
  if (totalEl) totalEl.textContent = `Totaal: ${total}`;

  const statusEl = likertEl.querySelector?.('[data-poll-status="1"]');
  if (statusEl) statusEl.textContent = open ? 'Open' : 'Gesloten';
}
