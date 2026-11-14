// Pure response-shape helpers for Trends. Kept outside the DOM module so every
// backend and mock fallback can be regression-tested.

export function selectSolarEvents(radiation, fallback) {
  const primary = Array.isArray(radiation?.events) ? radiation.events : [];
  if (primary.length) return primary;
  if (Array.isArray(fallback)) return fallback;
  return Array.isArray(fallback?.events) ? fallback.events : [];
}
