import assert from 'node:assert/strict';
import { pearson, matrix, minPairs, MIN_PAIRS } from './correlation.js';

const a = Array.from({ length: 12 }, (_, i) => i);
assert.equal(MIN_PAIRS, 10);
assert.ok(Math.abs(pearson(a, a.map((x) => 2 * x + 1)).r - 1) < 1e-12);
assert.ok(Math.abs(pearson(a, a.map((x) => -3 * x)).r + 1) < 1e-12);
assert.deepEqual(pearson([1, 2, 3], [1, 2, 3]), { r: null, n: 3 });
const withNulls = pearson([...a, null, 5], [...a, 7, null]);
assert.equal(withNulls.n, 12);
assert.ok(Math.abs(withNulls.r - 1) < 1e-12);
assert.equal(pearson(a, a.map(() => 4)).r, null);
assert.equal(minPairs({ params: { 'trends.min_pairs': 5 } }), 5);
assert.equal(minPairs({ params: {} }), 10);

const pts = a.map((x) => ({ values: { p: x, q: -x, s: x % 3 } }));
const m = matrix(pts, ['p', 'q', 's']);
assert.equal(m.length, 3);
assert.ok(m.every((row) => row.length === 3));
assert.equal(m[1][1], null);
assert.ok(Math.abs(m[0][1].r + 1) < 1e-12);
assert.equal(m[0][1].r, m[1][0].r);
console.log('correlation tests passed');
