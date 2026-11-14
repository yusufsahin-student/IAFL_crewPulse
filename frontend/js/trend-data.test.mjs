import assert from 'node:assert/strict';
import { selectSolarEvents } from './trend-data.js';

const primary = [{ id: 'primary' }];
const fallback = [{ id: 'fallback' }];

assert.deepEqual(selectSolarEvents({ events: primary }, fallback), primary);
assert.deepEqual(selectSolarEvents({ events: [] }, fallback), fallback);
assert.deepEqual(selectSolarEvents(null, fallback), fallback);
assert.deepEqual(selectSolarEvents(null, { events: fallback }), fallback);
assert.deepEqual(selectSolarEvents(null, null), []);

console.log('trend response-shape tests passed');
