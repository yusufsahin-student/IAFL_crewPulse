import assert from 'node:assert/strict';
import { gravityPoints, seriesDomain, transitionPoints } from './gravity-chart.js';

const points = gravityPoints([
  { observed_at: '2026-11-02T08:00:00Z', gravity_g: 0.38 },
  { observed_at: '2026-11-01T08:00:00Z', gravity_g: 0 },
]);
assert.deepEqual(points.map((point) => point.g), [0, 0.38]);
assert.equal(transitionPoints(points).length, 1);
assert.deepEqual(seriesDomain([], [0, 1]), [0, 1]);
const domain = seriesDomain([0.38, 0.38]);
assert.ok(domain[0] < 0.38 && domain[1] > 0.38);
assert.equal(gravityPoints([{observed_at:'2026-11-01',gravity_g:null},{observed_at:'bad',gravity_g:0}]).length,0);
console.log('gravity chart tests passed');
