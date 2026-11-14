// On-screen eye tests for the check-in: near acuity (tumbling E at 40 cm) and the Amsler grid.
// Pure helpers live in vision.js (tested in vision.test.mjs); this file only draws and listens.
import { el } from './shell.js';
import {
  CARD_MM, NEAR_DISTANCE_MM, LETTERS_PER_LINE, NO_PASS_LOGMAR, AMSLER_SQUARES,
  pxPerMmFromCard, buildLines, randomDirections, countCorrect, linePasses, acuityResult,
  amslerDistanceMm, amslerWidthPx, toggleSquare, amslerTotal,
} from './vision.js';

const SCALE_KEY = 'astro.pxPerMm';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ARROW = { up: '↑', right: '→', down: '↓', left: '←' };
const ROTATE = { right: 0, down: 90, left: 180, up: 270 };

function loadScale() {
  try {
    const v = Number(localStorage.getItem(SCALE_KEY));
    return v > 1 && v < 40 ? v : null;
  } catch {
    return null;
  }
}

function saveScale(v) {
  try {
    localStorage.setItem(SCALE_KEY, String(v));
  } catch {
    // Private mode: the user simply calibrates again next time.
  }
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children);
  return node;
}

// The risk text comes from body_regions.alert in the config, so no eye wording is hard-coded here.
function riskNotice(text) {
  return text
    ? el('p', { class: 'notice', 'data-status': 'advisory' }, el('strong', {}, 'Why this matters. '), text)
    : null;
}

// Card calibration: drag the slider until the rectangle is as wide as a bank card (85.6 mm).
function calibrate(host, onDone) {
  const maxPx = Math.max(200, Math.min(900, window.innerWidth - 48));
  const start = Math.min(loadScale() ? loadScale() * CARD_MM : 324, maxPx);
  const card = el('div', { class: 'cal-card', role: 'img', 'aria-label': 'On-screen rectangle to match to a bank card' },
    el('span', {}, 'Bank card'));
  const slider = el('input', {
    type: 'range', class: 'cal-slider', min: 100, max: maxPx, step: 1, value: Math.round(start),
    'aria-label': 'Rectangle width. Make it as wide as a bank card.',
  });
  const apply = () => { card.style.width = `${slider.value}px`; };
  slider.addEventListener('input', apply);
  apply();
  host.replaceChildren(
    el('p', {}, 'Step 1: match a bank card. Hold any bank card flat against the screen and drag the slider until the rectangle is exactly as wide as the card (85.6 mm). This lets the letters be drawn at the right size.'),
    card,
    slider,
    el('button', {
      type: 'button', class: 'btn btn--primary',
      onclick: () => {
        const v = pxPerMmFromCard(Number(slider.value));
        saveScale(v);
        onDone(v);
      },
    }, 'The rectangle matches my card'));
  slider.focus();
}

function letterE(heightPx, direction) {
  return svg('svg', {
    class: 'vt-e', width: heightPx, height: heightPx, viewBox: '0 0 5 5', 'aria-hidden': 'true',
    'shape-rendering': 'crispEdges', style: `transform: rotate(${ROTATE[direction]}deg)`,
  },
  svg('rect', { x: 0, y: 0, width: 1, height: 5, fill: 'currentColor' }),
  svg('rect', { x: 0, y: 0, width: 5, height: 1, fill: 'currentColor' }),
  svg('rect', { x: 0, y: 2, width: 5, height: 1, fill: 'currentColor' }),
  svg('rect', { x: 0, y: 4, width: 5, height: 1, fill: 'currentColor' }));
}

// ---- Near acuity (input_type vision) ----

export function visionTest(ind, field, ctx) {
  const host = el('div', { class: 'vt-stage' });
  const msg = el('p', { class: 'hint', 'aria-live': 'polite' });
  const startBtn = el('button', { type: 'button', class: 'btn' }, 'Start near-vision test');
  let onKey = null;

  function stop() {
    if (onKey) document.removeEventListener('keydown', onKey);
    onKey = null;
    host.replaceChildren();
    startBtn.disabled = false;
  }

  function run(pxPerMm) {
    const { lines, floored } = buildLines(pxPerMm, window.devicePixelRatio || 1);
    if (!lines.length) {
      host.replaceChildren();
      msg.textContent = 'This screen cannot draw letters small enough for the test. Type the value instead.';
      startBtn.disabled = false;
      return;
    }
    const results = [];
    let li = 0;
    let shown = [];
    let answered = [];
    const stage = el('div', { class: 'vt-letter' });
    const progress = el('p', { class: 'mg-count' });
    const pad = el('div', { class: 'vt-pad', role: 'group', 'aria-label': 'Which way does the E point?' },
      ['up', 'left', 'right', 'down'].map((d) => el('button', {
        type: 'button', class: 'btn vt-dir', 'data-dir': d, 'aria-label': `E points ${d}`, onclick: () => answer(d),
      }, ARROW[d])));

    function show() {
      const line = lines[li];
      progress.textContent = `Line ${li + 1} of ${lines.length}, letter ${answered.length + 1} of ${LETTERS_PER_LINE}`;
      stage.replaceChildren(letterE(line.heightPx, shown[answered.length]));
    }

    function newLine() {
      shown = randomDirections();
      answered = [];
      show();
    }

    function finish() {
      const result = acuityResult(results);
      stop();
      field.setValue(result, 'game');
      const parts = [];
      if (result === NO_PASS_LOGMAR) {
        parts.push('You could not read the largest line, so 1.1 is recorded, which means worse than 1.0.');
      } else {
        parts.push(`Result: logMAR ${result.toFixed(1)}, about 20/${Math.round(20 * 10 ** result)} at 40 cm.`);
      }
      const last = results.length && results[results.length - 1].passed && li >= lines.length - 1;
      if (floored && last) {
        parts.push('Your screen cannot draw smaller letters, so the result is floored at the screen limit. Your true near vision may be better.');
      }
      parts.push('The field is filled in; you can still change it. This is a screening estimate to track change from your own baseline, not an eye exam.');
      msg.textContent = parts.join(' ');
      startBtn.textContent = 'Run the test again';
    }

    function answer(d) {
      answered.push(d);
      if (answered.length < LETTERS_PER_LINE) {
        show();
        return;
      }
      const passed = linePasses(countCorrect(shown, answered));
      results.push({ logMar: lines[li].logMar, passed });
      if (passed && li < lines.length - 1) {
        li += 1;
        newLine();
      } else {
        finish();
      }
    }

    onKey = (e) => {
      const d = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }[e.key];
      if (!d) return;
      e.preventDefault();
      answer(d);
    };
    document.addEventListener('keydown', onKey);
    host.replaceChildren(
      el('p', {}, `Hold the screen ${NEAR_DISTANCE_MM / 10} cm from your eyes, about the length of your forearm. Keep both eyes open and wear the glasses you use for reading.`),
      el('p', {}, 'Tap the direction the E points: the side where the three bars end. Use the arrow keys if you have a keyboard. If you are unsure, guess.'),
      progress, stage, pad);
    msg.textContent = floored
      ? 'This screen cannot draw the very smallest lines, so the test stops at the screen limit.'
      : '';
    newLine();
    pad.querySelector('button').focus();
  }

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    msg.textContent = '';
    const known = loadScale();
    if (known) run(known);
    else calibrate(host, run);
  });

  ctx.register(stop);
  return el('div', { class: 'test vt' }, riskNotice(ctx.alert),
    el('p', { class: 'hint' }, 'A near-vision check, like the visual acuity test used on the ISS. It is a screening estimate to track change from your own baseline, not an eye exam.'),
    startBtn, host, msg,
    el('button', {
      type: 'button', class: 'btn', onclick: () => { stop(); calibrate(host, () => { host.replaceChildren(); msg.textContent = 'Screen size saved. Start the test.'; }); },
    }, 'Recalibrate screen size'));
}

// ---- Amsler grid (input_type amsler) ----

export function amslerTest(ind, field, ctx) {
  const host = el('div', { class: 'vt-stage' });
  const msg = el('p', { class: 'hint', 'aria-live': 'polite' });
  const startBtn = el('button', { type: 'button', class: 'btn' }, 'Start Amsler grid test');

  function stop() {
    host.replaceChildren();
    startBtn.disabled = false;
  }

  function run(pxPerMm) {
    const eyes = [
      { name: 'right', cover: 'left', marked: new Set() },
      { name: 'left', cover: 'right', marked: new Set() },
    ];
    let current = 0;
    const avail = Math.max(160, Math.min(host.clientWidth || window.innerWidth, window.innerWidth - 32));
    const width = amslerWidthPx(pxPerMm, avail);
    const cell = width / AMSLER_SQUARES;
    const cm = Math.round(amslerDistanceMm((width / pxPerMm)) / 10);
    let cursor = AMSLER_SQUARES * AMSLER_SQUARES / 2 + AMSLER_SQUARES / 2;

    const title = el('h4', { class: 'mg-title' });
    const count = el('p', { class: 'mg-count', 'aria-live': 'polite' });
    const board = svg('svg', {
      class: 'amsler', width, height: width, viewBox: `0 0 ${width} ${width}`, tabindex: 0, role: 'application',
      'aria-label': 'Amsler grid. Arrow keys move, Space marks or unmarks a square.',
    });
    const cursorBox = svg('rect', { class: 'amsler-cursor', width: cell, height: cell, fill: 'none' });
    const marks = svg('g');
    const lineGroup = svg('g', { class: 'amsler-lines' });
    for (let i = 0; i <= AMSLER_SQUARES; i += 1) {
      lineGroup.append(svg('line', { x1: i * cell, y1: 0, x2: i * cell, y2: width }),
        svg('line', { x1: 0, y1: i * cell, x2: width, y2: i * cell }));
    }
    board.append(svg('rect', { class: 'amsler-bg', width, height: width }), marks, lineGroup,
      svg('circle', { class: 'amsler-dot', cx: width / 2, cy: width / 2, r: Math.max(3, cell * 0.3) }), cursorBox);

    function paint() {
      const set = eyes[current].marked;
      marks.replaceChildren(...[...set].map((i) => {
        const x = (i % AMSLER_SQUARES) * cell;
        const y = Math.floor(i / AMSLER_SQUARES) * cell;
        // A cross as well as a fill, so a marked square is not shown by colour alone.
        return svg('g', { class: 'amsler-mark' },
          svg('rect', { x, y, width: cell, height: cell }),
          svg('line', { x1: x, y1: y, x2: x + cell, y2: y + cell }),
          svg('line', { x1: x + cell, y1: y, x2: x, y2: y + cell }));
      }));
      cursorBox.setAttribute('x', (cursor % AMSLER_SQUARES) * cell);
      cursorBox.setAttribute('y', Math.floor(cursor / AMSLER_SQUARES) * cell);
      count.textContent = `Squares marked for this eye: ${set.size}`;
    }

    function flip(i) {
      eyes[current].marked = toggleSquare(eyes[current].marked, i);
      paint();
    }

    board.addEventListener('pointerdown', (e) => {
      const box = board.getBoundingClientRect();
      const col = Math.floor(((e.clientX - box.left) / box.width) * AMSLER_SQUARES);
      const row = Math.floor(((e.clientY - box.top) / box.height) * AMSLER_SQUARES);
      if (col < 0 || row < 0 || col >= AMSLER_SQUARES || row >= AMSLER_SQUARES) return;
      cursor = row * AMSLER_SQUARES + col;
      flip(cursor);
    });
    board.addEventListener('keydown', (e) => {
      const n = AMSLER_SQUARES;
      if (e.key === ' ' || e.key === 'Enter') flip(cursor);
      else if (e.key === 'ArrowLeft' && cursor % n > 0) cursor -= 1;
      else if (e.key === 'ArrowRight' && cursor % n < n - 1) cursor += 1;
      else if (e.key === 'ArrowUp' && cursor >= n) cursor -= n;
      else if (e.key === 'ArrowDown' && cursor < n * (n - 1)) cursor += n;
      else return;
      e.preventDefault();
      paint();
    });

    const next = el('button', { type: 'button', class: 'btn btn--primary' });
    const clear = el('button', {
      type: 'button', class: 'btn',
      onclick: () => { eyes[current].marked = new Set(); paint(); },
    }, 'Clear this eye');
    next.addEventListener('click', () => {
      if (current === 0) {
        current = 1;
        setup();
      } else {
        finish();
      }
    });

    function setup() {
      const e = eyes[current];
      title.textContent = `${e.name[0].toUpperCase()}${e.name.slice(1)} eye (${current + 1} of 2)`;
      next.textContent = current === 0 ? 'Done with this eye, test the other' : 'Finish and use the total';
      paint();
      board.focus({ preventScroll: true });
    }

    function finish() {
      const total = amslerTotal(eyes[0].marked, eyes[1].marked);
      stop();
      field.setValue(total, 'game');
      msg.textContent = total > 0
        ? `${total} squares marked in total. The field is filled in. See the flight surgeon about any distortion, even if it is small or comes and goes.`
        : 'No squares marked. The field is filled in with 0. Report any new wave, blur or gap you notice later. This is a screening check, not an eye exam.';
      startBtn.textContent = 'Run the test again';
    }

    host.replaceChildren(
      el('p', {}, 'Wear the glasses you use for reading. Cover one eye with your palm, not by pressing on it, and keep looking at the centre dot.'),
      el('p', {}, `Hold the screen about ${cm} cm from your eye. Tap each square that looks wavy, blurred, dark or missing. Keyboard: arrow keys move, Space marks.`),
      title,
      el('p', { class: 'estimate-note' }, 'Cover your '),
      board, count, el('div', { class: 'btn-row' }, clear, next));
    // Name which eye to cover, kept as text so it is not only in the heading.
    const coverLine = host.querySelector('.estimate-note');
    const syncCover = () => { coverLine.textContent = `Cover your ${eyes[current].cover} eye now.`; };
    syncCover();
    next.addEventListener('click', syncCover);
    setup();
  }

  startBtn.addEventListener('click', () => {
    startBtn.disabled = true;
    msg.textContent = '';
    const known = loadScale();
    if (known) run(known);
    else calibrate(host, run);
  });

  ctx.register(stop);
  return el('div', { class: 'test vt' }, riskNotice(ctx.alert),
    el('p', { class: 'hint' }, 'The Amsler grid is one of the eye tests available on the ISS. It finds wavy, blurred or missing spots in the centre of your vision. Do one eye at a time.'),
    startBtn, host, msg);
}
