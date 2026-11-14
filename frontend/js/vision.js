// Pure helpers for the on-screen eye tests (near acuity, Amsler grid). No DOM here, so node can test them.
// Run the tests with: node frontend/js/vision.test.mjs

export const CARD_MM = 85.6;          // ISO/IEC 7810 ID-1 bank card width, used to calibrate the screen
export const NEAR_DISTANCE_MM = 400;  // reading distance for the near test
export const LETTERS_PER_LINE = 5;
export const PASS_CORRECT = 3;        // a line passes with at least 3 of 5 right
export const NO_PASS_LOGMAR = 1.1;    // reported when not even the largest line is passed
export const TOP_LOGMAR = 1.0;
export const AMSLER_SQUARES = 20;     // 20 x 20 squares
export const AMSLER_WIDTH_MM = 100;   // about 10 cm, viewed from about 28 cm (20 degrees wide)
export const DIRECTIONS = ['up', 'right', 'down', 'left'];

export function pxPerMmFromCard(cardWidthPx) {
  return cardWidthPx / CARD_MM;
}

// Height of the letter E: 5 arcmin at logMAR 0, 10^logMAR times larger at other lines.
export function letterHeightMm(logMar, distanceMm = NEAR_DISTANCE_MM) {
  return distanceMm * Math.tan(((5 / 60) * 10 ** logMar * Math.PI) / 180);
}

// Lines from logMAR 1.0 down to 0.0 in 0.1 steps. A line whose stroke (height / 5) is under one
// device pixel cannot be drawn, so it is skipped and `floored` says the screen limited the test.
export function buildLines(pxPerMm, dpr = 1) {
  const lines = [];
  let floored = false;
  for (let k = 0; k <= 10; k += 1) {
    const logMar = Math.round((TOP_LOGMAR - k / 10) * 10) / 10;
    const heightMm = letterHeightMm(logMar);
    const heightPx = heightMm * pxPerMm;
    if ((heightPx / 5) * dpr < 1) {
      floored = true;
      continue;
    }
    lines.push({ logMar, heightMm, heightPx });
  }
  return { lines, floored };
}

export function randomDirections(rng = Math.random, n = LETTERS_PER_LINE) {
  return Array.from({ length: n }, () => DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)]);
}

export function countCorrect(shown, answered) {
  return shown.reduce((n, d, i) => n + (answered[i] === d ? 1 : 0), 0);
}

export function linePasses(correct) {
  return correct >= PASS_CORRECT;
}

// results: [{logMar, passed}] from the largest line down; the test stops at the first failed line.
// Returns the smallest passed line; NO_PASS_LOGMAR when even the first line failed.
export function acuityResult(results) {
  let best = null;
  for (const r of results) {
    if (!r.passed) break;
    best = r.logMar;
  }
  return best === null ? NO_PASS_LOGMAR : best;
}

// Distance at which a grid of this width spans 20 degrees (10 cm -> about 28 cm).
export function amslerDistanceMm(widthMm = AMSLER_WIDTH_MM) {
  return widthMm / (2 * Math.tan((10 * Math.PI) / 180));
}

// Grid width in CSS px: about 10 cm, or the space available when the screen is narrower.
export function amslerWidthPx(pxPerMm, availablePx) {
  return Math.min(AMSLER_WIDTH_MM * pxPerMm, availablePx);
}

export function toggleSquare(marked, index) {
  const next = new Set(marked);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

export function amslerTotal(...eyes) {
  return eyes.reduce((n, set) => n + set.size, 0);
}
