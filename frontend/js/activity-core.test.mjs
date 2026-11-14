import assert from 'node:assert/strict';
import {buildAdaptivePlan, recentActivity} from './activity-core.js';

const indicator = (indicator_id, value, status='normal') => ({indicator_id, value, status});
const base = (extra={}) => ({mission:{id:'iss'},freshness:{state:'current'},triage:{level:0},indicators:[indicator('sleep_hours',8),indicator('mood',4),indicator('stress',2),...extra.indicators||[]],...extra});
const points = (minutes) => minutes.map((value,i)=>({taken_at:`2026-11-${String(i+1).padStart(2,'0')}T08:00:00Z`,values:{exercise_minutes:value}}));

assert.equal(buildAdaptivePlan({status:base(),points:points([60,62,58,60,65,61,60]),today:'2026-11-13'}).mode,'build');
assert.equal(buildAdaptivePlan({status:base({indicators:[indicator('sleep_hours',5),indicator('mood',4),indicator('stress',2)]}),points:points([60]),today:'2026-11-13'}).mode,'recover');
assert.notEqual(buildAdaptivePlan({status:base({indicators:[indicator('sleep_hours',null),indicator('mood',4),indicator('stress',2)]}),points:points([60]),today:'2026-11-13'}).mode,'recover');
assert.equal(buildAdaptivePlan({status:base({freshness:{state:'stale'}}),points:[],today:'2026-11-13'}).mode,'verify');
assert.equal(buildAdaptivePlan({status:base({indicators:[indicator('heart_rate',145,'alert')]}),points:[],today:'2026-11-13'}).mode,'hold');
assert.equal(buildAdaptivePlan({status:base(),points:points([20,25,30,20,25]),today:'2026-11-13'}).mode,'reentry');
assert.equal(buildAdaptivePlan({status:base(),points:points([65,65,65]),localLogs:[{day:'2026-11-12',planned_minutes:45,actual_minutes:45}],today:'2026-11-13'}).minutes,50);
const controlled=buildAdaptivePlan({status:base(),points:points([50,52,55,57,58,60,60]),today:'2026-11-13'});
assert.equal(controlled.controller.samples,7);
assert.ok(Number.isFinite(controlled.controller.proportional));
assert.equal(controlled.controller.output,controlled.minutes);
assert.equal(buildAdaptivePlan({status:base({indicators:[indicator('sleep_hours',8),indicator('mood',4),indicator('stress',0)]}),points:[],today:'2026-11-13'}).stress,null);
assert.ok(controlled.segments.every(segment=>segment.intensity && segment.steps.length>=3));
assert.deepEqual(recentActivity(points([20]),[{day:'2026-11-01',actual_minutes:35}], '2026-11-13'),[{day:'2026-11-01',minutes:35}]);
console.log('activity adaptation tests passed');
