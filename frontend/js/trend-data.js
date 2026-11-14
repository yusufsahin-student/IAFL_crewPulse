// Pure response-shape helpers for Trends. Kept outside the DOM module so every
// backend and mock fallback can be regression-tested.

export function selectSolarEvents(radiation, fallback) {
  const primary = Array.isArray(radiation?.events) ? radiation.events : [];
  if (primary.length) return primary;
  if (Array.isArray(fallback)) return fallback;
  return Array.isArray(fallback?.events) ? fallback.events : [];
}

export function responsiveChartHeight(width, compact = false) {
  const min = compact ? 210 : 280;
  const max = compact ? 250 : 380;
  const ratio = compact ? 0.28 : 0.34;
  return Math.round(Math.min(max, Math.max(min, width * ratio)));
}

export function fitTicks(ticks, width, minimumGap = 78) {
  if (!Array.isArray(ticks) || ticks.length <= 2) return ticks || [];
  const maxLabels = Math.max(2, Math.floor(width / minimumGap));
  if (ticks.length <= maxLabels) return ticks;
  const last = ticks.length - 1;
  const indexes = new Set([0, last]);
  for (let slot = 1; slot < maxLabels - 1; slot += 1) {
    indexes.add(Math.round((slot * last) / (maxLabels - 1)));
  }
  return [...indexes].sort((a, b) => a - b).map((index) => ticks[index]);
}
