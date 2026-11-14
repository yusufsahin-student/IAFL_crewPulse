import test from 'node:test';
import assert from 'node:assert/strict';
import { layerSummary, normalizeContextLayer } from './context-data.js';

const layer = {
  schema_version: 1,
  id: 'environment',
  label: 'Cabin environment',
  freshness: { status: 'current' },
  metrics: [{ id: 'co2_ppm', label: 'Carbon dioxide', unit: 'ppm', samples: [
    { observed_at: '2026-11-14T08:00:00Z', value: 820 },
    { observed_at: '2026-11-13T08:00:00Z', value: 800 },
  ] }],
};

test('normalizes context without interpreting risk', () => {
  const result = normalizeContextLayer(layer);
  assert.equal(result.id, 'environment');
  assert.equal(result.metrics[0].samples.length, 2);
  assert.equal(result.metrics[0].samples[0].value, 800);
  assert.equal('status' in result.metrics[0].samples[0], false);
});

test('summarizes latest value and observed-day coverage', () => {
  const result = layerSummary(layer, 4);
  assert.equal(result.metrics[0].latest.value, 820);
  assert.equal(result.observedDays, 2);
  assert.equal(result.coveragePct, 50);
});

test('rejects incomplete layers', () => {
  assert.equal(normalizeContextLayer(null), null);
  assert.equal(normalizeContextLayer({ id: 'gravity', metrics: [] }), null);
});
