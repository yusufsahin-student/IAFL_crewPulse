export const median = (xs) => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

export function summarize(trials, early) {
  return {
    median_ms: median(trials),
    lapses: trials.filter((t) => t >= 500).length,
    early,
    trials: trials.length,
  };
}

export function assess(today, history) {
  if (!today.pvt?.median_ms) {
    return {
      state: 'skipped',
      baseline: null,
      delta: null,
      message: 'The attention test was skipped. This session is not included in reaction-time comparison.',
    };
  }
  const days = new Map();
  for (const h of [...history].sort((a, b) => a.at.localeCompare(b.at))) {
    if (h.at.slice(0, 10) < today.at.slice(0, 10) && h.pvt?.median_ms) days.set(h.at.slice(0, 10), h);
  }
  const base = [...days.values()].slice(-5);
  if (base.length < 5) {
    return {
      state: 'learning',
      baseline: null,
      delta: null,
      message: `Preparing personal comparison: ${base.length}/5 previous days. Today's result alone must not drive a health decision.`,
    };
  }
  const baseline = median(base.map((h) => h.pvt.median_ms));
  const delta = ((today.pvt.median_ms - baseline) / baseline) * 100;
  const watch = delta >= 20
    || today.survey.sleep < 7
    || today.survey.mood <= 2
    || today.survey.stress >= 4
    || today.survey.loneliness >= 4
    || today.survey.workload >= 4;
  const last = base.slice(-2);
  const consecutive = last.length === 2
    && last.every((h, i) => Math.round((Date.parse(today.at.slice(0, 10)) - Date.parse(h.at.slice(0, 10))) / 86400000) === 2 - i);
  const persistent = watch
    && consecutive
    && last.every((h) => h.assessment?.state === 'watch' || h.assessment?.state === 'review');
  return {
    state: persistent ? 'review' : watch ? 'watch' : 'usual',
    baseline,
    delta: Math.round(delta),
    message: persistent
      ? 'The change has continued for three days. Review the results with the crew medical officer and ground team.'
      : watch
        ? 'Today\'s result differs from your pattern or you report a need for rest. Review the rest plan and reassess under the same conditions.'
        : 'Today\'s attention result is similar to your recent history. This result does not guarantee your overall health.',
  };
}

export const COGNITIVE_TASKS = [
  {
    id: 'motor_praxis',
    code: '01',
    name: 'Motor Praxis',
    domain: 'Sensorimotor speed',
    see: 'A grey arena where blue target squares appear at varying positions and sizes.',
    doText: 'Tap or click each blue square as quickly and accurately as you can.',
    measures: 'Hand–eye coordination speed and aiming precision.',
    why: 'Tracks fine-motor readiness before robotic arm tasks, maintenance or docking.',
  },
  {
    id: 'visual_memory',
    code: '02',
    name: 'Visual Object Learning',
    domain: 'Visual memory',
    see: 'A short study sequence of geometric SVG shapes followed by a mixed test list.',
    doText: 'Memorise the initial shapes, then select Yes (Seen) or No (New) for each test shape.',
    measures: 'Visual episodic recognition accuracy and recall latency.',
    why: 'Supports equipment checklist recall and visual orientation aboard spacecraft.',
  },
  {
    id: 'fractal_2back',
    code: '03',
    name: 'Fractal 2-Back',
    domain: 'Working memory',
    see: 'Layered geometric patterns shown one card at a time.',
    doText: 'Starting from step 3, press Match if the pattern equals the one from 2 steps earlier, or Skip.',
    measures: 'Working memory updating and sustained focus under cognitive load.',
    why: 'Working memory degrades early during high workload, CO2 elevation or sleep loss.',
  },
  {
    id: 'abstract_matching',
    code: '04',
    name: 'Abstract Matching',
    domain: 'Abstraction & rule finding',
    see: 'Two example clusters (Group A and Group B) and one candidate shape below.',
    doText: 'Infer the hidden visual rule (shape, count, fill or ring) and assign the candidate.',
    measures: 'Rule induction, conceptual reasoning and cognitive flexibility.',
    why: 'Measures mental adaptability when handling unexpected spacecraft alerts.',
  },
  {
    id: 'line_orientation',
    code: '05',
    name: 'Line Orientation',
    domain: 'Spatial orientation',
    see: 'A dark reference line paired with an adjustable blue target line.',
    doText: 'Rotate the blue line until it runs parallel to the reference line, then lock it in.',
    measures: 'Visuospatial angle judgment and mean angular error in degrees.',
    why: 'Critical in microgravity where inner-ear vertical gravity cues are absent.',
  },
  {
    id: 'matrix_reasoning',
    code: '06',
    name: 'Matrix Reasoning',
    domain: 'Logical reasoning',
    see: 'A 3×3 grid of evolving geometric shapes with the bottom-right cell marked ?.',
    doText: 'Deduce the pattern progression across rows and columns and pick the missing piece.',
    measures: 'Fluid non-verbal reasoning and multi-step logic.',
    why: 'Reflects diagnostic and troubleshooting clarity during complex mission events.',
  },
  {
    id: 'digit_symbol',
    code: '07',
    name: 'Digit-Symbol Substitution',
    domain: 'Processing speed',
    see: 'A top reference key pairing digits 1–6 with symbols and a central prompt symbol.',
    doText: 'Select the matching digit (1–6) for each prompt symbol during a 25-second sprint.',
    measures: 'Visual scanning speed, associative accuracy and throughput.',
    why: 'Sensitive to cumulative fatigue, circadian shift and acute stress.',
  },
  {
    id: 'bart',
    code: '08',
    name: 'Balloon Risk Test (BART)',
    domain: 'Risk decision-making',
    see: 'An expanding on-screen balloon with Inflate (+25 pts) and Collect points buttons.',
    doText: 'Pump to build temporary points, then bank them before the balloon bursts.',
    measures: 'Risk propensity, reward sensitivity and impulse control.',
    why: 'Helps detect overly cautious hesitation or risky shortcuts under fatigue.',
  },
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function scoreCognitiveTask(id, m = {}) {
  let score = 0;
  let metricsText = '';
  switch (id) {
    case 'motor_praxis': {
      const total = Math.max(1, Number(m.total) || 1);
      const hits = Number(m.hits) || 0;
      const med = Number(m.medianMs) || 1200;
      const acc = clamp(hits / total, 0, 1);
      const speed = clamp((1200 - med) / 900, 0, 1);
      score = Math.round(clamp(acc * 700 + speed * 300, 0, 1000));
      metricsText = `${hits}/${total} hits · median ${Math.round(med)} ms`;
      break;
    }
    case 'visual_memory': {
      const total = Math.max(1, Number(m.total) || 1);
      const correct = Number(m.correct) || 0;
      const meanMs = Number(m.meanMs) || 2500;
      const acc = clamp(correct / total, 0, 1);
      const speed = clamp((2600 - meanMs) / 2100, 0, 1);
      score = Math.round(clamp(acc * 850 + speed * 150, 0, 1000));
      metricsText = `${correct}/${total} correct · ${Math.round(meanMs)} ms avg`;
      break;
    }
    case 'fractal_2back': {
      const total = Math.max(1, Number(m.total) || 1);
      const correct = Number(m.correct) || 0;
      const meanMs = Number(m.meanMs) || 2200;
      const acc = clamp(correct / total, 0, 1);
      const speed = clamp((2400 - meanMs) / 1900, 0, 1);
      score = Math.round(clamp(acc * 850 + speed * 150, 0, 1000));
      metricsText = `${correct}/${total} correct · ${Math.round(meanMs)} ms avg`;
      break;
    }
    case 'abstract_matching': {
      const total = Math.max(1, Number(m.total) || 1);
      const correct = Number(m.correct) || 0;
      const meanMs = Number(m.meanMs) || 4000;
      const acc = clamp(correct / total, 0, 1);
      const speed = clamp((4500 - meanMs) / 3500, 0, 1);
      score = Math.round(clamp(acc * 850 + speed * 150, 0, 1000));
      metricsText = `${correct}/${total} rules solved · ${Math.round(meanMs)} ms avg`;
      break;
    }
    case 'line_orientation': {
      const trials = Math.max(1, Number(m.trials) || 1);
      const meanErrDeg = Number.isFinite(Number(m.meanErrDeg)) ? Number(m.meanErrDeg) : 30;
      const meanMs = Number(m.meanMs) || 5000;
      const accPart = clamp(1 - meanErrDeg / 25, 0, 1);
      const speed = clamp((6000 - meanMs) / 5000, 0, 1);
      score = Math.round(clamp(accPart * 850 + speed * 150, 0, 1000));
      metricsText = `${trials} trials · mean error ${meanErrDeg.toFixed(1)}°`;
      break;
    }
    case 'matrix_reasoning': {
      const total = Math.max(1, Number(m.total) || 1);
      const correct = Number(m.correct) || 0;
      const meanMs = Number(m.meanMs) || 9000;
      const acc = clamp(correct / total, 0, 1);
      const speed = clamp((12000 - meanMs) / 10000, 0, 1);
      score = Math.round(clamp(acc * 850 + speed * 150, 0, 1000));
      metricsText = `${correct}/${total} matrices solved`;
      break;
    }
    case 'digit_symbol': {
      const total = Number(m.total) || 0;
      const correct = Number(m.correct) || 0;
      const acc = total > 0 ? clamp(correct / total, 0, 1) : 0;
      const speed = clamp(correct / 18, 0, 1);
      score = total > 0 ? Math.round(clamp(acc * 500 + speed * 500, 0, 1000)) : 0;
      metricsText = `${correct} correct of ${total} attempts`;
      break;
    }
    case 'bart': {
      const total = Math.max(1, Number(m.total) || 1);
      const banked = Number(m.banked) || 0;
      const bursts = Number(m.bursts) || 0;
      const bankRatio = clamp(banked / (total * 150), 0, 1);
      const penalty = bursts * 45;
      score = banked === 0 && bursts >= total ? 0 : Math.round(clamp(bankRatio * 900 + 100 - penalty, 0, 1000));
      metricsText = `${banked} pts banked · ${bursts}/${total} burst`;
      break;
    }
    default:
      score = 0;
      metricsText = '';
  }
  return { id, score, metricsText };
}

export function summarizeCognitiveBattery(tasksMap = {}) {
  const entries = COGNITIVE_TASKS.map((t) => tasksMap[t.id]).filter((x) => x && Number.isFinite(x.score));
  const completedCount = entries.length;
  const averageScore = completedCount
    ? Math.round(entries.reduce((sum, e) => sum + e.score, 0) / completedCount)
    : null;
  return {
    completedCount,
    totalCount: COGNITIVE_TASKS.length,
    averageScore,
    tasks: entries,
  };
}
