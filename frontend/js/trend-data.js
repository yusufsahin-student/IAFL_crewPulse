// Pure response-shape helpers for Trends. Kept outside the DOM module so every
// backend and mock fallback can be regression-tested.

export function selectSolarEvents(radiation, fallback) {
  const primary = Array.isArray(radiation?.events) ? radiation.events : [];
  if (primary.length) return primary;
  if (Array.isArray(fallback)) return fallback;
  return Array.isArray(fallback?.events) ? fallback.events : [];
}

// Aggregate markers by mission day; the original event objects remain available in each group.
export function groupSolarEvents(events = []) {
  const groups = new Map();
  for (const event of events) {
    if (!Number.isFinite(event.startDay)) continue;
    const group = groups.get(event.startDay) || { day: event.startDay, events: [], dose_relevant: false };
    group.events.push(event);
    group.dose_relevant ||= Boolean(event.dose_relevant);
    groups.set(event.startDay, group);
  }
  return [...groups.values()].sort((a, b) => a.day - b.day);
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
