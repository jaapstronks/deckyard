export function removeCardAtIndex(slide, idx1) {
  // Support both the canonical items[] array and legacy numbered fields.
  const items = slide.content?.items;

  if (Array.isArray(items) && items.length > 0) {
    if (items.length <= 1) return false;
    const idx = Math.max(0, Math.min(items.length - 1, Number(idx1) - 1));
    items.splice(idx, 1);

    // Keep the numbered mirror in sync for backward compatibility.
    slide.content.cardCount = String(items.length);
    for (let i = 0; i < 6; i += 1) {
      const item = items[i] || {};
      slide.content[`card${i + 1}Title`] = item.title || '';
      slide.content[`card${i + 1}Body`] = item.body || '';
    }
    return true;
  }

  // Legacy numbered fields fallback.
  const count = Math.max(1, Math.min(6, Number(slide?.content?.cardCount || 4) || 4));
  const idx = Math.max(1, Math.min(count, Number(idx1) || 1));
  if (count <= 1) return false;

  // Shift cards up from idx..count-1
  for (let i = idx; i < count; i += 1) {
    slide.content[`card${i}Title`] = slide.content?.[`card${i + 1}Title`] || '';
    slide.content[`card${i}Body`] = slide.content?.[`card${i + 1}Body`] || '';
  }
  slide.content[`card${count}Title`] = '';
  slide.content[`card${count}Body`] = '';
  slide.content.cardCount = String(count - 1);
  return true;
}

export function removeIconGridCardAtIndex(slide, idx1) {
  // Support both items[] array and legacy numbered fields
  const items = slide.content?.items;

  if (Array.isArray(items) && items.length > 0) {
    // New items[] format
    if (items.length <= 1) return false;
    const idx = Math.max(0, Math.min(items.length - 1, Number(idx1) - 1));
    items.splice(idx, 1);

    // Sync back to numbered fields for backward compatibility
    slide.content.cardCount = String(items.length);
    for (let i = 0; i < 6; i++) {
      const item = items[i] || {};
      slide.content[`card${i + 1}Icon`] = item.icon || '';
      slide.content[`card${i + 1}Title`] = item.title || '';
      slide.content[`card${i + 1}Body`] = item.body || '';
    }
    return true;
  }

  // Legacy numbered fields fallback
  const clampCount = () =>
    Math.max(
      1,
      Math.min(6, Number(slide?.content?.cardCount || 6) || 6)
    );
  const count = clampCount();
  const idx = Math.max(1, Math.min(count, Number(idx1) || 1));
  if (count <= 1) return false;

  for (let i = idx; i < count; i += 1) {
    slide.content[`card${i}Icon`] = slide.content?.[`card${i + 1}Icon`] || '';
    slide.content[`card${i}Title`] =
      slide.content?.[`card${i + 1}Title`] || '';
    slide.content[`card${i}Body`] = slide.content?.[`card${i + 1}Body`] || '';
  }
  slide.content[`card${count}Icon`] = '';
  slide.content[`card${count}Title`] = '';
  slide.content[`card${count}Body`] = '';
  slide.content.cardCount = String(count - 1);
  return true;
}

export function removeTeamCardAtIndex(slide, idx1) {
  // Support both members[] array and legacy numbered fields
  const members = slide.content?.members;

  if (Array.isArray(members) && members.length > 0) {
    // New members[] format
    if (members.length <= 1) return false;
    const idx = Math.max(0, Math.min(members.length - 1, Number(idx1) - 1));
    members.splice(idx, 1);

    // Sync back to numbered fields for backward compatibility
    slide.content.cardCount = String(members.length);
    for (let i = 0; i < 12; i++) {
      const m = members[i] || {};
      slide.content[`card${i + 1}Image`] = m.image || '';
      slide.content[`card${i + 1}Alt`] = m.alt || '';
      slide.content[`card${i + 1}ImageFocusX`] = m.imageFocusX ?? 50;
      slide.content[`card${i + 1}ImageFocusY`] = m.imageFocusY ?? 50;
      slide.content[`card${i + 1}Name`] = m.name || '';
      slide.content[`card${i + 1}Byline`] = m.byline || '';
    }
    return true;
  }

  // Legacy numbered fields fallback
  const MAX = 12;
  const clampCount = () =>
    Math.max(
      1,
      Math.min(MAX, Number(slide?.content?.cardCount || 1) || 1)
    );
  const count = clampCount();
  const idx = Math.max(1, Math.min(count, Number(idx1) || 1));
  if (count <= 1) return false;

  for (let i = idx; i < count; i += 1) {
    slide.content[`card${i}Image`] = slide.content?.[`card${i + 1}Image`] || '';
    slide.content[`card${i}Alt`] = slide.content?.[`card${i + 1}Alt`] || '';
    slide.content[`card${i}ImageFocusX`] = slide.content?.[`card${i + 1}ImageFocusX`] ?? 50;
    slide.content[`card${i}ImageFocusY`] = slide.content?.[`card${i + 1}ImageFocusY`] ?? 50;
    slide.content[`card${i}Name`] = slide.content?.[`card${i + 1}Name`] || '';
    slide.content[`card${i}Byline`] = slide.content?.[`card${i + 1}Byline`] || '';
  }
  slide.content[`card${count}Image`] = '';
  slide.content[`card${count}Alt`] = '';
  slide.content[`card${count}ImageFocusX`] = 50;
  slide.content[`card${count}ImageFocusY`] = 50;
  slide.content[`card${count}Name`] = '';
  slide.content[`card${count}Byline`] = '';
  slide.content.cardCount = String(count - 1);
  return true;
}

export function removeLogoWallItemAtIndex(slide, idx1) {
  // Support both logos[] array and legacy numbered fields
  const logos = slide.content?.logos;

  if (Array.isArray(logos) && logos.length > 0) {
    // New logos[] format
    if (logos.length <= 1) return false;
    const idx = Math.max(0, Math.min(logos.length - 1, Number(idx1) - 1));
    logos.splice(idx, 1);

    // Sync back to numbered fields for backward compatibility
    slide.content.logoCount = String(logos.length);
    for (let i = 0; i < 12; i++) {
      const l = logos[i] || {};
      slide.content[`logo${i + 1}Image`] = l.image || '';
      slide.content[`logo${i + 1}Name`] = l.name || '';
      slide.content[`logo${i + 1}Alt`] = l.alt || '';
    }
    return true;
  }

  // Legacy numbered fields fallback
  const MAX = 12;
  const clampCount = () =>
    Math.max(
      1,
      Math.min(MAX, Number(slide?.content?.logoCount || 1) || 1)
    );
  const count = clampCount();
  const idx = Math.max(1, Math.min(count, Number(idx1) || 1));
  if (count <= 1) return false;

  for (let i = idx; i < count; i += 1) {
    slide.content[`logo${i}Image`] = slide.content?.[`logo${i + 1}Image`] || '';
    slide.content[`logo${i}Name`] = slide.content?.[`logo${i + 1}Name`] || '';
    slide.content[`logo${i}Alt`] = slide.content?.[`logo${i + 1}Alt`] || '';
  }
  slide.content[`logo${count}Image`] = '';
  slide.content[`logo${count}Name`] = '';
  slide.content[`logo${count}Alt`] = '';
  slide.content.logoCount = String(count - 1);
  return true;
}
