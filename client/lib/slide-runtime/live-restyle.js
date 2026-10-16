import { renderSlideHtml } from '../../../shared/slide-types.js';
import { h } from '../dom/index.js';
import { needsServerRender } from './slide-render.js';

/**
 * Restyle a mounted slide in place while an inline edit is active (B719).
 *
 * The editor never remounts the canvas mid-edit: that would wipe the element
 * the user is typing in, and their caret with it. But a style or layout commit
 * from the inspector (Text size L, Layout → Centred) changes nothing but
 * classes and inline style on the slide root and its fields, so it can land on
 * the living DOM without touching the text.
 *
 * The delta is taken between two renders of the slide - as it was mounted and
 * as it is now - and only that delta is applied. Diffing the fresh render
 * against the live element instead would strip what the canvas added after
 * mounting: the inline editor's `ie-*` classes and the theme variables on the
 * root's `style`. Elements are paired by `data-inline-field` (ordinal within a
 * key), the root with the root; anything structural (a layout that renders
 * other markup) is left for the deferred re-render after the edit, which stays
 * the safety net.
 *
 * @param {Element|null} liveEl - the mounted slide element (`.slide`)
 * @param {Object} before - the slide as it was mounted (a snapshot)
 * @param {Object} after - the slide as it is now
 * @param {Object} opts - render options, as for `renderSlideHtml`; `lang`
 *   is the deck's (`resolveDeckLang`)
 * @returns {boolean} whether a delta was applied
 */
export function restyleLiveSlide(liveEl, before, after, opts) {
  if (!liveEl || !before || !after) return false;
  if (needsServerRender(after.type) || before.type !== after.type) return false;
  const was = renderDetached(before, opts);
  const now = renderDetached(after, opts);
  if (!was || !now) return false;
  const live = fieldIndex(liveEl);
  const wasFields = fieldIndex(was);
  let changed = applyDelta(liveEl, was, now);
  for (const [key, nowEl] of fieldIndex(now)) {
    const wasEl = wasFields.get(key);
    const liveField = live.get(key);
    if (wasEl && liveField)
      changed = applyDelta(liveField, wasEl, nowEl) || changed;
  }
  return changed;
}

/**
 * Parse a render into a detached `<template>`: nothing in it loads or runs,
 * and it never reaches the page.
 */
function renderDetached(slide, { mode, theme, presentationId, lang }) {
  const html = renderSlideHtml(slide, {
    mode,
    theme,
    presentationId,
    lang,
  }).trim();
  const tpl = h('template');
  tpl.innerHTML = html;
  return tpl.content.firstElementChild;
}

/** `data-inline-field` → element, a repeated key numbered by its ordinal. */
function fieldIndex(root) {
  const out = new Map();
  const seen = new Map();
  for (const el of root.querySelectorAll('[data-inline-field]')) {
    const key = el.getAttribute('data-inline-field');
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    out.set(`${key}#${n}`, el);
  }
  return out;
}

/** Apply the class and inline-style change from `was` to `now` onto `live`. */
function applyDelta(live, was, now) {
  let changed = false;
  const wasClasses = new Set(was.classList);
  const nowClasses = new Set(now.classList);
  for (const c of wasClasses) {
    if (!nowClasses.has(c) && live.classList.contains(c)) {
      live.classList.remove(c);
      changed = true;
    }
  }
  for (const c of nowClasses) {
    if (!wasClasses.has(c) && !live.classList.contains(c)) {
      live.classList.add(c);
      changed = true;
    }
  }
  if (was.getAttribute('style') !== now.getAttribute('style')) {
    for (const prop of styleProps(was)) {
      if (!now.style.getPropertyValue(prop)) live.style.removeProperty(prop);
    }
    for (const prop of styleProps(now)) {
      live.style.setProperty(
        prop,
        now.style.getPropertyValue(prop),
        now.style.getPropertyPriority(prop),
      );
    }
    changed = true;
  }
  return changed;
}

function styleProps(el) {
  return Array.from({ length: el.style.length }, (_, i) => el.style.item(i));
}
