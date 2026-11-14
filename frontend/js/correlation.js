// Pure correlation maths for the Trends page (no DOM, importable from Node).
export const MIN_PAIRS = 10;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Minimum paired check-ins: config.params['trends.min_pairs'] if set, else 10.
export function minPairs(config) {
  const v = config && config.params ? config.params['trends.min_pairs'] : undefined;
  return isNum(v) && v >= 2 ? v : MIN_PAIRS;
}

// Pearson r over pairs where both values are numbers. r is null when n < min or either side has no spread.
export function pearson(xs, ys, min = MIN_PAIRS) {
  const px = [];
  const py = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (isNum(xs[i]) && isNum(ys[i])) { px.push(xs[i]); py.push(ys[i]); }
  }
  const n = px.length;
  if (n < min || n < 2) return { r: null, n };
  const mx = px.reduce((a, b) => a + b, 0) / n;
  const my = py.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (px[i] - mx) * (py[i] - my);
    sxx += (px[i] - mx) ** 2;
    syy += (py[i] - my) ** 2;
  }
  if (sxx < 1e-12 || syy < 1e-12) return { r: null, n };
  return { r: Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), n };
}

// Square matrix aligned with indicatorIds: m[i][j] = {r, n}; the diagonal is null.
export function matrix(points, indicatorIds, min = MIN_PAIRS) {
  const cols = indicatorIds.map((id) => points.map((p) => (p.values ? p.values[id] : null)));
  return indicatorIds.map((_, i) => indicatorIds.map((__, j) => (i === j ? null : pearson(cols[i], cols[j], min))));
}
