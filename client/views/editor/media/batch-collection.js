import { resolveItemDefaults } from '../../../../shared/slide-types/item-defaults.js';
import { applyAltFromPick } from './apply-pick.js';

/** The declarative image collection contract, or null for unrelated items. */
export function imageCollectionSpec(field) {
  if (field?.type !== 'items' || field.batchImages !== true) return null;
  const images = field.itemFields?.filter((item) => item?.type === 'image');
  if (images?.length !== 1) return null;
  const image = images[0];
  const alt = field.itemFields.find((item) => item?.key === 'alt');
  const name = field.itemFields.find((item) => item?.key === image.nameKey);
  const maxItems = Number(field.maxItems);
  if (!Number.isSafeInteger(maxItems) || maxItems < 1) return null;
  return {
    fieldKey: field.key,
    imageKey: image.key,
    nameKey: name?.key || null,
    maxItems,
    altMaxLength: Number(alt?.maxLength) || null,
    nameMaxLength: Number(name?.maxLength) || null,
  };
}

/** Existing empty cells count as free even when the array is at maxItems. */
export function collectionCapacity(field, items) {
  const spec = imageCollectionSpec(field);
  if (!spec) return 0;
  const list = Array.isArray(items) ? items : [];
  const empty = list
    .slice(0, spec.maxItems)
    .filter((item) => !String(item?.[spec.imageKey] || '').trim()).length;
  return empty + Math.max(0, spec.maxItems - list.length);
}

function languageTargets({ slide, pres, activeLang }) {
  const targets = [{ lang: activeLang, slide }];
  for (const [lang, version] of Object.entries(pres?.i18n?.versions || {})) {
    const match = version?.slides?.find((entry) => entry?.id === slide.id);
    if (match && !targets.some((target) => target.slide === match)) {
      targets.push({ lang, slide: match });
    }
  }
  return targets;
}

function collectionOf(target, key) {
  return Array.isArray(target.slide.content?.[key])
    ? target.slide.content[key]
    : [];
}

/** Capture the exact collection versions that an open batch may update. */
export function snapshotCollectionDestination({
  slide,
  field,
  pres,
  activeLang,
}) {
  const spec = imageCollectionSpec(field);
  if (!spec || !slide?.id) return null;
  const targets = languageTargets({ slide, pres, activeLang });
  return {
    slideId: slide.id,
    slideType: slide.type,
    fieldKey: spec.fieldKey,
    targets: targets.map((target) => ({
      ...target,
      serialized: JSON.stringify(collectionOf(target, spec.fieldKey)),
    })),
  };
}

/** Whether the selected slide and every version still match the opened batch. */
export function collectionDestinationMatches({
  slide,
  field,
  pres,
  activeLang,
  snapshot,
  currentSlideId = slide?.id,
}) {
  if (
    !snapshot ||
    currentSlideId !== snapshot.slideId ||
    !pres?.slides?.some((entry) => entry === slide)
  )
    return false;
  const current = snapshotCollectionDestination({
    slide,
    field,
    pres,
    activeLang,
  });
  return (
    !!current &&
    current.slideType === snapshot.slideType &&
    current.targets.length === snapshot.targets.length &&
    current.targets.every(
      (target, index) =>
        target.slide === snapshot.targets[index].slide &&
        target.lang === snapshot.targets[index].lang &&
        target.serialized === snapshot.targets[index].serialized,
    )
  );
}

/** Start the same batch destination flow from either editor collection surface. */
export function startBatchCollectionUpload({
  slide,
  field,
  pres,
  activeLang,
  getSelectedSlideId,
  openImagePicker,
  onApplied,
}) {
  const spec = imageCollectionSpec(field);
  if (!spec || typeof openImagePicker?.uploadMany !== 'function') return;
  const snapshot = snapshotCollectionDestination({
    slide,
    field,
    pres,
    activeLang,
  });
  const destination = { slide, field, pres, activeLang, snapshot };
  openImagePicker.uploadMany({
    spec,
    capacity: () => collectionDestinationCapacity(destination),
    validateDestination: () =>
      collectionDestinationMatches({
        ...destination,
        currentSlideId: getSelectedSlideId?.(),
      }),
    onPickMany: (picks) => {
      const result = applyBatchToCollection({
        ...destination,
        picks,
        currentSlideId: getSelectedSlideId?.(),
      });
      if (!result.ok) return false;
      onApplied?.();
      return true;
    },
  });
}

function sharedFreeSlots(spec, targets) {
  const lists = targets.map((target) => collectionOf(target, spec.fieldKey));
  const length = Math.max(0, ...lists.map((list) => list.length));
  const slots = [];
  for (let index = 0; index < Math.min(length, spec.maxItems); index += 1) {
    if (
      lists.every((list) => !String(list[index]?.[spec.imageKey] || '').trim())
    ) {
      slots.push(index);
    }
  }
  for (let index = length; index < spec.maxItems; index += 1) slots.push(index);
  return slots;
}

/** Free positions that are empty in every existing deck language version. */
export function collectionDestinationCapacity({
  slide,
  field,
  pres,
  activeLang,
}) {
  const spec = imageCollectionSpec(field);
  if (!spec || !slide?.id) return 0;
  return sharedFreeSlots(spec, languageTargets({ slide, pres, activeLang }))
    .length;
}

/**
 * Validate the destination again and apply all picks as one synchronous change.
 * No target is mutated when the slide, versions, collection, or capacity moved.
 * Call the editor's dirty/refresh hook once after an `{ ok: true }` result.
 */
export function applyBatchToCollection({
  slide,
  field,
  pres,
  activeLang,
  picks,
  snapshot,
  currentSlideId = slide?.id,
}) {
  const spec = imageCollectionSpec(field);
  const selected = Array.isArray(picks) ? picks : [];
  if (!spec || !snapshot || !selected.length)
    return { ok: false, reason: 'invalid' };
  if (
    slide?.id !== snapshot.slideId ||
    currentSlideId !== snapshot.slideId ||
    slide?.type !== snapshot.slideType ||
    field.key !== snapshot.fieldKey ||
    !pres?.slides?.some((entry) => entry === slide)
  ) {
    return { ok: false, reason: 'stale' };
  }
  const targets = languageTargets({ slide, pres, activeLang });
  if (
    targets.length !== snapshot.targets.length ||
    targets.some(
      (target, index) =>
        target.slide !== snapshot.targets[index].slide ||
        target.lang !== snapshot.targets[index].lang ||
        JSON.stringify(collectionOf(target, spec.fieldKey)) !==
          snapshot.targets[index].serialized,
    )
  ) {
    return { ok: false, reason: 'stale' };
  }
  const slots = sharedFreeSlots(spec, targets);
  if (selected.length > slots.length) {
    return { ok: false, reason: 'capacity', capacity: slots.length };
  }
  for (const picked of selected) {
    if (!String(picked?.url || '').trim()) {
      return { ok: false, reason: 'invalid' };
    }
    if (
      spec.nameMaxLength &&
      typeof picked.name === 'string' &&
      picked.name.length > spec.nameMaxLength
    ) {
      return { ok: false, reason: 'invalid' };
    }
    if (
      spec.altMaxLength &&
      Object.values(picked.alts || {}).some(
        (alt) => typeof alt === 'string' && alt.length > spec.altMaxLength,
      )
    ) {
      return { ok: false, reason: 'invalid' };
    }
  }
  const nextByTarget = targets.map((target) => ({
    target,
    items: structuredClone(collectionOf(target, spec.fieldKey)),
  }));
  for (let pickIndex = 0; pickIndex < selected.length; pickIndex += 1) {
    const picked = selected[pickIndex];
    const url = typeof picked?.url === 'string' ? picked.url.trim() : '';
    if (!url) return { ok: false, reason: 'invalid' };
    const slot = slots[pickIndex];
    const altByLang = {};
    applyAltFromPick({
      picked,
      activeLang,
      setAltForLang: (lang, alt) => {
        altByLang[lang] = alt;
      },
    });
    for (const { target, items } of nextByTarget) {
      while (items.length <= slot) {
        items.push(structuredClone(resolveItemDefaults(field, target.lang)));
      }
      const item = { ...items[slot], [spec.imageKey]: url };
      if (Object.hasOwn(altByLang, target.lang))
        item.alt = altByLang[target.lang];
      else if (picked.alts && Object.hasOwn(picked.alts, target.lang)) {
        item.alt = picked.alts[target.lang] || '';
      }
      if (
        spec.nameKey &&
        typeof picked.name === 'string' &&
        picked.name.trim()
      ) {
        item[spec.nameKey] = picked.name.trim();
      }
      items[slot] = item;
    }
  }
  for (const { target, items } of nextByTarget) {
    target.slide.content[spec.fieldKey] = items;
  }
  return { ok: true, count: selected.length };
}
