import assert from 'node:assert/strict';
import { fitTicks, responsiveChartHeight, selectSolarEvents, groupSolarEvents } from './trend-data.js';

const primary = [{ id: 'primary' }];
const fallback = [{ id: 'fallback' }];

assert.deepEqual(selectSolarEvents({ events: primary }, fallback), primary);
assert.deepEqual(selectSolarEvents({ events: [] }, fallback), fallback);
assert.deepEqual(selectSolarEvents(null, fallback), fallback);
assert.deepEqual(selectSolarEvents(null, { events: fallback }), fallback);
assert.deepEqual(selectSolarEvents(null, null), []);
const denseEvents = Array.from({length: 240}, (_, index) => ({id:index,startDay:Math.floor(index / 12),dose_relevant:index === 13}));
const grouped = groupSolarEvents(denseEvents);
assert.equal(grouped.length,20);
assert.equal(grouped.reduce((sum, group) => sum + group.events.length,0),240);
assert.equal(grouped[1].dose_relevant,true);
assert.equal(grouped[0].dose_relevant,false);
assert.deepEqual(groupSolarEvents([{startDay:null},{startDay:NaN}]),[]);

assert.equal(responsiveChartHeight(360), 280);
assert.equal(responsiveChartHeight(1200), 380);
assert.equal(responsiveChartHeight(360, true), 210);
assert.deepEqual(fitTicks([1, 2, 3, 4, 5, 6, 7], 240, 80), [1, 4, 7]);
assert.deepEqual(fitTicks([1, 2, 3], 800), [1, 2, 3]);

console.log('trend response-shape tests passed');
