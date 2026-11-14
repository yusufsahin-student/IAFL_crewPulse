export function gravityPoints(readings = []) {
  return readings
    .filter((row) => row.gravity_g != null && row.gravity_g !== '')
    .map((row) => ({ at: row.observed_at, g: Number(row.gravity_g) }))
    .filter((point) => point.at && Number.isFinite(Date.parse(point.at)) && Number.isFinite(point.g) && point.g >= 0)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

export function transitionPoints(points = [], threshold = 0.05) {
  return points.slice(1).flatMap((point, index) => {
    const previous = points[index];
    return Math.abs(point.g - previous.g) >= threshold
      ? [{ at: point.at, from: previous.g, to: point.g }]
      : [];
  });
}

export function seriesDomain(values = [], fallback = [0, 1]) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return fallback;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (max - min < 0.02) { min -= 0.05; max += 0.05; }
  const pad = Math.max(0.02, (max - min) * 0.12);
  return [Math.max(0, min - pad), max + pad];
}
