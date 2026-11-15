// Gravity risk analysis sections for the Gravital Tracking page: mission phase and screening calendar,
// gravity-risk status from the latest check-in, the 5x5 risk matrix with a detail panel, bone and muscle
// projections, environment comparison and evidence charts.
// Personal parts (mission day, phase, screenings, check-in status, the "today" marker) always belong to
// the astronaut's own mission. When another gravity profile is selected, the curves are a scenario only.
// Data: gravity-risk-data.js (team research documents). Maths: gravity-risk.js.
import { el, formatValue, statusBadge, masterAlert } from './shell.js';
import {
  RISKS, PHASES, BONE_RATES, MUSCLE_POINTS, INCIDENCE, RECOVERY, ENVIRONMENTS, SOURCES,
  PROBABILITY_SCALE, IMPACT_SCALE, LEVELS,
} from './gravity-risk-data.js';
import {
  riskScore, riskLevel, riskById, rankedRisks, phaseFor, phaseById, gravityFactor, boneLoss,
  muscleLoss, liveAssessment, compositeScore, nextScreenings,
} from './gravity-risk.js';

const NS = 'http://www.w3.org/2000/svg';
const LIVE_LABEL = { alert: 'Warning', watch: 'Caution', expected: 'Expected in this phase', normal: 'Normal', missing: 'Not in the daily check-in' };
const LIVE_BADGE = { alert: 'alert', watch: 'watch', expected: 'advisory', normal: 'normal', missing: 'missing' };
const LEVEL_BADGE = { high: 'alert', medium: 'watch', low: 'normal' };
const t = (s) => s; // data texts are English; the i18n layer translates the rendered DOM
const fmt = (v, d = 1) => formatValue(v, d);

// day/phaseId are null when the astronaut's status is unknown; nothing personal is computed then.
const state = {
  riskId: 'R1', assessment: [], phaseId: null, day: null,
  hasStatus: false, hasCheckin: false, fresh: false, ageHours: null,
  ownMission: false, ownMissionName: '', astronautName: '',
};
const slots = new Set();
const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const slot = entry.target;
    const w = Math.round(slot.clientWidth);
    if (w > 0 && w !== slot._w) { slot._w = w; slot.replaceChildren(slot._draw(w)); }
  }
});

function chartSlot(draw, cls = 'gr-chart-slot') {
  const slot = el('div', { class: cls });
  slot._draw = draw;
  observer.observe(slot);
  slots.add(slot);
  return slot;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function niceTop(max) {
  const raw = Math.max(1e-6, max);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const steps = [1, 2, 2.5, 3, 4, 5, 6, 8, 10];
  return steps.find((s) => n <= s) * mag;
}

function levelBadge(level) {
  return statusBadge(LEVEL_BADGE[level] || 'missing', t(LEVELS[level]));
}

function liveBadge(level) {
  return statusBadge(LIVE_BADGE[level] || 'missing', LIVE_LABEL[level] || level);
}

function riskButton(risk, extra = null, showScore = true) {
  const score = riskScore(risk);
  return el('button', { type: 'button', class: 'gr-risk-link', 'data-level': riskLevel(score), onclick: () => selectRisk(risk.id, true) },
    el('span', { class: 'gr-code' }, risk.id), el('span', {}, t(risk.name)), showScore ? el('span', { class: 'gr-score' }, String(score)) : null, extra);
}

// ---------- Phase and screening calendar ----------

// Whose data a personal section shows, and a warning when the selected profile is another mission.
function ownerNote() {
  return el('div', { class: 'gr-owner' },
    el('p', { class: 'muted' }, el('strong', {}, state.astronautName), ' · ', state.ownMissionName),
    state.ownMission ? null : el('p', { class: 'notice', 'data-status': 'advisory' },
      'The selected gravity profile is a different mission. This section shows the astronaut’s own mission, not the selected profile.'));
}

function phaseSection() {
  const head = [
    el('div', { class: 'eyebrow' }, 'MISSION PHASE'),
    el('h2', { id: 'gr-phase-title' }, 'Phase-aware gravity risk'),
    el('p', { class: 'muted' }, 'The same symptom means different things on different mission days: a headache in the first week is expected adaptation, a new headache on day 90 needs a check. Expectations follow the phase.'),
  ];
  if (state.phaseId === null) {
    return el('section', { class: 'panel', 'aria-labelledby': 'gr-phase-title' }, ...head,
      el('p', { class: 'state' }, 'The astronaut’s data could not be loaded, so the mission day is unknown. Phase and screening calendar are not shown.'));
  }
  const current = phaseById(state.phaseId);
  const track = el('ol', { class: 'gr-phase-track', 'aria-label': 'Mission phases' }, PHASES.map((p) => el('li', {
    class: 'gr-phase', 'aria-current': p.id === state.phaseId ? 'step' : null,
  }, el('strong', {}, p.id), el('span', {}, t(p.name)))));
  const screenings = nextScreenings(state.day).filter((s) => s.due !== null);
  return el('section', { class: 'panel', 'aria-labelledby': 'gr-phase-title' },
    ...head,
    ownerNote(),
    track,
    el('div', { class: 'gr-phase-grid' },
      el('div', { class: 'gr-card' },
        el('span', { class: 'metric__label' }, 'Current phase'),
        el('strong', { class: 'gr-big' }, t(current.name)),
        el('small', { class: 'muted' }, `Mission day ${state.day}`)),
      el('div', { class: 'gr-card' },
        el('span', { class: 'metric__label' }, 'Expected (information note, no alarm)'),
        el('p', {}, t(current.expected))),
      el('div', { class: 'gr-card' },
        el('span', { class: 'metric__label' }, 'Risks in focus'),
        current.focus.length ? el('div', { class: 'gr-chip-row' }, current.focus.map((id) => riskButton(riskById(id)))) : el('p', {}, '—')),
      el('div', { class: 'gr-card' },
        el('span', { class: 'metric__label' }, 'Planned scans in this phase'),
        el('p', {}, t(current.scans)))),
    el('h3', {}, 'Upcoming screening calendar'),
    screenings.length
      ? el('ul', { class: 'gr-screen-list' }, screenings.map((s) => el('li', {},
        el('span', { class: 'gr-code' }, s.risk),
        el('span', { class: 'gr-screen-name' }, t(s.name)),
        el('span', { class: 'gr-screen-due' }, `Day ${s.due}`),
        el('span', { class: 'gr-screen-in', 'data-soon': s.inDays <= 7 ? 'true' : null },
          s.inDays === 0 ? 'Due today' : `In ${s.inDays} ${s.inDays === 1 ? 'day' : 'days'}`))))
      : el('p', { class: 'state' }, 'No planned screening left in the calendar.'),
    el('p', { class: 'muted gr-note' }, 'Screening days are prototype proposals from the risk analysis (for example neck ultrasound on days 30, 50, 90 and 150), not a clinical schedule.'));
}

// ---------- Live risk status ----------

function signalText(a) {
  if (a.signals.length) {
    return el('span', { class: 'gr-signals' }, a.signals.map((s, k) => el('span', {},
      k ? ' · ' : '', s.name, ' ', s.value == null ? '' : `${fmt(s.value, s.decimals ?? 0)}${s.unit ? ` ${s.unit}` : ''}`)));
  }
  const first = a.risk.monitor[0];
  return el('span', { class: 'gr-signals muted' }, 'Needs', ': ', t(first[0]), ' (', t(first[1]), ')');
}

function freshnessNote() {
  const age = state.ageHours;
  const ago = age == null ? null : `${fmt(age, 0)} h ago`;
  if (state.fresh) return el('p', { class: 'muted' }, 'Latest check-in is current.', ago ? el('span', {}, ' ', ago) : null);
  return el('p', { class: 'notice', 'data-status': 'watch' },
    el('strong', {}, 'Out-of-date check-in'), ago ? el('span', {}, ' · ', ago) : null, ' · ',
    'The statuses below describe that older reading, not today. Take a new check-in.');
}

function liveSection() {
  const head = [
    el('div', { class: 'eyebrow' }, 'LATEST CHECK-IN'),
    el('h2', { id: 'gr-live-title' }, 'Gravity risk status from the latest check-in'),
  ];
  if (!state.hasStatus || !state.hasCheckin) {
    return el('section', { class: 'panel', 'aria-labelledby': 'gr-live-title' }, ...head,
      el('p', { class: 'state' }, state.hasStatus
        ? 'There is no check-in yet, so no gravity risk status or score is calculated.'
        : 'The astronaut’s health data could not be loaded, so no gravity risk status or score is calculated.'));
  }
  const order = { alert: 0, watch: 1, expected: 2, normal: 3, missing: 4 };
  const rows = [...state.assessment].sort((a, b) => order[a.level] - order[b.level] || b.score - a.score);
  const measured = rows.some((r) => r.level !== 'missing');
  const composite = compositeScore(state.assessment);
  const reds = rows.filter((r) => r.level === 'alert');
  const counts = ['alert', 'watch', 'expected', 'normal', 'missing'].map((lv) => [lv, rows.filter((r) => r.level === lv).length]);
  return el('section', { class: 'panel', 'aria-labelledby': 'gr-live-title' },
    ...head,
    ownerNote(),
    freshnessNote(),
    reds.length && state.fresh ? masterAlert('alert', 'Gravity-related warning', `${reds.map((r) => r.risk.id).join(', ')}`) : null,
    el('p', { class: 'muted' }, 'Each risk takes the worst status of the check-in readings that signal it. Readings are indirect: bone density, retina thickness, neck vein flow and hemoglobin need scans or blood tests that the daily check-in does not collect.'),
    el('div', { class: 'gr-live-top' },
      el('div', { class: 'gr-card gr-composite' },
        el('span', { class: 'metric__label' }, 'Crew gravity risk score'),
        measured
          ? el('strong', { class: 'gr-big' }, fmt(composite.value, 2), el('span', { class: 'metric__unit' }, '/ ', fmt(composite.max, 1)))
          : el('strong', { class: 'gr-big' }, '—'),
        measured
          ? el('div', { class: 'gr-meter', role: 'img', 'aria-label': `${fmt(composite.pct, 0)} %` }, el('span', { style: `width:${Math.min(100, composite.pct).toFixed(1)}%` }))
          : el('p', { class: 'muted' }, 'No reading in the latest check-in signals these risks, so no score is calculated.'),
        el('small', { class: 'muted' }, 'Sum of alert points × risk score / 25 (green 0, yellow 1, red 3). Red alerts are always listed first.')),
      el('div', { class: 'gr-card' },
        el('span', { class: 'metric__label' }, 'Risks by status'),
        el('ul', { class: 'gr-count-list' }, counts.map(([lv, n]) => el('li', {}, liveBadge(lv), el('strong', {}, String(n))))))),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table gr-live-table' },
      el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Risk'), el('th', { scope: 'col' }, 'Score'), el('th', { scope: 'col' }, 'Latest check-in'), el('th', { scope: 'col' }, 'Signal'))),
      el('tbody', {}, rows.map((a) => el('tr', { 'data-level': a.level },
        el('td', {}, riskButton(a.risk, null, false)),
        el('td', {}, String(a.score)),
        el('td', {}, liveBadge(a.level)),
        el('td', {}, signalText(a))))))));
}

// ---------- Risk matrix and detail ----------

function matrixChart(width) {
  const w = Math.max(200, width);
  const compact = w < 460; // narrow screens: probability as a number only, so the grid keeps its size
  const L = compact ? 34 : 132; const T = 14; const R = 8; const B = 64;
  const cell = Math.min(96, (w - L - R) / 5);
  const ph = cell * 5;
  const chipW = Math.min(44, cell - 6);
  const H = T + ph + B;
  const root = svg('svg', { viewBox: `0 0 ${w} ${H}`, class: 'gr-chart', role: 'group', 'aria-label': 'Probability and impact matrix of the 12 risks' });
  for (let p = 5; p >= 1; p -= 1) {
    for (let i = 1; i <= 5; i += 1) {
      const x = L + (i - 1) * cell;
      const y = T + (5 - p) * cell;
      root.append(svg('rect', { x, y, width: cell, height: cell, class: 'gr-cell', 'data-level': riskLevel(p * i) }),
        svg('text', { x: x + cell - 5, y: y + cell - 6, 'text-anchor': 'end', class: 'gr-cell-score' }, String(p * i)));
      const here = RISKS.filter((r) => r.p === p && r.i === i);
      here.forEach((r, k) => {
        const cx = x + cell / 2;
        const cy = y + cell / 2 + (here.length > 1 ? (k - (here.length - 1) / 2) * 26 : 4);
        const chip = svg('g', { class: 'gr-chip', role: 'button', tabindex: 0, 'aria-pressed': String(r.id === state.riskId), 'data-risk': r.id,
          'aria-label': `${r.id} ${t(r.name)}, ${riskScore(r)}` },
        svg('rect', { x: cx - chipW / 2, y: cy - 11, width: chipW, height: 22, rx: 11 }),
        svg('text', { x: cx, y: cy + 5, 'text-anchor': 'middle' }, r.id));
        chip.addEventListener('click', () => selectRisk(r.id));
        chip.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRisk(r.id); } });
        root.append(chip);
      });
    }
    root.append(svg('text', { x: L - 8, y: T + (5 - p) * cell + cell / 2 + 4, 'text-anchor': 'end', class: 'gr-axis' }, compact ? String(p) : `${p} · ${t(PROBABILITY_SCALE.find((s) => s.score === p).name)}`));
  }
  for (let i = 1; i <= 5; i += 1) {
    root.append(svg('text', { x: L + (i - 0.5) * cell, y: T + ph + 18, 'text-anchor': 'middle', class: 'gr-axis' }, String(i)));
  }
  root.append(svg('text', { x: L + 2.5 * cell, y: T + ph + 40, 'text-anchor': 'middle', class: 'gr-axis gr-axis-title' }, 'Impact →'),
    svg('text', { x: 4, y: T + ph + 40, class: 'gr-axis gr-axis-title' }, 'Probability ↑'));
  return root;
}

function rankedBars() {
  return el('div', { class: 'gr-rank' }, rankedRisks().map((r) => {
    const score = riskScore(r);
    return el('button', { type: 'button', class: 'gr-rank-row', 'data-risk-row': r.id, 'aria-pressed': String(r.id === state.riskId), onclick: () => selectRisk(r.id) },
      el('span', { class: 'gr-rank-name' }, el('span', { class: 'gr-code' }, r.id), t(r.name)),
      el('span', { class: 'gr-track' }, el('span', { class: 'gr-fill', 'data-level': riskLevel(score), style: `width:${(score / 25 * 100).toFixed(1)}%` })),
      el('span', { class: 'gr-rank-val' }, String(score)));
  }));
}

function riskDetail() {
  const r = riskById(state.riskId) || RISKS[0];
  const score = riskScore(r);
  const level = riskLevel(score);
  const live = state.assessment.find((a) => a.risk.id === r.id);
  const pName = t(PROBABILITY_SCALE.find((s) => s.score === r.p).name);
  const iName = t(IMPACT_SCALE.find((s) => s.score === r.i).name);
  return el('article', { class: 'gr-detail' },
    el('div', { class: 'ind__head' }, el('h3', {}, `${r.id} – `, t(r.name)), el('span', { class: 'gr-badges' }, levelBadge(level), live ? liveBadge(live.level) : null)),
    el('p', { class: 'gr-formula' },
      el('span', {}, 'Probability', ' ', String(r.p), ' (', pName, ')'), ' × ',
      el('span', {}, 'Impact', ' ', String(r.i), ' (', iName, ')'), ' = ', el('strong', {}, String(score))),
    el('p', { class: 'muted' }, el('strong', {}, 'Time window'), ': ', t(r.window)),
    el('h4', {}, 'Effect on the body'), el('p', {}, t(r.effect)),
    el('h4', {}, 'Evidence'), el('ul', { class: 'gr-evidence' }, r.evidence.map((e) => el('li', {}, t(e)))),
    el('h4', {}, 'Alert logic'),
    el('ul', { class: 'gr-alert-logic' },
      el('li', { 'data-tone': 'green' }, el('strong', {}, 'Green'), ' ', t(r.green)),
      el('li', { 'data-tone': 'yellow' }, el('strong', {}, 'Yellow'), ' ', t(r.yellow)),
      el('li', { 'data-tone': 'red' }, el('strong', {}, 'Red'), ' ', t(r.red))),
    el('p', { class: 'notice', 'data-status': 'advisory' }, el('strong', {}, 'Recommended action'), ': ', t(r.action)),
    el('details', { class: 'more' }, el('summary', {}, 'Parameters to monitor'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Parameter'), el('th', { scope: 'col' }, 'Data source'), el('th', { scope: 'col' }, 'Frequency'))),
        el('tbody', {}, r.monitor.map((m) => el('tr', {}, m.map((c) => el('td', {}, t(c))))))))),
    live && live.signals.length
      ? el('p', { class: 'muted' }, el('strong', {}, 'Signals in the latest check-in'), ': ', signalText(live))
      : el('p', { class: 'muted' }, 'The latest check-in has no direct reading for this risk.'));
}

function selectRisk(id, scroll = false) {
  state.riskId = id;
  document.querySelectorAll('.gr-chip[data-risk]').forEach((g) => g.setAttribute('aria-pressed', String(g.dataset.risk === id)));
  document.querySelectorAll('[data-risk-row]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.riskRow === id)));
  const box = document.getElementById('gr-risk-detail');
  if (box) {
    box.replaceChildren(riskDetail());
    if (scroll) box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function matrixSection() {
  return el('section', { class: 'panel', 'aria-labelledby': 'gr-matrix-title' },
    el('div', { class: 'eyebrow' }, 'RISK ANALYSIS'),
    el('h2', { id: 'gr-matrix-title' }, 'Microgravity risk matrix'),
    el('p', { class: 'muted' }, 'Score = probability × impact on a 5 × 5 scale: 15–25 high, 8–14 medium, 1–7 low. Probability comes from how often the effect is reported in astronauts. Scores are the team’s assessment in the NASA risk-board style, not NASA’s official scores.'),
    el('div', { class: 'gr-matrix-grid' },
      el('div', {}, el('h3', {}, 'Probability × impact'), chartSlot((w) => matrixChart(w))),
      el('div', {}, el('h3', {}, 'Risks ranked by score'), rankedBars())),
    el('div', { id: 'gr-risk-detail', 'aria-live': 'polite' }, riskDetail()));
}

// ---------- Projections ----------

function lineChart(width, { maxDay, series, band, markerDay, refPoint, yTitle, ariaLabel }) {
  const H = 260; const L = 46; const R = 14; const T = 26; const B = 40;
  const pw = Math.max(120, width - L - R); const ph = H - T - B;
  const peak = Math.max(0.1, ...series.flatMap((s) => [s.at(maxDay)]), band ? band.hi(maxDay) : 0, refPoint ? refPoint[1] : 0);
  const top = niceTop(peak * 1.08 / 4) * 4;
  const x = (d) => L + (d / maxDay) * pw;
  const y = (v) => T + ph - (v / top) * ph;
  const root = svg('svg', { viewBox: `0 0 ${width} ${H}`, class: 'gr-chart', role: 'img', 'aria-label': ariaLabel });
  root.append(svg('text', { x: L, y: 14, class: 'gr-axis gr-axis-title' }, yTitle));
  for (let k = 0; k <= 4; k += 1) {
    const v = (top * k) / 4;
    root.append(svg('line', { x1: L, x2: L + pw, y1: y(v), y2: y(v), class: 'gr-grid' }),
      svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', class: 'gr-axis' }, fmt(v, top < 5 ? 1 : 0)));
  }
  const step = maxDay > 600 ? 180 : maxDay > 300 ? 60 : 30;
  for (let d = 0; d <= maxDay; d += step) {
    root.append(svg('text', { x: x(d), y: T + ph + 18, 'text-anchor': 'middle', class: 'gr-axis' }, String(d)));
  }
  root.append(svg('text', { x: L + pw, y: T + ph + 34, 'text-anchor': 'end', class: 'gr-axis' }, 'Mission day'));
  const N = 60;
  const pts = (f) => Array.from({ length: N + 1 }, (_, k) => (maxDay * k) / N).map((d) => [x(d), y(f(d))]);
  if (band) {
    const upper = pts(band.hi);
    const lower = pts(band.lo).reverse();
    root.append(svg('path', { class: 'gr-band', d: `M${[...upper, ...lower].map((p) => p.map((n) => n.toFixed(1)).join(' ')).join('L')}Z` }));
  }
  series.forEach((s, k) => {
    root.append(svg('path', { class: `gr-line gr-line--${k}`, d: `M${pts(s.at).map((p) => p.map((n) => n.toFixed(1)).join(' ')).join('L')}` }));
  });
  if (refPoint && refPoint[0] <= maxDay) {
    root.append(svg('circle', { cx: x(refPoint[0]), cy: y(refPoint[1]), r: 5, class: 'gr-ref' }),
      svg('text', { x: x(refPoint[0]) + 8, y: y(refPoint[1]) - 8, class: 'gr-axis' }, refPoint[2]));
  }
  if (markerDay > 0 && markerDay <= maxDay) {
    const mx = x(markerDay);
    root.append(svg('line', { x1: mx, x2: mx, y1: T, y2: T + ph, class: 'gr-marker' }),
      svg('text', { x: mx + (mx > L + pw * 0.75 ? -6 : 6), y: T + 12, 'text-anchor': mx > L + pw * 0.75 ? 'end' : 'start', class: 'gr-axis gr-marker-label' }, 'Today'));
    series.forEach((s, k) => root.append(svg('circle', { cx: mx, cy: y(s.at(markerDay)), r: 4, class: `gr-dot gr-dot--${k}` })));
  }
  root.append(svg('line', { x1: L, x2: L, y1: T, y2: T + ph, class: 'gr-axis-line' }), svg('line', { x1: L, x2: L + pw, y1: T + ph, y2: T + ph, class: 'gr-axis-line' }));
  return root;
}

function legend(items) {
  return el('ul', { class: 'gr-legend gr-legend--lines' }, items.map((name, k) => el('li', {}, el('span', { class: `gr-swatch gr-swatch--${k}`, 'aria-hidden': 'true' }), name)));
}

function projectionSection(g, missionName) {
  const f = gravityFactor(g);
  const partial = g > 0 && g < 1;
  // The "today" marker is the astronaut's own mission day; on another profile the curves are a scenario.
  const marker = state.ownMission && state.day > 0 ? state.day : null;
  const refDay = marker ?? 180;
  const refLabel = marker ? `today (day ${marker})` : 'at day 180 (scenario)';
  const boneMax = Math.max(360, Math.ceil(((marker || 0) + 90) / 30) * 30);
  const muscleMax = Math.max(240, Math.ceil(((marker || 0) + 30) / 30) * 30);
  const bone = BONE_RATES.map((b) => ({ name: t(b.name), at: (d) => boneLoss(b.pctPerMonth, d, f.central) }));
  const hip = BONE_RATES[0];
  const muscle = MUSCLE_POINTS.map((m) => ({ name: t(m.name), at: (d) => muscleLoss(m.points, d, f.central) }));
  const back = MUSCLE_POINTS.find((m) => m.id === 'back');
  const marks = [30, 90, 180, 360];
  return el('section', { class: 'panel', 'aria-labelledby': 'gr-proj-title' },
    el('div', { class: 'eyebrow' }, 'PROJECTIONS'),
    el('h2', { id: 'gr-proj-title' }, 'Bone and muscle loss projection at this gravity'),
    el('p', { class: 'muted' }, 'Profile', ': ', el('strong', {}, missionName), ' · ', `${fmt(g, 3)} g`, ' · ',
      'Share of the microgravity loss rate', ': ', el('strong', {}, `${fmt(f.central * 100, 0)}%`),
      partial ? el('span', {}, ' (', 'model assumption range', ' ', `${fmt(f.low * 100, 0)}–${fmt(f.high * 100, 0)}%`, ')') : null),
    marker ? null : el('p', { class: 'notice', 'data-status': 'advisory' }, state.hasStatus
      ? 'Scenario: the curves show the selected gravity profile. The astronaut’s own mission day is not applied, so there is no “today” marker.'
      : 'Scenario: the astronaut’s mission day is unknown, so there is no “today” marker.'),
    partial ? el('p', { class: 'notice', 'data-status': 'watch' }, 'Partial gravity: NASA says there is no direct human evidence for long-term effects at Moon or Mars gravity; indirect evidence suggests that below 0.4 g bone and muscle are not protected. The shaded band is a model assumption range (from full protection at 0.4 g to no protection below 0.4 g), not a statistical confidence interval.') : null,
    el('div', { class: 'gr-proj-grid' },
      el('div', {},
        el('h3', {}, 'Projected bone mineral loss (no exercise adjustment)'),
        chartSlot((w) => lineChart(w, {
          maxDay: boneMax, series: bone, markerDay: marker, yTitle: 'Loss (%)', ariaLabel: 'Projected bone mineral loss by site over mission days',
          band: partial ? { lo: (d) => boneLoss(hip.pctPerMonth, d, f.low), hi: (d) => boneLoss(hip.pctPerMonth, d, f.high) } : null,
          refPoint: g === 0 ? [186, 2, 'Tim Peake: 2%'] : null,
        })),
        legend(bone.map((s) => s.name)),
        el('p', { class: 'muted gr-note' }, 'Published average rates in microgravity: hip 1.5%, lumbar spine 1%, whole body 0.3% per month.', g === 0 ? ' The point marks a 186-day mission with good exercise and a 2% total loss.' : '', partial ? ' The band is the hip range.' : '')),
      el('div', {},
        el('h3', {}, 'Projected muscle volume loss'),
        chartSlot((w) => lineChart(w, {
          maxDay: muscleMax, series: muscle, markerDay: marker, yTitle: 'Volume loss (%)', ariaLabel: 'Projected muscle volume loss by muscle group over mission days',
          band: partial ? { lo: (d) => muscleLoss(back.points, d, f.low), hi: (d) => muscleLoss(back.points, d, f.high) } : null,
        })),
        legend(muscle.map((s) => s.name)),
        el('p', { class: 'muted gr-note' }, 'Lines join the published points (6–9 day flights and 6-month ISS missions) and level off after 6 months. Strength loss can be much larger than volume loss: one astronaut lost 20% of calf volume and 50% of explosive power.', partial ? ' The band is the back-muscle range.' : ''))),
    el('div', { class: 'gr-metrics' },
      ...BONE_RATES.map((b) => el('div', { class: 'gr-card' }, el('span', { class: 'metric__label' }, t(b.name), ' · ', refLabel),
        el('strong', { class: 'gr-big' }, `${fmt(boneLoss(b.pctPerMonth, refDay, f.central), 2)}%`), el('small', { class: 'muted' }, 'projected bone loss'))),
      el('div', { class: 'gr-card' }, el('span', { class: 'metric__label' }, t(back.name), ' · ', refLabel),
        el('strong', { class: 'gr-big' }, `${fmt(muscleLoss(back.points, refDay, f.central), 1)}%`), el('small', { class: 'muted' }, 'projected volume loss'))),
    el('details', { class: 'more' }, el('summary', {}, 'Show projected values as a table'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Mission day'), ...BONE_RATES.map((b) => el('th', { scope: 'col' }, t(b.name), ' (%)')), ...MUSCLE_POINTS.map((m) => el('th', { scope: 'col' }, t(m.name), ' (%)')))),
        el('tbody', {}, marks.map((d) => el('tr', {}, el('td', {}, String(d)),
          ...BONE_RATES.map((b) => el('td', {}, fmt(boneLoss(b.pctPerMonth, d, f.central), 2))),
          ...MUSCLE_POINTS.map((m) => el('td', {}, fmt(muscleLoss(m.points, d, f.central), 1)))
        )))))));
}

// Rows match the selected mission by id (ISS and Mars transit are both 0 g, so g alone is ambiguous).
function environmentSection(missionId) {
  const hip = BONE_RATES[0];
  const back = MUSCLE_POINTS.find((m) => m.id === 'back');
  return el('section', { class: 'panel', 'aria-labelledby': 'gr-env-title' },
    el('div', { class: 'eyebrow' }, 'THREE GRAVITY FIELDS'),
    el('h2', { id: 'gr-env-title' }, 'Gravity environment comparison'),
    el('p', { class: 'muted' }, 'On a Mars mission the crew meets three gravity fields: weightlessness in transit, about one third of Earth gravity on Mars and Earth gravity again on return. Each transition affects orientation, hand–eye coordination, balance and walking (NASA RIDGE).'),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table gr-env-table' },
      el('thead', {}, el('tr', {}, ['Environment', 'Gravity', 'Earth load', 'Hip bone loss per month', 'Back muscle loss at 6 months', 'Signal delay', 'Monitor change'].map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ENVIRONMENTS.map((env) => {
        const f = gravityFactor(env.g);
        const range = env.g > 0 && env.g < 1;
        return el('tr', { 'data-current': (env.missions || []).includes(missionId) ? 'true' : null },
          el('td', {}, t(env.name)),
          el('td', {}, `${fmt(env.g, env.g ? 2 : 0)} g`),
          el('td', {}, `${fmt(env.g * 100, 0)}%`),
          el('td', {}, `${fmt(hip.pctPerMonth * f.central, 2)}%`, range ? el('small', { class: 'muted' }, ` (${fmt(hip.pctPerMonth * f.low, 2)}–${fmt(hip.pctPerMonth * f.high, 2)})`) : null),
          el('td', {}, `${fmt(muscleLoss(back.points, 180, f.central), 1)}%`, range ? el('small', { class: 'muted' }, ` (${fmt(muscleLoss(back.points, 180, f.low), 1)}–${fmt(muscleLoss(back.points, 180, f.high), 1)})`) : null),
          el('td', {}, t(env.delay)),
          el('td', {}, t(env.change)));
      })))),
    el('p', { class: 'muted gr-note' }, 'Ranges in brackets are model assumption ranges. Mars surface is a reference row; the app has no Mars surface mission profile yet. A mouse study on the ISS found muscle weakening at every gravity level below 0.67 g.'));
}

// ---------- Evidence charts ----------

function incidenceChart() {
  const rows = [...INCIDENCE].sort((a, b) => b.hi - a.hi || b.lo - a.lo);
  return el('div', { class: 'gr-hbars' }, rows.map((row) => {
    const level = riskLevel(riskScore(riskById(row.risk)));
    const ranged = row.hi > row.lo;
    return el('div', { class: 'gr-hbar' },
      el('span', { class: 'gr-hbar-name' }, el('span', { class: 'gr-code' }, row.risk), t(row.name)),
      el('span', { class: 'gr-track gr-track--tall' },
        el('span', { class: 'gr-fill', 'data-level': level, style: `width:${row.lo}%` }),
        ranged ? el('span', { class: 'gr-fill gr-fill--range', 'data-level': level, style: `left:${row.lo}%;width:${row.hi - row.lo}%` }) : null),
      el('span', { class: 'gr-hbar-val' }, row.upTo ? el('span', {}, 'up to', ' ') : null, ranged ? `${row.lo}–${row.hi}%` : `${row.lo}%`));
  }));
}

const LOG_MAX = Math.log10(1100);
const logPos = (d) => (Math.log10(Math.max(1, d)) / LOG_MAX) * 100;

function recoveryChart() {
  const ticks = [[7, '1 week'], [30, '1 month'], [90, '3 months'], [365, '1 year'], [1095, '3 years']];
  return el('div', { class: 'gr-recovery' },
    el('div', { class: 'gr-hbar gr-recovery-axis', 'aria-hidden': 'true' }, el('span', {}), el('span', { class: 'gr-axis-track' }, ticks.filter(([d]) => [7, 30, 365].includes(d)).map(([d, label]) => el('span', { style: `left:${logPos(d).toFixed(1)}%` }, label))), el('span', {})),
    RECOVERY.map((row) => {
      const level = riskLevel(riskScore(riskById(row.risk)));
      const left = logPos(row.lo);
      const width = Math.max(1.6, logPos(row.hi) - left);
      const days = row.hi > row.lo ? `${row.lo}–${row.hi}` : String(row.lo);
      return el('div', { class: 'gr-hbar' },
        el('span', { class: 'gr-hbar-name' }, el('span', { class: 'gr-code' }, row.risk), t(row.name)),
        el('span', { class: 'gr-track gr-track--tall gr-track--log' },
          ticks.map(([d]) => el('i', { class: 'gr-tick', style: `left:${logPos(d).toFixed(1)}%` })),
          el('span', { class: 'gr-fill gr-fill--range', 'data-level': level, style: `left:${left.toFixed(1)}%;width:${width.toFixed(1)}%` })),
        el('span', { class: 'gr-hbar-val' }, days, ' ', 'days'));
    }));
}

function phaseHeatmap() {
  const phases = PHASES.filter((p) => p.id !== 'P0');
  return el('div', { class: 'table-wrap' }, el('table', { class: 'table gr-heat' },
    el('caption', { class: 'visually-hidden' }, 'Risk intensity by mission phase'),
    el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Risk'), phases.map((p) => el('th', { scope: 'col', 'data-current': p.id === state.phaseId ? 'true' : null, title: t(p.name) }, p.id)))),
    el('tbody', {}, rankedRisks().map((r) => el('tr', {},
      el('th', { scope: 'row' }, riskButton(r, null, false)),
      phases.map((p) => {
        const focus = p.focus.includes(r.id);
        const expected = (r.expectedIn || []).includes(p.id);
        const kind = focus ? 'focus' : expected ? 'expected' : null;
        // A risk can be in focus and have expected symptoms in the same phase: both marks are drawn.
        return el('td', { 'data-heat': kind, 'data-level': focus ? riskLevel(riskScore(r)) : null, 'data-current': p.id === state.phaseId ? 'true' : null },
          focus ? el('span', {}, '●', el('span', { class: 'visually-hidden' }, ' ', 'In focus')) : null,
          expected ? el('span', { class: 'gr-expected-mark' }, '○', el('span', { class: 'visually-hidden' }, ' ', 'Expected')) : null);
      }))))));
}

function evidenceSection() {
  return el('section', { class: 'panel', 'aria-labelledby': 'gr-evidence-title' },
    el('div', { class: 'eyebrow' }, 'EVIDENCE'),
    el('h2', { id: 'gr-evidence-title' }, 'What the studies report'),
    el('div', { class: 'gr-proj-grid' },
      el('div', {}, el('h3', {}, 'How often it happens (% of astronauts)'), incidenceChart(),
        el('p', { class: 'muted gr-note' }, 'A lighter segment shows a reported range. Small study groups (for example 11 astronauts in the clot study) mean large individual differences.')),
      el('div', {}, el('h3', {}, 'How long recovery takes after return'), recoveryChart(),
        el('p', { class: 'muted gr-note' }, 'Logarithmic time axis. Accounts differ: Rubio recovered in weeks, Marshburn in about three months, and some astronauts did not regain bone loss after a year.'))),
    el('h3', {}, 'Risk intensity by mission phase'),
    el('p', { class: 'muted' }, '● risk in focus in that phase · ○ symptom expected (information note, no alarm). P1 adaptation, P2 early flight, P3 long flight, P4 landing, P5 recovery.'),
    phaseHeatmap());
}

function sourcesFooter() {
  return el('details', { class: 'more' },
    el('summary', {}, 'Sources for the gravity risk analysis'),
    el('ul', {}, SOURCES.map((s) => el('li', {}, s.url
      ? el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, t(s.title))
      : t(s.title)))),
    el('p', { class: 'estimate-note' }, 'Risk scores are the team’s assessment; some thresholds (strength loss percentages, fluid target, screening days) are prototype proposals that need clinical validation. Partial-gravity effects have not been measured directly in humans. This is decision support, not a medical device.'));
}

// ---------- Entry point ----------

// Returns the gravity risk sections.
// g, missionId, missionName: the selected gravity profile. status: the astronaut's status, or null when it
// could not be loaded. ownMissionName: name of the astronaut's own mission.
export function gravityInsights({ g, missionId, missionName, status, ownMissionName }) {
  for (const slot of slots) observer.unobserve(slot);
  slots.clear();
  const day = Number(status?.astronaut?.mission_day);
  state.hasStatus = Boolean(status);
  state.hasCheckin = Boolean(status?.checkin);
  state.day = status && Number.isFinite(day) ? day : null;
  state.phaseId = state.day === null ? null : phaseFor(state.day);
  state.fresh = status?.freshness?.state === 'current';
  const age = Number(status?.freshness?.age_hours);
  state.ageHours = status?.freshness?.age_hours != null && Number.isFinite(age) ? age : null;
  state.ownMission = Boolean(status) && status.mission?.id === missionId;
  state.ownMissionName = ownMissionName || status?.mission?.name || status?.mission?.id || '';
  state.astronautName = status?.astronaut?.name || '';
  state.assessment = state.hasCheckin ? liveAssessment(status, state.phaseId) : [];
  return [
    phaseSection(),
    liveSection(),
    matrixSection(),
    projectionSection(Number(g) || 0, missionName),
    environmentSection(missionId),
    evidenceSection(),
    sourcesFooter(),
  ];
}

