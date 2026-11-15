const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);
const dayOf = (iso) => String(iso || '').slice(0, 10);
export const localDay = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function recentActivity(points = [], localLogs = [], today = localDay()) {
  const byDay = new Map();
  for (const point of points) {
    const day = point.taken_at ? localDay(point.taken_at) : '';
    const value = Number(point.values && point.values.exercise_minutes);
    if (day && day < today && Number.isFinite(value)) byDay.set(day, value);
  }
  for (const log of localLogs) {
    const day = dayOf(log.day);
    const value = Number(log.actual_minutes);
    if (day && day < today && Number.isFinite(value)) byDay.set(day, value);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([day, minutes]) => ({ day, minutes }));
}

export function activityTrend(points = [], indicatorId) {
  const samples = points.map(point => ({ at: point.taken_at, value: point.values?.[indicatorId] }))
    .filter(sample => sample.at && sample.value != null && Number.isFinite(Number(sample.value)))
    .sort((a,b) => String(a.at).localeCompare(String(b.at))).slice(-7);
  if (samples.length < 2) return null;
  return { first: Number(samples[0].value), last: Number(samples.at(-1).value), count: samples.length };
}

function latestValue(status, id) {
  const row = (status.indicators || []).find((item) => item.indicator_id === id);
  if (!row || row.value == null || !Number.isFinite(Number(row.value))) return null;
  const value = Number(row.value);
  if (['mood', 'stress'].includes(id) && (value < 1 || value > 5)) return null;
  return value;
}

function segmentPlan(total, missionId, gentle = false, gravityG = null) {
  if (gentle) return [{ id: 'mobility', label: 'Light movement and mobility', minutes: total, intensity: 'RPE 1–2 / 10', detail: 'Pain-free joint movement, breathing and very light stretching.', steps: ['5 min controlled breathing and joint scan', `${Math.max(10,total-10)} min pain-free mobility`, '5 min very light cool-down'] }];
  const surface = ['moon', 'mars', 'rover'].includes(missionId) || (gravityG > 0 && gravityG < 0.95);
  const ratios = gravityG !== null && gravityG < 0.05 ? [0.30, 0.50, 0.20]
    : surface ? [0.30, 0.40, 0.30] : [0.40, 0.35, 0.25];
  const resistance = round5(total * ratios[1]);
  const mobility = round5(total * ratios[2]);
  const aerobic = Math.max(0, total - resistance - mobility);
  return [
    { id: 'aerobic', label: 'Aerobic countermeasure', minutes: aerobic, intensity: 'RPE 3–5 / 10', detail: 'Treadmill or cycle; a controlled pace where you can keep talking.', steps: ['5 min easy warm-up', `${Math.max(5,aerobic-10)} min steady controlled pace`, '5 min easy cool-down'] },
    { id: 'resistance', label: 'Resistance and loading', minutes: resistance, intensity: 'RPE 5–7 / 10', detail: 'Major lower- and upper-body muscle groups; mission-approved equipment programme only.', steps: ['Choose 4–6 approved basic movements', '2–3 sets × 8–12 reps for each movement', 'Rest 60–90 sec between sets'] },
    { id: 'mobility', label: surface ? 'Balance and mobility' : 'Mobility and cool-down', minutes: mobility, intensity: 'RPE 1–3 / 10', detail: surface ? 'Balance, coordination and joint range of motion.' : 'Joint range of motion, trunk control and cool-down.', steps: [surface ? 'Balance and coordination near a support' : 'Shoulder, hip and spine mobility', 'Slow repetitions in a pain-free range', 'Cool down until breathing returns to normal'] },
  ];
}

export function buildRecommendations({ status, gravity = null, environment = null, radiation = null, bone = null, points = [] }) {
  const items = [];
  const add = (id, category, title, detail, priority, basis) => items.push({ id, category, title, detail, priority, basis });
  const currentG = gravity?.current_g == null ? NaN : Number(gravity.current_g);
  const flagged = (status?.indicators || []).filter(row => ['alert', 'watch'].includes(row.status));
  for (const row of flagged) add(`health-${row.indicator_id}`, 'Health', `${row.name}: review the reading`, 'Review the personal limit and the mission health guidance on the daily check-in screen.', row.status === 'alert' ? 'watch' : 'advisory', `Last value: ${row.value ?? '—'} ${row.unit || ''} · status: ${row.status}`);
  for (const id of ['sleep_hours', 'fluid_intake', 'kcal_intake']) {
    const trend = activityTrend(points, id);
    const indicator = (status?.indicators || []).find(row => row.indicator_id === id);
    const label = {sleep_hours:'Sleep',fluid_intake:'Fluid intake',kcal_intake:'Food intake'}[id];
    if (trend && indicator) add(`trend-${id}`, 'Trend', `${label}: review the recent change`, 'Review recent readings together with the daily check-in and your personal history; a change alone does not show a cause or a diagnosis.', 'normal', `${trend.count} records · first ${trend.first} → last ${trend.last} ${indicator.unit || ''}`);
  }
  if (Number.isFinite(currentG) && currentG < 0.67) {
    add('gravity-load', 'Activity', 'Review mechanical loading',
      'If safety and the mission protocol allow it, do the approved resistance block; record the completed load, sets and repetitions.',
      'advisory', `${currentG.toFixed(3)} g · modeled load deficit ${Number(gravity.load_deficit_pct || 0).toFixed(1)}%`);
  }
  if (Number(gravity?.transition_count) > 0) {
    add('gravity-transition', 'Readiness', 'Check transition readiness',
      'Before vehicle, landing or surface tasks, complete the approved balance, coordination and stand-up readiness checks.',
      'watch', `${gravity.transition_count} gravity-field transitions in the selected window`);
  }
  if (!gravity || !Number.isFinite(currentG)) add('gravity-missing', 'Gravity', 'Verify gravity data', 'Check the mission profile and the data source.', 'watch', 'Gravity data missing');
  if (!radiation) add('radiation-missing', 'Radiation', 'Check radiation data', 'Refresh the mission radiation screen and follow the current mission protocol.', 'watch', 'Radiation data unavailable');
  else if (radiation.active_event) add('radiation-event', 'Radiation', 'Assess the active space weather event', 'Follow the mission radiation and shelter protocol; review the plan with the mission lead.', 'watch', 'Active radiation event present');
  else {
    const dose = radiation.astronaut?.mission_dose_msv;
    const limit = radiation.astronaut?.pct_of_limit;
    const basis = dose != null ? `Estimated total mission dose ${dose} mSv${limit != null ? ` · ${limit}% of the limit` : ''}` : 'No active event reported; no dose value available';
    add('radiation-review', 'Radiation', 'Review radiation context', 'Review the estimated dose and habitat zones on the radiation screen.', 'normal', basis);
  }
  if (!bone?.sites?.length) add('bone-missing', 'Bone', 'Check the bone projection', 'Bone trend data could not be loaded; check the trends screen.', 'watch', 'Bone projection missing');
  else {
    const sites = bone.sites.filter(site => Number.isFinite(Number(site.loss_pct)) && site.loss_pct != null);
    if (sites.length) { const site = sites.reduce((a,b) => Number(a.loss_pct) >= Number(b.loss_pct) ? a : b); add('bone-review', 'Bone', 'Track bone loading and trend', 'Review mission-approved resistance work together with bone trends.', 'advisory', `${site.name}: modeled loss ${Number(site.loss_pct).toFixed(1)}%; an estimate, not a measurement`); }
  }
  if (!environment?.reading || environment?.freshness?.status !== 'current') {
    add('environment-verify', 'Environment', 'Verify cabin context sensors',
      'Refresh cabin CO₂, temperature and humidity readings before interpreting symptoms together with the environment.',
      'watch', 'Environmental context missing or out of date');
  } else {
    add('environment-log', 'Environment', 'Review cabin context with symptoms',
      'Use the latest cabin readings as context only; do not treat a link as a cause.',
      'normal', `CO₂ ${environment.reading.co2_ppm} ppm · ${environment.reading.temperature_c} °C · humidity ${environment.reading.humidity_pct}%`);
  }
  add('hydration-log', 'Recovery', 'Log fluid intake and recovery',
    "Log fluid intake, sleep, mood, stress and post-activity symptoms so tomorrow's recommendation rests on complete feedback.",
    'normal', 'Daily monitoring plan');
  for (const [id, title] of [['fluid_intake','Review fluid intake'],['kcal_intake','Review the nutrition log']]) {
    const row = (status?.indicators || []).find(item => item.indicator_id === id);
    if (row?.value != null) add(`nutrition-${id}`, 'Nutrition', title, 'Review the value together with the daily check-in and the mission nutrition plan.', row.status === 'alert' || row.status === 'watch' ? 'watch' : 'normal', `${row.name}: ${row.value} ${row.unit || ''} · check that the reading is current`);
  }
  if (!status?.freshness || status.freshness.state !== 'current') {
    add('health-check', 'Monitoring', 'Refresh the daily health check-in',
      'Complete a new daily check-in before going beyond the light verification plan.', 'watch', 'Health readings are out of date');
  } else {
    add('post-activity-check', 'Monitoring', 'Log the post-activity response',
      'After the session, log the completed minutes and any pain, dizziness, unusual shortness of breath or other symptoms.',
      'normal', 'Current health check-in available');
  }
  return items;
}

function controllerState(recent, target) {
  if (!recent.length) return { error: null, proportional: 0, integral: 0, derivative: 0, correction: 0, suggested: target, samples: 0 };
  const errors = recent.map((x) => target - x.minutes);
  const error = errors.at(-1);
  const proportional = 0.20 * error;
  const integral = 0.05 * (errors.reduce((sum, x) => sum + x, 0) / errors.length);
  const trend = recent.length > 1 ? recent.at(-1).minutes - recent.at(-2).minutes : 0;
  const derivative = -0.10 * trend;
  const correction = Math.max(-10, Math.min(10, proportional + integral + derivative));
  return { error: Math.round(error * 10) / 10, proportional: Math.round(proportional * 10) / 10, integral: Math.round(integral * 10) / 10, derivative: Math.round(derivative * 10) / 10, correction: Math.round(correction * 10) / 10, suggested: round5(target + correction), samples: recent.length };
}

export function buildAdaptivePlan({ status, points = [], localLogs = [], baseTarget = 60, today = localDay(), gravity = null, environment = null, radiation = null, bone = null }) {
  const target = Math.max(30, Math.min(120, Number(baseTarget) || 60));
  const recent = recentActivity(points, localLogs, today);
  const average = recent.length ? recent.reduce((sum, x) => sum + x.minutes, 0) / recent.length : null;
  const controller = controllerState(recent, target);
  const sleep = latestValue(status, 'sleep_hours');
  const mood = latestValue(status, 'mood');
  const stress = latestValue(status, 'stress');
  const safetyIds = new Set(['heart_rate', 'systolic_bp', 'diastolic_bp', 'spo2', 'body_temp']);
  const safetyAlert = (status.indicators || []).some((x) => safetyIds.has(x.indicator_id) && x.status === 'alert');
  const stale = !status.freshness || status.freshness.state !== 'current';
  const reasons = [];
  let mode = 'steady';
  let minutes = target;

  if (safetyAlert || Number(status.triage && status.triage.level) >= 2) {
    mode = 'hold'; minutes = 20;
    reasons.push('A safety warning was found: follow the onboard health protocol before intense exercise.');
  } else if (stale) {
    mode = 'verify'; minutes = Math.max(30, round5(target * 0.5));
    reasons.push('Health readings are out of date: take a new check-in first; use only the light plan meanwhile.');
  } else if ((sleep !== null && sleep < 6) || (mood !== null && mood <= 2) || (stress !== null && stress >= 4)) {
    mode = 'recover'; minutes = Math.max(30, round5(target * 0.75));
    reasons.push("At least one recovery indicator is low; today's load was reduced.");
  } else if (average !== null && average < target * 0.75) {
    mode = 'reentry'; minutes = Math.max(45, round5(target * 0.9));
    reasons.push('Recent completion is below target; a sustainable re-entry plan was selected.');
  } else if (average !== null && average >= target * 0.95 && (sleep === null || sleep >= 7) && (mood === null || mood >= 3) && (stress === null || stress <= 3)) {
    mode = 'build'; minutes = Math.min(120, round5(target * 1.1));
    reasons.push('Recent adherence and recovery support a small load increase.');
  } else {
    reasons.push(average === null ? 'No recent data yet; the mission base target is retained.' : 'Recent load is balanced; the mission base target is retained.');
  }

  const previous = [...localLogs].filter((x) => dayOf(x.day) < today).sort((a, b) => dayOf(a.day).localeCompare(dayOf(b.day))).at(-1);
  if (!['hold', 'verify', 'recover'].includes(mode) && previous && Number.isFinite(Number(previous.planned_minutes))) {
    const cap = Number(previous.planned_minutes) + 5;
    if (minutes > cap) { minutes = cap; reasons.push('The daily increase was capped at 5 minutes for safety.'); }
  }
  minutes = round5(minutes);
  const gentle = ['hold', 'verify', 'recover'].includes(mode);
  return {
    mode, minutes, base_target: target, recent, average: average === null ? null : Math.round(average * 10) / 10,
    sleep, mood, stress, reasons, controller: { ...controller, output: minutes },
    segments: segmentPlan(minutes, status.mission && status.mission.id, gentle, gravity?.current_g != null && Number.isFinite(Number(gravity.current_g)) ? Number(gravity.current_g) : null),
    recommendations: buildRecommendations({ status, gravity, environment, radiation, bone, points }).sort((a,b) => ({watch:0,advisory:1,normal:2}[a.priority] - {watch:0,advisory:1,normal:2}[b.priority])),
    context: { gravity, environmentFreshness: environment?.freshness || null },
    stop_rules: ['Stop immediately for chest pain, faintness or unusual shortness of breath.', 'Follow the health protocol for new pain or marked dizziness.', "Record the post-exercise reading and completed duration; tomorrow's plan will use them."],
    disclaimer: 'Prototype decision support; it does not replace the flight surgeon or mission exercise protocol.',
  };
}
