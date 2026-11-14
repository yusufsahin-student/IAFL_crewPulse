// Step-by-step measurement guide. Steps come from indicator.how_to_measure (one step per line);
// the drawing is img/measure/<id>.svg, whose groups <g data-step="n"> match those steps.
import { el } from './shell.js';

const DRAWN = ['heart_rate', 'systolic_bp', 'diastolic_bp', 'spo2', 'body_temp', 'blood_glucose',
  'sleep_hours', 'mood', 'reaction_ms', 'exercise_minutes', 'body_mass', 'back_pain'];
const PULSE_SECONDS = 15;

export function hasDiagram(indicatorId) {
  return DRAWN.includes(indicatorId);
}

function stepsOf(indicator) {
  return String(indicator.how_to_measure || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// Drawings are ours, but scripts, event handlers and outside links are removed anyway.
function cleanSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
  for (const bad of root.querySelectorAll('script, foreignObject')) bad.remove();
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      const name = attr.name.toLowerCase();
      const outside = (name === 'href' || name === 'xlink:href') && !attr.value.startsWith('#');
      if (name.startsWith('on') || outside) node.removeAttribute(attr.name);
    }
  }
  return document.importNode(root, true);
}

async function loadDrawing(id) {
  try {
    const res = await fetch(new URL(`../img/measure/${id}.svg`, import.meta.url));
    if (!res.ok) return null;
    return cleanSvg(await res.text());
  } catch {
    return null; // no drawing: the steps still work
  }
}

// Open-source pictures (Health Icons, CC0) chosen per indicator in img/measure/pictures.json.
// Swap or add pictures by editing that file; an indicator without an entry keeps its own drawing.
let picturesPromise = null;
function loadPictureList() {
  if (!picturesPromise) {
    const url = new URL('../img/measure/pictures.json', import.meta.url);
    picturesPromise = fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      .then((data) => (data ? { ...data, base: url } : null));
  }
  return picturesPromise;
}

async function loadPictures(indicator) {
  const list = await loadPictureList();
  const entries = list && list.indicators && list.indicators[indicator.id];
  if (!entries || !entries.length) return null;
  const labels = Array.isArray(indicator.scale_labels) ? indicator.scale_labels : null;
  const items = await Promise.all(entries.map(async (p) => {
    try {
      const res = await fetch(new URL(p.file, list.base));
      if (!res.ok) return null;
      const svg = cleanSvg(await res.text());
      if (!svg) return null;
      // For scale indicators a caption "3" is shown as "3 · Okay" using the indicator's own labels.
      const n = Number(p.caption);
      const caption = labels && Number.isInteger(n) && labels[n - 1] ? `${n} · ${labels[n - 1]}` : p.caption;
      svg.setAttribute('class', 'mg-icon');
      svg.setAttribute('aria-hidden', 'true');
      return el('figure', { class: 'mg-pic' }, svg, el('figcaption', {}, caption));
    } catch {
      return null;
    }
  }));
  const pics = items.filter(Boolean);
  if (!pics.length) return null;
  const credit = list.credit || {};
  return el('div', { class: 'mg-pictures' },
    el('div', { class: 'mg-pic-row', role: 'img', 'aria-label': pics.map((f) => f.textContent).join(', ') }, pics),
    credit.text ? el('p', { class: 'estimate-note mg-credit' },
      credit.url ? el('a', { href: credit.url, target: '_blank', rel: 'noopener noreferrer' }, credit.text) : credit.text) : null);
}

export function measureGuide(indicator, options = {}) {
  const steps = stepsOf(indicator);
  const titleId = `mg-${indicator.id}-title`;
  const headingTag = `h${options.headingLevel === 2 || options.headingLevel === 4 ? options.headingLevel : 3}`;
  const section = el('section', { class: 'measure-guide', 'aria-labelledby': titleId },
    el(headingTag, { id: titleId, class: 'mg-title' }, `How to measure: ${indicator.name}`));
  if (!steps.length) {
    section.append(el('p', { class: 'state' }, 'No steps are listed for this measurement yet.'));
    return section;
  }

  let current = 1;
  let groups = [];
  const figure = el('div', { class: 'mg-figure' }, el('p', { class: 'state' }, 'Loading drawing…'));
  const count = el('p', { class: 'mg-count' });
  const live = el('p', { class: 'visually-hidden', role: 'status' });
  const items = steps.map((text, i) => el('li', { 'data-state': 'todo' },
    el('button', { type: 'button', class: 'mg-step', 'data-n': String(i + 1), onclick: () => choose(i + 1, true) },
      el('span', { class: 'mg-num', 'aria-hidden': 'true' }, String(i + 1)),
      el('span', { class: 'mg-text' }, text),
      el('span', { class: 'mg-now' }, 'Current step'))));
  const list = el('ol', { class: 'mg-steps' }, items);
  const prev = el('button', { type: 'button', class: 'btn', onclick: () => choose(current - 1, true) }, 'Previous step');
  const next = el('button', { type: 'button', class: 'btn btn--primary', onclick: () => choose(current + 1, true) }, 'Next step');

  // Disabled-looking at the ends, not disabled, so keyboard focus is not lost.
  function render() {
    items.forEach((li, i) => {
      const n = i + 1;
      const btn = li.querySelector('button');
      li.dataset.state = n < current ? 'done' : n === current ? 'current' : 'todo';
      if (n === current) btn.setAttribute('aria-current', 'step');
      else btn.removeAttribute('aria-current');
    });
    count.textContent = `Step ${current} of ${steps.length}`;
    prev.setAttribute('aria-disabled', String(current <= 1));
    next.setAttribute('aria-disabled', String(current >= steps.length));
    for (const g of groups) g.classList.toggle('is-active', Number(g.dataset.step) === current);
  }

  function choose(n, announce) {
    current = Math.min(Math.max(n, 1), steps.length);
    render();
    if (announce) live.textContent = `Step ${current} of ${steps.length}: ${steps[current - 1]}`;
  }

  function wireDrawing(svg) {
    groups = [...svg.querySelectorAll('g[data-step]')];
    for (const g of groups) {
      const n = Number(g.dataset.step);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', `Step ${n}`);
      g.addEventListener('click', () => choose(n, true));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(n, true); }
      });
    }
    render();
  }

  loadPictures(indicator).then((pictures) => {
    if (pictures) { figure.replaceChildren(pictures); return null; }
    return loadDrawing(indicator.id);
  }).then((svg) => {
    if (svg === null) return; // pictures shown, or nothing to show
    if (!svg) { figure.replaceChildren(); return; }
    const title = svg.querySelector('title');
    svg.setAttribute('class', 'mg-diagram');
    svg.setAttribute('role', 'group');
    if (title) svg.setAttribute('aria-label', title.textContent);
    figure.replaceChildren(svg);
    wireDrawing(svg);
  });

  section.append(
    figure,
    el('div', { class: 'mg-bar' }, count),
    live,
    list,
    el('div', { class: 'mg-nav' }, prev, next));
  if (indicator.id === 'heart_rate') section.append(pulseCounter(indicator, options));
  render();
  return section;
}

// "Count my pulse": 15 s timer, one press per beat (button or Space), beats x 4 = bpm.
function pulseCounter(indicator, options) {
  let beats = 0;
  let running = false;
  let skipClick = false; // Space on the Beat button also sends a click on release
  let endAt = 0;
  let tick = null;

  const start = el('button', { type: 'button', class: 'btn btn--primary' }, 'Count my pulse');
  const beat = el('button', { type: 'button', class: 'mg-beat', hidden: true },
    el('span', { class: 'mg-dot', 'aria-hidden': 'true' }), 'Beat');
  const clock = el('p', { class: 'mg-clock' });
  const total = el('p', { class: 'mg-total' });
  const result = el('div', { class: 'mg-result', tabindex: '-1', hidden: true });

  function stop() {
    clearInterval(tick);
    tick = null;
    running = false;
    document.removeEventListener('keydown', onKey);
  }

  function countBeat() {
    if (!running) return;
    beats += 1;
    total.textContent = `Beats counted: ${beats}`;
  }

  function onKey(e) {
    if (e.key !== ' ' || e.repeat) return;
    if (e.target === beat) skipClick = true;
    else if (e.target !== document.body) return;
    e.preventDefault();
    countBeat();
  }

  function finish() {
    stop();
    beat.hidden = true;
    clock.textContent = 'Time is up.';
    start.disabled = false;
    start.textContent = 'Count again';
    const bpm = beats * 4; // 15 s to a minute: multiply by 4
    const usable = bpm >= indicator.min_plausible && bpm <= indicator.max_plausible;
    result.replaceChildren(...[
      el('p', {}, `${beats} beats in ${PULSE_SECONDS} s = ${bpm} bpm`),
      usable && options.onValue
        ? el('button', { type: 'button', class: 'btn btn--primary', onclick: () => options.onValue(bpm) }, 'Use this value')
        : null,
      usable ? null : el('p', { class: 'mg-hint' }, 'That count is outside the allowed range. Count again or type the value.')].filter((c) => c != null && c !== false));
    result.hidden = false;
    result.focus();
  }

  function update() {
    if (!beat.isConnected) { stop(); return; } // guide was removed (dialog closed, form rebuilt)
    const left = Math.ceil((endAt - performance.now()) / 1000);
    if (left <= 0) { finish(); return; }
    clock.textContent = `${left} s left`;
  }

  start.addEventListener('click', () => {
    beats = 0;
    running = true;
    endAt = performance.now() + PULSE_SECONDS * 1000;
    total.textContent = 'Beats counted: 0';
    result.hidden = true;
    start.disabled = true;
    start.textContent = 'Counting…';
    beat.hidden = false;
    document.addEventListener('keydown', onKey);
    tick = setInterval(update, 200);
    update();
    beat.focus();
  });
  beat.addEventListener('click', () => {
    if (skipClick) { skipClick = false; return; }
    countBeat();
  });
  beat.addEventListener('keyup', (e) => {
    if (e.key === ' ') setTimeout(() => { skipClick = false; }, 0);
  });

  return el('div', { class: 'mg-pulse' },
    el('h4', {}, 'Count my pulse'),
    el('p', { class: 'mg-hint' }, `Press Start, then press Beat once for each beat you feel. The count runs for ${PULSE_SECONDS} seconds.`),
    start, clock, beat, total, result);
}

// A guide in a modal dialog. Esc closes it; the promise resolves when it closes.
export function openMeasureDialog(indicator, options = {}) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'confirm measure-dialog', 'aria-labelledby': `mg-${indicator.id}-title` });
    const close = el('button', { type: 'button', class: 'btn', onclick: () => dialog.close() }, 'Close');
    const guide = measureGuide(indicator, {
      ...options,
      onValue: options.onValue ? (v) => { options.onValue(v); dialog.close(); } : undefined,
    });
    dialog.append(guide, el('div', { class: 'btn-row' }, close));
    dialog.addEventListener('close', () => { dialog.remove(); resolve(); }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
    guide.querySelector('.mg-step[aria-current="step"]')?.focus();
  });
}
