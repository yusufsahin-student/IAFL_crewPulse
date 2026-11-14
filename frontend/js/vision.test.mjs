// Run: node frontend/js/vision.test.mjs
import assert from 'node:assert/strict';
import {
  pxPerMmFromCard, letterHeightMm, buildLines, randomDirections, countCorrect, linePasses,
  acuityResult, amslerDistanceMm, amslerWidthPx, toggleSquare, amslerTotal, DIRECTIONS,
} from './vision.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

near(pxPerMmFromCard(342.4), 4, 1e-9);

// 5 arcmin at 400 mm is 0.582 mm; logMAR 1.0 is ten times larger on the angle.
near(letterHeightMm(0), 0.5818, 0.001);
near(letterHeightMm(1.0), 5.818, 0.01);
assert.ok(letterHeightMm(0.5) > letterHeightMm(0.4));

// A 96 dpi screen (3.78 px/mm, dpr 1): the 0.0 line has a 0.58 mm letter = 2.2 px, stroke 0.44 px -> skipped.
let r = buildLines(3.78, 1);
assert.equal(r.floored, true);
assert.equal(r.lines[0].logMar, 1.0);
assert.ok(r.lines.every((l) => l.heightPx / 5 >= 1));
assert.ok(r.lines.length < 11);
// A sharp phone (dpr 3, 12 px/mm) can show every line.
r = buildLines(12, 3);
assert.equal(r.floored, false);
assert.equal(r.lines.length, 11);
assert.deepEqual(r.lines.map((l) => l.logMar), [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0]);

const dirs = randomDirections(() => 0.99);
assert.equal(dirs.length, 5);
assert.ok(dirs.every((d) => d === 'left'));
assert.ok(randomDirections().every((d) => DIRECTIONS.includes(d)));

assert.equal(countCorrect(['up', 'down', 'left'], ['up', 'down', 'right']), 2);
assert.equal(linePasses(2), false);
assert.equal(linePasses(3), true);

assert.equal(acuityResult([{ logMar: 1, passed: true }, { logMar: 0.9, passed: true }, { logMar: 0.8, passed: false }]), 0.9);
assert.equal(acuityResult([{ logMar: 1, passed: false }]), 1.1);
assert.equal(acuityResult([]), 1.1);
assert.equal(acuityResult([{ logMar: 1, passed: true }, { logMar: 0.9, passed: false }, { logMar: 0.8, passed: true }]), 1);

near(amslerDistanceMm(100), 283.6, 0.5);
assert.equal(amslerWidthPx(4, 800), 400);
assert.equal(amslerWidthPx(4, 300), 300);

let left = toggleSquare(new Set(), 5);
left = toggleSquare(left, 7);
left = toggleSquare(left, 5);
assert.deepEqual([...left], [7]);
assert.equal(amslerTotal(left, new Set([1, 2])), 3);
assert.equal(amslerTotal(), 0);

console.log('vision tests passed');
