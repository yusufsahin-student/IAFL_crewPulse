import test from 'node:test';
import assert from 'node:assert/strict';
import { RISKS, BONE_RATES, MUSCLE_POINTS } from './gravity-risk-data.js';
import {
  riskScore, riskLevel, rankedRisks, phaseFor, gravityFactor, boneLoss, interpolate, muscleLoss,
  liveRiskStatus, liveAssessment, compositeScore, nextScreenings, riskById,
} from './gravity-risk.js';

test('risk scores and levels match the risk analysis table', () => {
  const scores = Object.fromEntries(RISKS.map((r) => [r.id, riskScore(r)]));
  assert.deepEqual(scores, { R1: 20, R2: 16, R3: 16, R4: 15, R5: 15, R6: 15, R7: 12, R8: 12, R9: 10, R10: 10, R11: 8, R12: 8 });
  assert.equal(riskLevel(20), 'high');
  assert.equal(riskLevel(12), 'medium');
  assert.equal(riskLevel(7), 'low');
  assert.equal(rankedRisks()[0].id, 'R1');
  assert.equal(rankedRisks().at(-1).id, 'R12');
});


test('mission day maps to the phases of the risk analysis', () => {
  assert.equal(phaseFor(0), 'P0');
  assert.equal(phaseFor(1), 'P1');
  assert.equal(phaseFor(7), 'P1');
  assert.equal(phaseFor(8), 'P2');
  assert.equal(phaseFor(60), 'P2');
  assert.equal(phaseFor(61), 'P3');
});

test('gravity factor: full loss at 0 g, wide band below 0.4 g', () => {
  assert.deepEqual(gravityFactor(0), { central: 1, low: 1, high: 1 });
  const moon = gravityFactor(0.166);
  assert.ok(Math.abs(moon.central - 0.834) < 1e-9);
  assert.equal(moon.high, 1);
  assert.ok(moon.low < moon.central);
  assert.deepEqual(gravityFactor(1), { central: 0, low: 0, high: 0 });
});

test('gravity factor range is continuous around 0.4 g', () => {
  const below = gravityFactor(0.399);
  const at = gravityFactor(0.4);
  const above = gravityFactor(0.401);
  assert.ok(Math.abs(below.high - at.high) < 0.01);
  assert.ok(Math.abs(above.high - at.high) < 0.01);
  assert.ok(Math.abs(below.low - above.low) < 0.01);
  for (let g = 0.01; g < 1; g += 0.01) {
    const f = gravityFactor(g);
    assert.ok(f.low <= f.central && f.central <= f.high, `order at ${g}`);
  }
});

test('environment rows map to app missions without overlaps', async () => {
  const { ENVIRONMENTS } = await import('./gravity-risk-data.js');
  const ids = ENVIRONMENTS.flatMap((e) => e.missions || []);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('iss') && ids.includes('mars'));
});

test('bone loss follows the monthly rates', () => {
  const hip = BONE_RATES.find((b) => b.id === 'hip');
  assert.ok(Math.abs(boneLoss(hip.pctPerMonth, 30.44) - 1.5) < 1e-9);
  assert.ok(Math.abs(boneLoss(hip.pctPerMonth, 30.44, 0.5) - 0.75) < 1e-9);
  assert.equal(boneLoss(1, -5), 0);
});

test('muscle loss interpolates the published points and levels off', () => {
  const back = MUSCLE_POINTS.find((m) => m.id === 'back').points;
  assert.equal(interpolate(back, 0), 0);
  assert.equal(interpolate(back, 7.5), 10);
  assert.equal(interpolate(back, 180), 20);
  assert.equal(interpolate(back, 400), 20);
  assert.equal(muscleLoss(back, 180, 0.5), 10);
});

test('live status: worst indicator, expected symptoms softened only in their phase', () => {
  const status = { indicators: [
    { indicator_id: 'back_pain', status: 'watch' },
    { indicator_id: 'heart_rate', status: 'normal' },
    { indicator_id: 'systolic_bp', status: 'alert' },
  ], bone: { status: 'normal', worst_loss_pct: 2 } };
  assert.equal(liveRiskStatus(riskById('R7'), status, 'P1').level, 'expected');
  assert.equal(liveRiskStatus(riskById('R7'), status, 'P3').level, 'watch');
  assert.equal(liveRiskStatus(riskById('R3'), status, 'P3').level, 'alert');
  assert.equal(liveRiskStatus(riskById('R4'), status, 'P3').level, 'missing');
  assert.equal(liveRiskStatus(riskById('R1'), status, 'P3').level, 'normal');
});

test('composite score weights alerts by risk score', () => {
  const status = { indicators: [{ indicator_id: 'systolic_bp', status: 'alert' }, { indicator_id: 'back_pain', status: 'watch' }] };
  const score = compositeScore(liveAssessment(status, 'P3'));
  assert.ok(Math.abs(score.value - (3 * 16 / 25 + 12 / 25)) < 1e-9);
  assert.ok(score.max > score.value);
});

test('next screenings come from the calendar', () => {
  const next = nextScreenings(45);
  const neck = next.find((s) => s.risk === 'R4');
  assert.equal(neck.due, 50);
  assert.equal(neck.inDays, 5);
  assert.equal(nextScreenings(200).find((s) => s.risk === 'R4').due, null);
  assert.equal(nextScreenings(61).find((s) => s.risk === 'R2').due, 90);
});

