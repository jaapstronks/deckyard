let FEATURES = null;

export function setFeatures(next) {
  FEATURES = next && typeof next === 'object' ? next : null;
}

export function getFeatures() {
  return FEATURES && typeof FEATURES === 'object' ? FEATURES : null;
}
