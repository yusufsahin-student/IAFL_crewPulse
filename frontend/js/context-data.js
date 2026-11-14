// Stable boundary for contextual sources shown in Trends. Future sources,
// including gravity data, can use this shape without changing health scoring.
export function normalizeContextLayer(input) {
  if (!input || typeof input !== 'object') return null;
  const metrics = Array.isArray(input.metrics) ? input.metrics.map((metric) => ({
    id: String(metric.id || ''),
    label: String(metric.label || metric.id || 'Metric'),
    unit: String(metric.unit || ''),
    samples: Array.isArray(metric.samples)
      ? metric.samples.filter((sample) => Number.isFinite(sample && sample.value))
        .toSorted((a, b) => String(a.observed_at || '').localeCompare(String(b.observed_at || '')))
      : [],
  })).filter((metric) => metric.id) : [];
  if (!input.id || !metrics.length) return null;
  return {
    schemaVersion: Number(input.schema_version) || 1,
    id: String(input.id),
    label: String(input.label || input.id),
    freshness: input.freshness || { status: 'missing' },
    metrics,
  };
}

export function layerSummary(layer, windowDays = 60) {
  const normalized = normalizeContextLayer(layer);
  if (!normalized) return null;
  const metrics = normalized.metrics.map((metric) => ({
    ...metric,
    latest: metric.samples.length ? metric.samples[metric.samples.length - 1] : null,
  }));
  const observedDays = new Set(normalized.metrics.flatMap((metric) => metric.samples
    .map((sample) => String(sample.observed_at || '').slice(0, 10))
    .filter(Boolean)));
  return {
    ...normalized,
    metrics,
    observedDays: observedDays.size,
    coveragePct: Math.min(100, Math.round((observedDays.size / Math.max(1, windowDays)) * 100)),
  };
}
