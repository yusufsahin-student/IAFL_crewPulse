// Run: node frontend/js/routine.test.mjs
import assert from 'node:assert/strict';
import { streak, dueState, badgeDays, badgeMeta, routineSummary, utcDay } from './routine.js';

const p = (...d) => d.map((x) => ({ taken_at: `${x}T08:00:00Z` }));

assert.deepEqual(streak([], '2026-11-13'), { current: 0, best: 0 });
assert.deepEqual(streak(p('2026-11-11', '2026-11-12', '2026-11-13'), '2026-11-13'), { current: 3, best: 3 });
assert.deepEqual(streak(p('2026-11-10', '2026-11-11', '2026-11-12'), '2026-11-13'), { current: 3, best: 3 }); // ends yesterday
assert.deepEqual(streak(p('2026-11-09', '2026-11-10', '2026-11-11'), '2026-11-13'), { current: 0, best: 3 }); // broken
assert.deepEqual(streak(p('2026-11-01', '2026-11-02', '2026-11-02', '2026-11-03', '2026-11-12', '2026-11-13'), '2026-11-13'), { current: 2, best: 3 });

const now = Date.parse('2026-11-13T12:00:00Z');
assert.equal(utcDay('2026-11-13T23:30:00Z'), '2026-11-13');
assert.equal(utcDay('invalid'), '');
assert.deepEqual(dueState('2026-11-13T07:00:00Z', 24, now), { state: 'ok', hours: 19 });
assert.deepEqual(dueState('2026-11-12T07:00:00Z', 24, now), { state: 'overdue', hours: 5 });
assert.equal(dueState(null, 24, now).state, 'none');
assert.deepEqual(badgeDays({ 'routine.badge_days_2': 7, 'routine.badge_days_1': 3, 'routine.badge_days_10': 90, x: 1 }), [3, 7, 90]);

assert.equal(badgeMeta(3).tier, 'bronze');
assert.equal(badgeMeta(7).tier, 'silver');
assert.equal(badgeMeta(30).tier, 'gold');

const summary = routineSummary({
  status: {
    checkin: { taken_at: '2026-11-13T07:00:00Z' },
    indicators: [
      { indicator_id: 'sleep_hours', name: 'Sleep duration', value: 7.5, status: 'normal', range: { normal_low: 7 } },
      { indicator_id: 'grip_strength', name: 'Grip strength', value: 20, status: 'watch', range: { normal_low: 27 } },
    ],
  },
  points: p('2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'),
  config: {
    params: {
      'routine.checkin_interval_h': 24,
      'routine.badge_days_1': 3,
      'routine.badge_days_2': 7,
      'routine.badge_days_3': 30,
    },
    indicators: [
      { id: 'sleep_hours', higher_is_better: 0, normal_low: 7 },
      { id: 'grip_strength', higher_is_better: 1, normal_low: 16 },
    ],
  },
  now,
});
assert.equal(summary.currentDays, 4);
assert.equal(summary.bestDays, 4);
assert.equal(summary.doneCount, 2);
assert.equal(summary.totalTasks, 3);
assert.equal(summary.earnedCount, 1);
assert.equal(summary.nextBadgeDays, 7);
assert.equal(summary.daysToNext, 3);
assert.equal(summary.badges[0].earned, true);
assert.equal(summary.badges[1].remainingDays, 3);

console.log('routine tests passed');
