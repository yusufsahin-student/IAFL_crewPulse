import { el } from './shell.js';
import { median, scoreCognitiveTask } from './mind-core.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    node.setAttribute(k, String(v));
  }
  for (const ch of children.flat()) {
    if (ch == null || ch === false) continue;
    node.append(ch instanceof Node ? ch : document.createTextNode(String(ch)));
  }
  return node;
}

const shuffle = (arr) => {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function drawShapeSpec(spec, cx = 40, cy = 40, size = 22) {
  const nodes = [];
  const stroke = spec.accent ? 'var(--accent)' : 'var(--ink)';
  const fill = spec.filled ? stroke : 'none';
  const sw = 2.4;

  if (spec.ring) {
    nodes.push(svgEl('circle', {
      cx, cy, r: size + 7, fill: 'none', stroke, 'stroke-width': 1.6, 'stroke-dasharray': '4 3',
    }));
  }

  const count = spec.count || 1;
  const offsets = count === 2 ? [-size * 0.65, size * 0.65] : count === 3 ? [-size * 0.85, 0, size * 0.85] : [0];
  const r = count > 1 ? size * 0.5 : size;

  for (const dx of offsets) {
    const x = cx + dx;
    const rot = spec.rot ? `rotate(${spec.rot} ${x} ${cy})` : null;
    if (spec.shape === 'circle') {
      nodes.push(svgEl('circle', { cx: x, cy, r, fill, stroke, 'stroke-width': sw }));
    } else if (spec.shape === 'square') {
      nodes.push(svgEl('rect', {
        x: x - r, y: cy - r, width: r * 2, height: r * 2, rx: 3,
        fill, stroke, 'stroke-width': sw, ...(rot ? { transform: rot } : {}),
      }));
    } else if (spec.shape === 'triangle') {
      const h = r * 1.1;
      const pts = `${x},${cy - h} ${x + r},${cy + h * 0.8} ${x - r},${cy + h * 0.8}`;
      nodes.push(svgEl('polygon', {
        points: pts, fill, stroke, 'stroke-width': sw, 'stroke-linejoin': 'round',
        ...(rot ? { transform: rot } : {}),
      }));
    } else if (spec.shape === 'diamond') {
      const pts = `${x},${cy - r * 1.1} ${x + r},${cy} ${x},${cy + r * 1.1} ${x - r},${cy}`;
      nodes.push(svgEl('polygon', {
        points: pts, fill, stroke, 'stroke-width': sw, 'stroke-linejoin': 'round',
        ...(rot ? { transform: rot } : {}),
      }));
    } else if (spec.shape === 'hex') {
      const pts = Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        return `${(x + Math.cos(a) * r).toFixed(1)},${(cy + Math.sin(a) * r).toFixed(1)}`;
      }).join(' ');
      nodes.push(svgEl('polygon', { points: pts, fill, stroke, 'stroke-width': sw }));
    }
  }

  if (spec.dot) {
    nodes.push(svgEl('circle', {
      cx, cy, r: 4, fill: spec.filled ? 'var(--bg)' : stroke,
    }));
  }
  if (spec.cross) {
    nodes.push(
      svgEl('line', { x1: cx - 10, y1: cy, x2: cx + 10, y2: cy, stroke, 'stroke-width': 2 }),
      svgEl('line', { x1: cx, y1: cy - 10, x2: cx, y2: cy + 10, stroke, 'stroke-width': 2 }),
    );
  }
  return nodes;
}

function drawFractalGlyph(index, cx = 60, cy = 60, r = 42) {
  const g = svgEl('g');
  const stroke = 'var(--ink)';
  const accent = 'var(--accent)';
  if (index === 0) {
    g.append(
      svgEl('circle', { cx, cy, r, fill: 'none', stroke, 'stroke-width': 2 }),
      svgEl('circle', { cx, cy, r: r * 0.55, fill: 'none', stroke: accent, 'stroke-width': 2 }),
      ...Array.from({ length: 6 }, (_, i) => {
        const a = (Math.PI / 3) * i;
        return svgEl('line', {
          x1: cx, y1: cy, x2: (cx + Math.cos(a) * r).toFixed(1), y2: (cy + Math.sin(a) * r).toFixed(1),
          stroke, 'stroke-width': 1.6,
        });
      }),
      svgEl('circle', { cx, cy, r: 6, fill: accent }),
    );
  } else if (index === 1) {
    for (let k = 0; k < 3; k++) {
      const s = r * (1 - k * 0.28);
      g.append(svgEl('rect', {
        x: cx - s * 0.72, y: cy - s * 0.72, width: s * 1.44, height: s * 1.44,
        fill: 'none', stroke: k === 1 ? accent : stroke, 'stroke-width': 2,
        transform: `rotate(${k * 30} ${cx} ${cy})`,
      }));
    }
  } else if (index === 2) {
    g.append(svgEl('polygon', {
      points: `${cx},${cy - r} ${cx + r * 0.87},${cy + r * 0.5} ${cx - r * 0.87},${cy + r * 0.5}`,
      fill: 'none', stroke, 'stroke-width': 2,
    }));
    g.append(svgEl('polygon', {
      points: `${cx},${cy + r} ${cx + r * 0.87},${cy - r * 0.5} ${cx - r * 0.87},${cy - r * 0.5}`,
      fill: 'none', stroke: accent, 'stroke-width': 2,
    }));
    g.append(svgEl('circle', { cx, cy, r: r * 0.25, fill: 'none', stroke, 'stroke-width': 2 }));
  } else {
    g.append(svgEl('circle', { cx, cy, r: r * 0.9, fill: 'none', stroke, 'stroke-width': 1.8, 'stroke-dasharray': '6 4' }));
    for (let k = 0; k < 4; k++) {
      const a = (Math.PI / 2) * k;
      g.append(svgEl('circle', {
        cx: (cx + Math.cos(a) * (r * 0.45)).toFixed(1),
        cy: (cy + Math.sin(a) * (r * 0.45)).toFixed(1),
        r: r * 0.34,
        fill: 'none',
        stroke: k % 2 === 0 ? accent : stroke,
        'stroke-width': 2,
      }));
    }
  }
  return g;
}

function drawDigitSymbol(index, cx = 24, cy = 24, r = 14) {
  const g = svgEl('g');
  const s = 'var(--ink)';
  const a = 'var(--accent)';
  switch (index) {
    case 0:
      g.append(
        svgEl('circle', { cx, cy, r, fill: 'none', stroke: s, 'stroke-width': 2.2 }),
        svgEl('line', { x1: cx - r, y1: cy, x2: cx + r, y2: cy, stroke: a, 'stroke-width': 2 }),
        svgEl('line', { x1: cx, y1: cy - r, x2: cx, y2: cy + r, stroke: a, 'stroke-width': 2 }),
      );
      break;
    case 1:
      g.append(
        svgEl('polygon', { points: `${cx},${cy - r} ${cx + r},${cy + r} ${cx - r},${cy + r}`, fill: 'none', stroke: s, 'stroke-width': 2.2 }),
        svgEl('circle', { cx, cy: cy + r * 0.35, r: 3.2, fill: a }),
      );
      break;
    case 2:
      g.append(
        svgEl('rect', { x: cx - r, y: cy - r, width: r * 2, height: r * 2, fill: 'none', stroke: s, 'stroke-width': 2.2 }),
        svgEl('rect', { x: cx - 4, y: cy - 4, width: 8, height: 8, fill: a }),
      );
      break;
    case 3:
      g.append(
        svgEl('polygon', { points: `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`, fill: 'none', stroke: s, 'stroke-width': 2.2 }),
        svgEl('circle', { cx, cy, r: 4, fill: 'none', stroke: a, 'stroke-width': 2 }),
      );
      break;
    case 4:
      g.append(
        svgEl('polygon', { points: `${cx - r},${cy - r} ${cx + r},${cy - r} ${cx - r},${cy + r} ${cx + r},${cy + r}`, fill: 'none', stroke: s, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }),
      );
      break;
    default:
      g.append(
        svgEl('path', {
          d: `M ${cx - r} ${cy + 4} Q ${cx - r / 2} ${cy - r} ${cx} ${cy} T ${cx + r} ${cy - 4}`,
          fill: 'none', stroke: a, 'stroke-width': 2.4,
        }),
        svgEl('line', { x1: cx - r, y1: cy + r * 0.6, x2: cx + r, y2: cy + r * 0.6, stroke: s, 'stroke-width': 2 }),
      );
  }
  return g;
}

function runMotorPraxis(host, onFinish) {
  const total = 8;
  const radii = [34, 31, 28, 25, 22, 19, 16, 13];
  let idx = 0;
  let hits = 0;
  const rts = [];
  let shownAt = 0;
  let missTimer = null;
  let closed = false;

  const progress = el('div', { class: 'task-hud__status' });
  const stage = svgEl('svg', {
    class: 'task-arena', viewBox: '0 0 420 240', role: 'img', 'aria-label': 'Motor target arena',
  });
  host.replaceChildren(
    el('div', { class: 'task-hud' }, progress),
    stage,
  );

  const nextTrial = () => {
    if (closed) return;
    clearTimeout(missTimer);
    if (idx >= total) {
      closed = true;
      onFinish(scoreCognitiveTask('motor_praxis', {
        total, hits, medianMs: rts.length ? median(rts) : 2500,
      }));
      return;
    }
    const half = radii[idx];
    const pad = half + 14;
    const cx = Math.round(pad + Math.random() * (420 - pad * 2));
    const cy = Math.round(pad + Math.random() * (240 - pad * 2));
    progress.replaceChildren(el('span', {}, `Target ${idx + 1} / ${total}`));

    const bg = svgEl('rect', { x: 0, y: 0, width: 420, height: 240, fill: 'transparent' });
    const outer = svgEl('rect', {
      x: cx - half, y: cy - half, width: half * 2, height: half * 2, rx: 4,
      fill: 'var(--accent)', 'fill-opacity': '0.25', stroke: 'var(--accent)', 'stroke-width': 2.5,
      class: 'task-target',
    });
    const innerHalf = Math.max(4, Math.round(half * 0.34));
    const core = svgEl('rect', {
      x: cx - innerHalf, y: cy - innerHalf, width: innerHalf * 2, height: innerHalf * 2, rx: 2,
      fill: 'var(--accent)', class: 'task-target',
    });
    const group = svgEl('g', { style: 'cursor:pointer' }, outer, core);

    const recordHit = (e) => {
      e.stopPropagation();
      if (closed) return;
      clearTimeout(missTimer);
      rts.push(Math.round(performance.now() - shownAt));
      hits++;
      idx++;
      nextTrial();
    };
    group.addEventListener('pointerdown', recordHit, { once: true });
    bg.addEventListener('pointerdown', () => {
      if (closed) return;
      clearTimeout(missTimer);
      idx++;
      nextTrial();
    }, { once: true });

    stage.replaceChildren(bg, group);
    shownAt = performance.now();
    missTimer = setTimeout(() => {
      idx++;
      nextTrial();
    }, 3000);
  };

  nextTrial();
  return {
    cleanup() {
      closed = true;
      clearTimeout(missTimer);
    },
  };
}

function runVisualMemory(host, onFinish) {
  const pool = [
    { shape: 'circle', filled: false, dot: true, ring: true },
    { shape: 'square', filled: true, cross: false, rot: 45 },
    { shape: 'triangle', filled: false, cross: true },
    { shape: 'diamond', filled: true, ring: true },
    { shape: 'hex', filled: false, dot: true },
    { shape: 'circle', filled: true, count: 2 },
    { shape: 'square', filled: false, ring: true, dot: true },
    { shape: 'triangle', filled: true, rot: 180 },
  ];
  const studySet = pool.slice(0, 4);
  const testItems = shuffle([
    ...studySet.map((s) => ({ spec: s, isTarget: true })),
    ...pool.slice(4).map((s) => ({ spec: s, isTarget: false })),
  ]);

  let step = 0;
  let correct = 0;
  const rts = [];
  let shownAt = 0;
  let studyTimer = null;
  let closed = false;
  let keyHandler = null;

  const renderTest = () => {
    if (closed) return;
    if (step >= testItems.length) {
      closed = true;
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
      onFinish(scoreCognitiveTask('visual_memory', {
        total: testItems.length, correct, meanMs: mean(rts),
      }));
      return;
    }
    const item = testItems[step];
    const svg = svgEl('svg', { class: 'task-specimen', viewBox: '0 0 80 80', role: 'img', 'aria-label': 'Test shape' },
      ...drawShapeSpec(item.spec, 40, 40, 20));
    const answer = (saidYes) => {
      if (closed) return;
      rts.push(Math.round(performance.now() - shownAt));
      if (saidYes === item.isTarget) correct++;
      step++;
      renderTest();
    };
    host.replaceChildren(
      el('div', { class: 'task-hud' }, el('span', {}, `Shape ${step + 1} / ${testItems.length}`)),
      el('div', { class: 'task-stage-center' }, svg),
      el('div', { class: 'lab-actions' },
        el('button', { class: 'btn btn--primary', onclick: () => answer(true) }, 'Yes (Seen)'),
        el('button', { class: 'btn', onclick: () => answer(false) }, 'No (New)'),
      ),
    );
    shownAt = performance.now();
  };

  keyHandler = (e) => {
    if (closed) return;
    if (step < testItems.length && host.querySelector('.lab-actions')) {
      const btns = host.querySelectorAll('.lab-actions button');
      if (btns.length === 2 && (e.code === 'KeyY' || e.code === 'ArrowLeft')) {
        e.preventDefault();
        btns[0].click();
      } else if (btns.length === 2 && (e.code === 'KeyN' || e.code === 'ArrowRight')) {
        e.preventDefault();
        btns[1].click();
      }
    }
  };
  window.addEventListener('keydown', keyHandler);

  let secLeft = 5;
  const countdown = el('span', {}, `Memorise in ${secLeft} s`);
  const grid = el('div', { class: 'task-study-grid' }, studySet.map((spec) =>
    svgEl('svg', { class: 'task-specimen-sm', viewBox: '0 0 80 80', role: 'img', 'aria-label': 'Study shape' },
      ...drawShapeSpec(spec, 40, 40, 20)),
  ));
  host.replaceChildren(
    el('div', { class: 'task-hud' }, countdown),
    grid,
    el('div', { class: 'lab-actions' }, el('button', {
      class: 'btn',
      onclick: () => {
        clearInterval(studyTimer);
        renderTest();
      },
    }, 'Start recall →')),
  );
  studyTimer = setInterval(() => {
    secLeft--;
    if (secLeft <= 0) {
      clearInterval(studyTimer);
      renderTest();
    } else {
      countdown.textContent = `Memorise in ${secLeft} s`;
    }
  }, 1000);

  return {
    cleanup() {
      closed = true;
      clearInterval(studyTimer);
      if (keyHandler) window.removeEventListener('keydown', keyHandler);
    },
  };
}

function runFractal2Back(host, onFinish) {
  const sequence = [0, 1, 0, 2, 0, 3, 0, 3, 1, 3];
  let idx = 0;
  let correct = 0;
  const rts = [];
  let shownAt = 0;
  let closed = false;

  const render = () => {
    if (closed) return;
    if (idx >= sequence.length) {
      closed = true;
      window.removeEventListener('keydown', onKey);
      onFinish(scoreCognitiveTask('fractal_2back', {
        total: sequence.length - 2, correct, meanMs: mean(rts),
      }));
      return;
    }
    const val = sequence[idx];
    const glyph = svgEl('svg', { class: 'task-specimen', viewBox: '0 0 120 120', role: 'img', 'aria-label': 'Fractal pattern' },
      drawFractalGlyph(val, 60, 60, 44));
    const scorable = idx >= 2;

    const submit = (saidMatch) => {
      if (closed) return;
      if (scorable) {
        rts.push(Math.round(performance.now() - shownAt));
        const actualMatch = sequence[idx] === sequence[idx - 2];
        if (saidMatch === actualMatch) correct++;
      }
      idx++;
      render();
    };

    host.replaceChildren(
      el('div', { class: 'task-hud' },
        el('span', {}, `Step ${idx + 1} / ${sequence.length}`),
        el('span', { class: 'task-note' }, scorable ? 'Matches 2 steps earlier?' : 'Remember this pattern'),
      ),
      el('div', { class: 'task-stage-center' }, glyph),
      scorable
        ? el('div', { class: 'lab-actions' },
            el('button', { class: 'btn btn--primary', onclick: () => submit(true) }, 'Match (2-back)'),
            el('button', { class: 'btn', onclick: () => submit(false) }, 'Skip (No match)'),
          )
        : el('div', { class: 'lab-actions' },
            el('button', { class: 'btn btn--primary', onclick: () => submit(false) }, 'Next pattern →'),
          ),
    );
    shownAt = performance.now();
  };

  const onKey = (e) => {
    if (closed) return;
    const btns = host.querySelectorAll('.lab-actions button');
    if (btns.length === 1 && (e.code === 'Space' || e.code === 'Enter')) {
      e.preventDefault();
      btns[0].click();
    } else if (btns.length === 2 && (e.code === 'KeyM' || e.code === 'ArrowLeft')) {
      e.preventDefault();
      btns[0].click();
    } else if (btns.length === 2 && (e.code === 'KeyN' || e.code === 'ArrowRight')) {
      e.preventDefault();
      btns[1].click();
    }
  };
  window.addEventListener('keydown', onKey);
  render();
  return {
    cleanup() {
      closed = true;
      window.removeEventListener('keydown', onKey);
    },
  };
}

function runAbstractMatching(host, onFinish) {
  const trials = [
    {
      a: [{ shape: 'circle', filled: false }, { shape: 'circle', filled: true, count: 2 }],
      b: [{ shape: 'square', filled: false }, { shape: 'square', filled: true, count: 2 }],
      candidate: { shape: 'circle', filled: true, ring: true },
      answer: 'A',
    },
    {
      a: [{ shape: 'triangle', filled: true }, { shape: 'square', filled: true }],
      b: [{ shape: 'triangle', filled: false }, { shape: 'square', filled: false }],
      candidate: { shape: 'diamond', filled: false, count: 2 },
      answer: 'B',
    },
    {
      a: [{ shape: 'circle', count: 2, filled: false }, { shape: 'diamond', count: 2, filled: true }],
      b: [{ shape: 'circle', count: 1, filled: false }, { shape: 'diamond', count: 1, filled: true }],
      candidate: { shape: 'square', count: 2, filled: false },
      answer: 'A',
    },
    {
      a: [{ shape: 'hex', filled: false, ring: true }, { shape: 'square', filled: true, ring: true }],
      b: [{ shape: 'hex', filled: false, ring: false }, { shape: 'square', filled: true, ring: false }],
      candidate: { shape: 'triangle', filled: false, ring: false },
      answer: 'B',
    },
    {
      a: [{ shape: 'circle', accent: true, filled: true }, { shape: 'triangle', accent: true, filled: false }],
      b: [{ shape: 'circle', accent: false, filled: true }, { shape: 'triangle', accent: false, filled: false }],
      candidate: { shape: 'square', accent: true, filled: true },
      answer: 'A',
    },
    {
      a: [{ shape: 'square', rot: 0, filled: false }, { shape: 'triangle', rot: 0, filled: true }],
      b: [{ shape: 'square', rot: 45, filled: false }, { shape: 'triangle', rot: 180, filled: true }],
      candidate: { shape: 'square', rot: 45, filled: true },
      answer: 'B',
    },
  ];

  let idx = 0;
  let correct = 0;
  const rts = [];
  let shownAt = 0;
  let closed = false;

  const miniCard = (specs) => el('div', { class: 'task-pair' }, specs.map((sp) =>
    svgEl('svg', { class: 'task-specimen-sm', viewBox: '0 0 80 80' }, ...drawShapeSpec(sp, 40, 40, 17)),
  ));

  const render = () => {
    if (closed) return;
    if (idx >= trials.length) {
      closed = true;
      window.removeEventListener('keydown', onKey);
      onFinish(scoreCognitiveTask('abstract_matching', {
        total: trials.length, correct, meanMs: mean(rts),
      }));
      return;
    }
    const t = trials[idx];
    const choose = (grp) => {
      if (closed) return;
      rts.push(Math.round(performance.now() - shownAt));
      if (grp === t.answer) correct++;
      idx++;
      render();
    };
    host.replaceChildren(
      el('div', { class: 'task-hud' }, el('span', {}, `Rule ${idx + 1} / ${trials.length}`)),
      el('div', { class: 'task-groups' },
        el('div', { class: 'task-group-box' }, el('div', { class: 'task-group-title' }, 'Group A'), miniCard(t.a)),
        el('div', { class: 'task-group-box' }, el('div', { class: 'task-group-title' }, 'Group B'), miniCard(t.b)),
      ),
      el('div', { class: 'task-stage-center' },
        el('div', { class: 'task-group-title' }, 'Candidate'),
        svgEl('svg', { class: 'task-specimen-sm', viewBox: '0 0 80 80' }, ...drawShapeSpec(t.candidate, 40, 40, 18)),
      ),
      el('div', { class: 'lab-actions' },
        el('button', { class: 'btn btn--primary', onclick: () => choose('A') }, 'Assign to Group A'),
        el('button', { class: 'btn', onclick: () => choose('B') }, 'Assign to Group B'),
      ),
    );
    shownAt = performance.now();
  };

  const onKey = (e) => {
    if (closed) return;
    const btns = host.querySelectorAll('.lab-actions button');
    if (btns.length === 2 && (e.code === 'KeyA' || e.code === 'ArrowLeft')) {
      e.preventDefault();
      btns[0].click();
    } else if (btns.length === 2 && (e.code === 'KeyB' || e.code === 'ArrowRight')) {
      e.preventDefault();
      btns[1].click();
    }
  };
  window.addEventListener('keydown', onKey);
  render();
  return {
    cleanup() {
      closed = true;
      window.removeEventListener('keydown', onKey);
    },
  };
}

function runLineOrientation(host, onFinish) {
  const targets = [24, 118, 66, 152, 42];
  const startOffsets = [38, -44, 34, -36, 48];
  let idx = 0;
  const errs = [];
  const rts = [];
  let shownAt = 0;
  let curAngle = 0;
  let closed = false;

  const lineCoords = (cx, cy, r, deg) => {
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad) * r;
    const dy = Math.sin(rad) * r;
    return { x1: (cx - dx).toFixed(1), y1: (cy - dy).toFixed(1), x2: (cx + dx).toFixed(1), y2: (cy + dy).toFixed(1) };
  };

  const angularErr = (a, b) => Math.abs((((a - b + 90) % 180) + 180) % 180 - 90);

  const render = () => {
    if (closed) return;
    if (idx >= targets.length) {
      closed = true;
      window.removeEventListener('keydown', onKey);
      onFinish(scoreCognitiveTask('line_orientation', {
        trials: targets.length, meanErrDeg: mean(errs), meanMs: mean(rts),
      }));
      return;
    }
    const targetDeg = targets[idx];
    curAngle = (targetDeg + startOffsets[idx] + 180) % 180;

    const refC = lineCoords(105, 100, 66, targetDeg);
    const tgtLine = svgEl('line', { stroke: 'var(--accent)', 'stroke-width': 4, 'stroke-linecap': 'round' });
    const updateLine = () => {
      const c = lineCoords(315, 100, 66, curAngle);
      tgtLine.setAttribute('x1', c.x1);
      tgtLine.setAttribute('y1', c.y1);
      tgtLine.setAttribute('x2', c.x2);
      tgtLine.setAttribute('y2', c.y2);
    };
    updateLine();

    const dialBg = svgEl('circle', {
      cx: 315, cy: 100, r: 78, fill: 'var(--surface-2)', stroke: 'var(--line)', 'stroke-width': 1.5,
      style: 'cursor:grab',
    });
    const svg = svgEl('svg', { class: 'task-arena', viewBox: '0 0 420 200', role: 'img', 'aria-label': 'Line orientation dials' },
      svgEl('circle', { cx: 105, cy: 100, r: 78, fill: 'var(--surface-2)', stroke: 'var(--line)', 'stroke-width': 1.5 }),
      svgEl('line', { ...refC, stroke: 'var(--ink)', 'stroke-width': 4, 'stroke-linecap': 'round' }),
      svgEl('circle', { cx: 105, cy: 100, r: 4, fill: 'var(--ink)' }),
      svgEl('text', { x: 105, y: 192, 'text-anchor': 'middle', fill: 'var(--ink-muted)', 'font-size': 12 }, 'Reference'),
      dialBg,
      tgtLine,
      svgEl('circle', { cx: 315, cy: 100, r: 4, fill: 'var(--accent)' }),
      svgEl('text', { x: 315, y: 192, 'text-anchor': 'middle', fill: 'var(--ink-muted)', 'font-size': 12 }, 'Target (drag or nudge)'),
    );

    let dragging = false;
    const setFromPointer = (e) => {
      const rect = svg.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * 420;
      const py = ((e.clientY - rect.top) / rect.height) * 200;
      const deg = (Math.atan2(py - 100, px - 315) * 180) / Math.PI;
      curAngle = ((deg % 180) + 180) % 180;
      updateLine();
    };
    dialBg.addEventListener('pointerdown', (e) => { dragging = true; setFromPointer(e); });
    svg.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
    svg.addEventListener('pointerup', () => { dragging = false; });

    const nudge = (delta) => {
      curAngle = ((curAngle + delta) % 180 + 180) % 180;
      updateLine();
    };
    const lock = () => {
      if (closed) return;
      rts.push(Math.round(performance.now() - shownAt));
      errs.push(angularErr(curAngle, targetDeg));
      idx++;
      render();
    };

    host.replaceChildren(
      el('div', { class: 'task-hud' }, el('span', {}, `Angle ${idx + 1} / ${targets.length}`)),
      svg,
      el('div', { class: 'lab-actions' },
        el('button', { class: 'btn', onclick: () => nudge(-12) }, '-12°'),
        el('button', { class: 'btn', onclick: () => nudge(-3) }, '-3°'),
        el('button', { class: 'btn', onclick: () => nudge(3) }, '+3°'),
        el('button', { class: 'btn', onclick: () => nudge(12) }, '+12°'),
        el('button', { class: 'btn btn--primary', onclick: lock }, 'Lock angle →'),
      ),
    );
    shownAt = performance.now();
  };

  const onKey = (e) => {
    if (closed) return;
    const btns = host.querySelectorAll('.lab-actions .btn');
    if (e.code === 'ArrowLeft' && btns.length >= 4) { e.preventDefault(); btns[e.shiftKey ? 0 : 1].click(); }
    if (e.code === 'ArrowRight' && btns.length >= 4) { e.preventDefault(); btns[e.shiftKey ? 3 : 2].click(); }
    if (e.code === 'Enter') { e.preventDefault(); host.querySelector('.btn--primary')?.click(); }
  };
  window.addEventListener('keydown', onKey);
  render();
  return {
    cleanup() {
      closed = true;
      window.removeEventListener('keydown', onKey);
    },
  };
}

function runMatrixReasoning(host, onFinish) {
  const shapes = ['circle', 'square', 'triangle'];
  const puzzles = [
    {
      grid: [
        { shape: 'circle', count: 1, filled: false }, { shape: 'square', count: 1, filled: false }, { shape: 'triangle', count: 1, filled: false },
        { shape: 'circle', count: 2, filled: false }, { shape: 'square', count: 2, filled: false }, { shape: 'triangle', count: 2, filled: false },
        { shape: 'circle', count: 3, filled: false }, { shape: 'square', count: 3, filled: false }, null,
      ],
      options: [
        { shape: 'triangle', count: 3, filled: false },
        { shape: 'triangle', count: 2, filled: true },
        { shape: 'square', count: 3, filled: false },
        { shape: 'circle', count: 3, filled: true },
      ],
      answerIdx: 0,
    },
    {
      grid: [
        { shape: 'diamond', filled: false, ring: false }, { shape: 'diamond', filled: true, ring: false }, { shape: 'diamond', filled: true, ring: true },
        { shape: 'square', filled: false, ring: false }, { shape: 'square', filled: true, ring: false }, { shape: 'square', filled: true, ring: true },
        { shape: 'circle', filled: false, ring: false }, { shape: 'circle', filled: true, ring: false }, null,
      ],
      options: [
        { shape: 'circle', filled: false, ring: true },
        { shape: 'circle', filled: true, ring: true },
        { shape: 'square', filled: true, ring: true },
        { shape: 'circle', filled: true, dot: true },
      ],
      answerIdx: 1,
    },
    {
      grid: [
        { shape: 'circle', accent: false, count: 1 }, { shape: 'circle', accent: true, count: 2 }, { shape: 'circle', accent: false, count: 3 },
        { shape: 'square', accent: true, count: 1 }, { shape: 'square', accent: false, count: 2 }, { shape: 'square', accent: true, count: 3 },
        { shape: 'triangle', accent: false, count: 1 }, { shape: 'triangle', accent: true, count: 2 }, null,
      ],
      options: [
        { shape: 'triangle', accent: true, count: 3 },
        { shape: 'triangle', accent: false, count: 2 },
        { shape: 'triangle', accent: false, count: 3 },
        { shape: 'circle', accent: false, count: 3 },
      ],
      answerIdx: 2,
    },
    {
      grid: [
        { shape: shapes[0], cross: false, rot: 0, filled: true }, { shape: shapes[1], cross: true, rot: 0, filled: false }, { shape: shapes[2], cross: false, rot: 180, filled: true },
        { shape: shapes[1], cross: false, rot: 0, filled: true }, { shape: shapes[2], cross: true, rot: 0, filled: false }, { shape: shapes[0], cross: false, rot: 180, filled: true },
        { shape: shapes[2], cross: false, rot: 0, filled: true }, { shape: shapes[0], cross: true, rot: 0, filled: false }, null,
      ],
      options: [
        { shape: shapes[1], cross: true, rot: 180, filled: true },
        { shape: shapes[0], cross: false, rot: 180, filled: true },
        { shape: shapes[1], cross: false, rot: 0, filled: false },
        { shape: shapes[1], cross: false, rot: 180, filled: true },
      ],
      answerIdx: 3,
    },
  ];

  let idx = 0;
  let correct = 0;
  const rts = [];
  let shownAt = 0;
  let closed = false;

  const render = () => {
    if (closed) return;
    if (idx >= puzzles.length) {
      closed = true;
      window.removeEventListener('keydown', onKey);
      onFinish(scoreCognitiveTask('matrix_reasoning', {
        total: puzzles.length, correct, meanMs: mean(rts),
      }));
      return;
    }
    const p = puzzles[idx];
    const grid = el('div', { class: 'task-matrix' }, p.grid.map((cell) => {
      if (!cell) return el('div', { class: 'task-matrix__cell task-matrix__cell--missing' }, '?');
      return el('div', { class: 'task-matrix__cell' },
        svgEl('svg', { viewBox: '0 0 80 80' }, ...drawShapeSpec(cell, 40, 40, 14)),
      );
    }));

    const pick = (i) => {
      if (closed) return;
      rts.push(Math.round(performance.now() - shownAt));
      if (i === p.answerIdx) correct++;
      idx++;
      render();
    };

    const opts = el('div', { class: 'task-matrix-opts' }, p.options.map((opt, i) =>
      el('button', { class: 'task-matrix-opt', onclick: () => pick(i), 'aria-label': `Option ${i + 1}` },
        svgEl('svg', { viewBox: '0 0 80 80' }, ...drawShapeSpec(opt, 40, 40, 15)),
      ),
    ));

    host.replaceChildren(
      el('div', { class: 'task-hud' }, el('span', {}, `Matrix ${idx + 1} / ${puzzles.length}`)),
      grid,
      opts,
    );
    shownAt = performance.now();
  };

  const onKey = (e) => {
    if (closed) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 4) {
      host.querySelectorAll('.task-matrix-opt')[n - 1]?.click();
    }
  };
  window.addEventListener('keydown', onKey);
  render();
  return {
    cleanup() {
      closed = true;
      window.removeEventListener('keydown', onKey);
    },
  };
}

function runDigitSymbol(host, onFinish) {
  const durationSec = 25;
  let secLeft = durationSec;
  let total = 0;
  let correct = 0;
  let currentSym = Math.floor(Math.random() * 6);
  let closed = false;

  const timerEl = el('span', {}, `${secLeft} s left`);
  const scoreEl = el('span', {}, '0 completed');
  const promptSvg = svgEl('svg', { class: 'task-specimen', viewBox: '0 0 80 80', role: 'img', 'aria-label': 'Prompt symbol' });

  const renderPrompt = () => {
    promptSvg.replaceChildren(drawDigitSymbol(currentSym, 40, 40, 22));
  };
  renderPrompt();

  const keyBar = el('div', { class: 'dsst-key' }, Array.from({ length: 6 }, (_, i) =>
    el('div', { class: 'dsst-key__cell' },
      svgEl('svg', { viewBox: '0 0 48 48' }, drawDigitSymbol(i, 24, 24, 14)),
      el('span', { class: 'dsst-key__digit' }, String(i + 1)),
    ),
  ));

  const submit = (digitIdx) => {
    if (closed) return;
    total++;
    if (digitIdx === currentSym) correct++;
    scoreEl.textContent = `${total} completed`;
    let next = Math.floor(Math.random() * 6);
    if (next === currentSym) next = (next + 1) % 6;
    currentSym = next;
    renderPrompt();
  };

  const pad = el('div', { class: 'dsst-pad' }, Array.from({ length: 6 }, (_, i) =>
    el('button', { class: 'btn dsst-pad__btn', onclick: () => submit(i) }, String(i + 1)),
  ));

  const onKey = (e) => {
    if (closed) return;
    const n = Number(e.key);
    if (n >= 1 && n <= 6) submit(n - 1);
  };
  window.addEventListener('keydown', onKey);

  host.replaceChildren(
    el('div', { class: 'task-hud' }, timerEl, scoreEl),
    keyBar,
    el('div', { class: 'task-stage-center' }, promptSvg),
    pad,
  );

  const timer = setInterval(() => {
    secLeft--;
    if (secLeft <= 0) {
      clearInterval(timer);
      closed = true;
      window.removeEventListener('keydown', onKey);
      onFinish(scoreCognitiveTask('digit_symbol', { total, correct }));
    } else {
      timerEl.textContent = `${secLeft} s left`;
    }
  }, 1000);

  return {
    cleanup() {
      closed = true;
      clearInterval(timer);
      window.removeEventListener('keydown', onKey);
    },
  };
}

function runBart(host, onFinish) {
  const total = 5;
  const limits = Array.from({ length: total }, () => 4 + Math.floor(Math.random() * 6));
  let idx = 0;
  let pumps = 0;
  let banked = 0;
  let bursts = 0;
  let burstState = false;
  let closed = false;
  let advTimer = null;

  const render = () => {
    if (closed) return;
    if (idx >= total) {
      closed = true;
      window.removeEventListener('keydown', onKey);
      onFinish(scoreCognitiveTask('bart', { total, banked, bursts }));
      return;
    }
    const r = Math.min(72, 26 + pumps * 5.5);
    const balloonColor = burstState ? 'var(--alert)' : pumps >= 6 ? 'var(--watch)' : 'var(--accent)';
    const svg = svgEl('svg', { class: 'task-arena', viewBox: '0 0 320 200', role: 'img', 'aria-label': 'Balloon arena' },
      burstState
        ? svgEl('text', { x: 160, y: 108, 'text-anchor': 'middle', fill: 'var(--alert)', 'font-size': 22, 'font-weight': 700 }, 'BURST!')
        : svgEl('g', {},
            svgEl('circle', { cx: 160, cy: 92, r, fill: balloonColor, 'fill-opacity': '0.28', stroke: balloonColor, 'stroke-width': 3 }),
            svgEl('line', { x1: 160, y1: 92 + r, x2: 160, y2: 186, stroke: 'var(--line-strong)', 'stroke-width': 2 }),
          ),
    );

    const inflate = () => {
      if (closed || burstState) return;
      pumps++;
      if (pumps > limits[idx]) {
        burstState = true;
        bursts++;
        render();
        advTimer = setTimeout(() => {
          burstState = false;
          pumps = 0;
          idx++;
          render();
        }, 700);
      } else {
        render();
      }
    };

    const collect = () => {
      if (closed || burstState) return;
      banked += pumps * 25;
      pumps = 0;
      idx++;
      render();
    };

    host.replaceChildren(
      el('div', { class: 'task-hud' },
        el('span', {}, `Balloon ${idx + 1} / ${total}`),
        el('span', {}, `Temp: ${pumps * 25} pts`),
        el('span', {}, `Banked: ${banked} pts`),
      ),
      svg,
      el('div', { class: 'lab-actions' },
        el('button', { class: 'btn btn--primary', disabled: burstState, onclick: inflate }, 'Inflate (+25 pts)'),
        el('button', { class: 'btn', disabled: burstState || pumps === 0, onclick: collect }, 'Collect points'),
      ),
    );
  };

  const onKey = (e) => {
    if (closed || burstState) return;
    if (e.code === 'ArrowUp' || e.code === 'Space') { e.preventDefault(); host.querySelector('.lab-actions .btn--primary')?.click(); }
    if (e.code === 'ArrowDown' || e.code === 'Enter') { e.preventDefault(); host.querySelectorAll('.lab-actions button')[1]?.click(); }
  };
  window.addEventListener('keydown', onKey);
  render();
  return {
    cleanup() {
      closed = true;
      clearTimeout(advTimer);
      window.removeEventListener('keydown', onKey);
    },
  };
}

export const TASK_RUNNERS = {
  motor_praxis: runMotorPraxis,
  visual_memory: runVisualMemory,
  fractal_2back: runFractal2Back,
  abstract_matching: runAbstractMatching,
  line_orientation: runLineOrientation,
  matrix_reasoning: runMatrixReasoning,
  digit_symbol: runDigitSymbol,
  bart: runBart,
};

export function runCognitiveTask(taskId, host, onFinish) {
  const runner = TASK_RUNNERS[taskId];
  if (!runner) return { cleanup() {} };
  return runner(host, onFinish);
}
