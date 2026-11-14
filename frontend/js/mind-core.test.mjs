import assert from 'node:assert/strict';
import {
  assess,
  summarize,
  COGNITIVE_TASKS,
  scoreCognitiveTask,
  summarizeCognitiveBattery,
} from './mind-core.js';

const entry = (day, ms = 300, state = 'usual') => ({
  at: `2026-11-${day}T08:00:00Z`,
  pvt: { median_ms: ms },
  survey: { sleep: 8, mood: 4 },
  assessment: { state },
});

assert.equal(assess(entry(20), []).state, 'learning');
const history = [15, 16, 17, 18, 19].map((d) => entry(d));
assert.equal(assess(entry(20), history).state, 'usual');
assert.equal(assess(entry(20, 400), history).state, 'watch');
const stressed = entry(20);
stressed.survey.stress = 5;
assert.equal(assess(stressed, history).state, 'watch');
history[3].assessment.state = history[4].assessment.state = 'watch';
assert.equal(assess(entry(20, 400), history).state, 'review');
assert.equal(assess(entry(22, 400), history).state, 'watch');
assert.equal(assess(entry(20), Array(8).fill(entry(19))).state, 'learning');
assert.deepEqual(summarize([200, 300, 600], 2), { median_ms: 300, lapses: 1, early: 2, trials: 3 });
assert.equal(assess({ at: '2026-11-13T08:00:00Z', pvt: null, survey: {} }, []).state, 'skipped');

assert.equal(COGNITIVE_TASKS.length, 8);
const samples = [
  scoreCognitiveTask('motor_praxis', { hits: 10, total: 10, medianMs: 320 }),
  scoreCognitiveTask('visual_memory', { correct: 7, total: 8, meanMs: 1100 }),
  scoreCognitiveTask('fractal_2back', { correct: 7, total: 8, meanMs: 1200 }),
  scoreCognitiveTask('abstract_matching', { correct: 5, total: 6, meanMs: 2100 }),
  scoreCognitiveTask('line_orientation', { trials: 5, meanErrDeg: 3.2, meanMs: 2500 }),
  scoreCognitiveTask('matrix_reasoning', { correct: 4, total: 4, meanMs: 4200 }),
  scoreCognitiveTask('digit_symbol', { correct: 15, total: 16 }),
  scoreCognitiveTask('bart', { banked: 725, bursts: 1, total: 6 }),
];
for (const s of samples) {
  assert.ok(s.score >= 0 && s.score <= 1000, `${s.id} score out of bounds: ${s.score}`);
  assert.ok(s.metricsText.length > 0, `${s.id} missing metricsText`);
}
const bat = summarizeCognitiveBattery(Object.fromEntries(samples.map((s) => [s.id, s])));
assert.equal(bat.completedCount, 8);
assert.equal(bat.totalCount, 8);
assert.ok(bat.averageScore > 500 && bat.averageScore <= 1000);
console.log('mind baseline, missing days, persistence, and 8 cognitive task scoring tests passed');
