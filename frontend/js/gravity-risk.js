// Pure calculations for the gravity risk analysis (no DOM). Formulas follow the team's risk analysis:
// score = probability x impact; crew risk score = sum(alert points x score / 25); bone and muscle curves
// use the published rates in gravity-risk-data.js. Projections are decision support, not diagnoses.
import { RISKS, PHASES, SCREENINGS } from './gravity-risk-data.js';

export const DAYS_PER_MONTH = 30.44;
// Below about 0.4 g, indirect evidence suggests bone and muscle are not protected (NASA, partial gravity).
export const PROTECTIVE_G = 0.4;
const RANK = { missing: 0, normal: 1, expected: 1, watch: 2, alert: 3 };
const ALERT_POINTS = { normal: 0, expected: 0, missing: 0, watch: 1, alert: 3 };

export const riskScore = (risk) => risk.p * risk.i;

export function riskLevel(score) {
  if (score >= 15) return 'high';
  if (score >= 8) return 'medium';
  return 'low';
}


export const riskById = (id) => RISKS.find((r) => r.id === id) || null;

// Risks sorted by score (highest first), ties by code number.
export function rankedRisks(risks = RISKS) {
  return [...risks].sort((a, b) => riskScore(b) - riskScore(a) || Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

// In-flight mission day -> phase id. Day 0 or less is preflight.
export function phaseFor(day) {
  const d = Number(day);
  if (!Number.isFinite(d) || d <= 0) return 'P0';
  if (d <= 7) return 'P1';
  if (d <= 60) return 'P2';
  return 'P3';
}

export const phaseById = (id) => PHASES.find((p) => p.id === id) || null;

// Share of the microgravity loss rate that applies at local gravity g.
// central: linear unloading, 1 - g. low/high: a model assumption range (not a statistical confidence
// interval), from "fully protective from 0.4 g" (low) to "no protection up to 0.4 g, then linear to
// Earth gravity" (high). Both bounds are continuous, so there is no jump at 0.4 g. No range at 0 g or 1 g.
export function gravityFactor(g) {
  const x = Math.min(1, Math.max(0, Number(g) || 0));
  if (x <= 0) return { central: 1, low: 1, high: 1 };
  if (x >= 1) return { central: 0, low: 0, high: 0 };
  const central = 1 - x;
  const low = Math.max(0, 1 - x / PROTECTIVE_G);
  const high = x <= PROTECTIVE_G ? 1 : (1 - x) / (1 - PROTECTIVE_G);
  return { central, low: Math.min(low, central), high: Math.max(high, central) };
}

// Cumulative bone mineral loss in % after `day` days at the given monthly rate and gravity factor.
export function boneLoss(pctPerMonth, day, factor = 1) {
  const d = Math.max(0, Number(day) || 0);
  return (pctPerMonth * d / DAYS_PER_MONTH) * factor;
}

// Linear interpolation through published [day, %] points; held flat after the last point.
export function interpolate(points, day) {
  const d = Math.max(0, Number(day) || 0);
  if (!points.length) return 0;
  if (d >= points.at(-1)[0]) return points.at(-1)[1];
  for (let k = 1; k < points.length; k += 1) {
    const [x0, y0] = points[k - 1];
    const [x1, y1] = points[k];
    if (d <= x1) return y0 + ((d - x0) / Math.max(1e-9, x1 - x0)) * (y1 - y0);
  }
  return points.at(-1)[1];
}

export function muscleLoss(points, day, factor = 1) {
  return interpolate(points, day) * factor;
}

// 'good' and 'advisory' carry no alarm, so they count as normal here.
const normalStatus = (s) => (s === 'good' || s === 'advisory' ? 'normal' : s);

export function worstStatus(list) {
  return list.reduce((worst, s) => ((RANK[s] ?? 0) > (RANK[worst] ?? 0) ? s : worst), 'missing');
}

// Live signal for one risk from today's status: the worst status of its check-in indicators
// (plus the bone projection for R1). A caution during a phase where the symptom is expected becomes
// 'expected' (information note, no alarm), as the risk analysis asks. Warnings are never softened.
export function liveRiskStatus(risk, status, phaseId) {
  const rows = (status && status.indicators) || [];
  const found = [];
  for (const id of risk.indicators || []) {
    const row = rows.find((r) => r.indicator_id === id);
    if (row && row.status && row.status !== 'missing') found.push({ id, name: row.name || id, status: normalStatus(row.status), value: row.value, unit: row.unit, decimals: row.decimals });
  }
  if (risk.useBone && status && status.bone && status.bone.status && status.bone.status !== 'missing') {
    found.push({ id: 'bone', name: 'Bone projection', status: normalStatus(status.bone.status), value: status.bone.worst_loss_pct, unit: '%', decimals: 1 });
  }
  let level = found.length ? worstStatus(found.map((f) => f.status)) : 'missing';
  if (level === 'watch' && (risk.expectedIn || []).includes(phaseId)) level = 'expected';
  return { level, signals: found };
}

export function liveAssessment(status, phaseId, risks = RISKS) {
  return risks.map((risk) => ({ risk, score: riskScore(risk), ...liveRiskStatus(risk, status, phaseId) }));
}

// Crew risk score = sum(alert points x risk score / 25); green 0, yellow 1, red 3 (risk analysis 7.2).
export function compositeScore(assessment) {
  let value = 0;
  let max = 0;
  for (const a of assessment) {
    value += (ALERT_POINTS[a.level] ?? 0) * a.score / 25;
    max += 3 * a.score / 25;
  }
  return { value, max, pct: max > 0 ? (value / max) * 100 : 0 };
}

// Upcoming planned screenings from the given mission day (inclusive).
export function nextScreenings(day, screenings = SCREENINGS) {
  const d = Math.max(0, Math.floor(Number(day) || 0));
  return screenings.map((s) => {
    let due = null;
    if (s.days) due = s.days.find((x) => x >= d) ?? null;
    else if (s.every) due = Math.max(s.every, Math.ceil(d / s.every) * s.every);
    return { ...s, due, inDays: due === null ? null : due - d };
  }).sort((a, b) => (a.inDays ?? Infinity) - (b.inDays ?? Infinity));
}

