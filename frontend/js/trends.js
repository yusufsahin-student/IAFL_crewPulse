// Trends page: indicator history, normal ranges, unusual check-ins, health score and projected bone loss.
// Data: api.history and api.bone (docs/CONTRACT.md section 5). Ranges and labels come from config.
import { initShell, el, showError, statusBadge, formatValue, formatDate, STATUS_LABEL } from './shell.js';
import { api } from './api.js';
import { pearson, matrix, minPairs } from './correlation.js';
import { fitTicks, responsiveChartHeight, selectSolarEvents, groupSolarEvents } from './trend-data.js';
import { layerSummary } from './context-data.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000;
const main = document.getElementById('content');
const ui = {}; // the indicator chart's readout, slider and active-point setters
let activeSetters = [];
let chainReadout = null;
let clipSeq = 0;
const state = { config: null, astronautId: null, status: null, contextLayers: [], gravityAssessment: null, solarEvents: [], points: [], indicatorId: null, index: 0, showTable: false, seq: 0 };

// Charts measure their slot and redraw at its width, so labels stay legible at 360 px and 1440 px.
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const slot = entry.target;
    const w = Math.round(slot.clientWidth);
    if (w > 0 && w !== slot._w) {
      slot._w = w;
      slot.replaceChildren(slot._draw(w));
    }
  }
});

function chartSlot(draw) {
  const slot = el('div', { class: 'chart-slot' });
  slot._draw = draw;
  resizeObserver.observe(slot);
  return slot;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const fmtTick = (t) => String(Number(t.toFixed(3)));
const diamond = (cx, cy, r) => `M${cx} ${cy - r} L${cx + r} ${cy} L${cx} ${cy + r} L${cx - r} ${cy} Z`;
// Bone sites are told apart by dash pattern (neutral colours), never by status colour. Four patterns.
const siteClass = (k) => `site-${k % 4}`;

function param(key, fallback) {
  const v = state.config && state.config.params ? state.config.params[key] : undefined;
  return isNum(v) ? v : fallback;
}

// Every indicator in the history, in config order, then any history-only ones.
// Overlay personalized effective ranges from status when available.
function indicatorList() {
  const ids = (state.history && state.history.indicators) || [];
  const statusRanges = new Map(((state.status && state.status.indicators) || []).map((i) => [i.indicator_id, i.range]));
  const withRange = (ind) => {
    const r = statusRanges.get(ind.id);
    return r
      ? {
        ...ind,
        normal_low: r.normal_low,
        normal_high: r.normal_high,
        critical_low: r.critical_low,
        critical_high: r.critical_high,
        adjusted: r.adjusted,
        note: r.note,
      }
      : ind;
  };
  const configured = ((state.config && state.config.indicators) || []).filter((i) => ids.includes(i.id)).map(withRange);
  const extra = ids
    .filter((id) => !configured.some((c) => c.id === id))
    .map((id) => withRange({ id, name: id, unit: '', decimals: 1 }));
  return [...configured, ...extra];
}

function labelOf(ind) {
  return ind.unit ? `${ind.name} (${ind.unit})` : ind.name;
}

// Reading status against the Earth reference range (section 3).
function readingStatus(v, ind) {
  if (!isNum(v)) return 'missing';
  if ((isNum(ind.critical_low) && v < ind.critical_low) || (isNum(ind.critical_high) && v > ind.critical_high)) return 'alert';
  if ((isNum(ind.normal_low) && v < ind.normal_low) || (isNum(ind.normal_high) && v > ind.normal_high)) return 'watch';
  return 'normal';
}

// Round tick values: steps of 1, 2, 2.5 or 5 times a power of ten.
function niceTicks(min, max, count) {
  const raw = (max - min || 1) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const ticks = [];
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 1000; v += step) {
    ticks.push(Number(v.toFixed(10)));
  }
  return ticks;
}

// Value range with a little room, including the normal range so the band is visible.
function valueDomain(vals, ind) {
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (isNum(ind.normal_low)) lo = Math.min(lo, ind.normal_low);
  if (isNum(ind.normal_high)) hi = Math.max(hi, ind.normal_high);
  if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  return [lo - pad, hi + pad];
}

function seriesOf(id) {
  return state.points.map((p) => ({
    x: p.mission_day,
    y: isNum(p.values[id]) ? p.values[id] : null,
    anomaly: p.is_anomaly,
  }));
}

function latestOf(id) {
  for (let i = state.points.length - 1; i >= 0; i--) {
    const v = state.points[i].values[id];
    if (isNum(v)) return { value: v, index: i };
  }
  return null;
}

function xDomain() {
  const xs = state.points.map((p) => p.mission_day);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs, xMin + 1);
  return { xMin, xMax, xTicks: niceTicks(xMin, xMax, 6).filter((t) => t >= xMin && t <= xMax) };
}

// Map solar event timestamps onto the mission_day axis within the active chart window.
function eventsInWindow() {
  if (!state.points.length || !state.solarEvents.length) return [];
  const ref = state.points[state.points.length - 1];
  const refDayMs = Date.parse(`${String(ref.taken_at).slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(refDayMs)) return [];
  const { xMin, xMax } = xDomain();
  const defH = param('rad.sep_default_duration_h', 24);
  const toDay = (iso) => ref.mission_day + (Date.parse(iso) - refDayMs) / DAY_MS;
  const out = [];
  for (const e of state.solarEvents) {
    const startX = toDay(e.start_time);
    if (!Number.isFinite(startX)) continue;
    const rawEnd = e.end_time ? toDay(e.end_time) : NaN;
    const endX = Number.isFinite(rawEnd) ? rawEnd : startX + (e.dose_relevant ? defH / 24 : 0.25);
    if (endX < xMin - 0.5 || startX > xMax + 0.5) continue;
    const startDay = clamp(Math.floor(startX), xMin, xMax);
    const shortLabel = e.dose_relevant
      ? `☀ SEP · ${formatValue(e.severity, 1)}`
      : e.class_type
        ? `${e.event_type} ${e.class_type}`
        : `${e.event_type} · ${formatValue(e.severity, 1)}`;
    out.push({ ...e, startX, endX, startDay, shortLabel });
  }
  return out.sort((a, b) => a.startX - b.startX);
}

function jumpToMissionDay(day) {
  if (!state.points.length) return;
  let idx = state.points.findIndex((p) => p.mission_day >= day);
  if (idx < 0) idx = state.points.length - 1;
  setIndex(idx);
}

// Generic line chart drawn at a given pixel width. cfg: xMin, xMax, xTicks, yTicks, xLabel, yLabel,
// label, height, bands [{from,to,cls}], solarEvents [...], lines [{points:[[x,y]],cls}], points [{x,y,anomaly}],
// hlines [{y,cls,label}], verticals [{x,label}], onPick(i).
function lineChart(width, cfg) {
  const H = cfg.height || responsiveChartHeight(width);
  const widestY = Math.max(...cfg.yTicks.map((tick) => fmtTick(tick).length));
  const L = Math.min(78, Math.max(54, 30 + widestY * 7));
  const R = 18;
  const T = cfg.solarEvents && cfg.solarEvents.length ? 48 : 34;
  const B = 48;
  const pw = Math.max(60, width - L - R);
  const ph = H - T - B;
  const yMin = cfg.yTicks[0];
  const yMax = cfg.yTicks[cfg.yTicks.length - 1];
  const sx = (v) => L + ((v - cfg.xMin) / (cfg.xMax - cfg.xMin)) * pw;
  const sy = (v) => T + ph - ((v - yMin) / (yMax - yMin)) * ph;
  const clipId = `plot-clip-${++clipSeq}`;
  const xTicks = fitTicks(cfg.xTicks, pw);
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${H}`, class: 'chart trend-chart', role: 'img',
    'aria-label': cfg.label, preserveAspectRatio: 'xMidYMid meet',
  });
  root.append(
    svg('defs', {}, svg('clipPath', { id: clipId }, svg('rect', { x: L, y: T, width: pw, height: ph }))),
    svg('rect', { x: L, y: T, width: pw, height: ph, class: 'plot-bg' }),
  );

  for (const b of cfg.bands) {
    const top = sy(clamp(b.to, yMin, yMax));
    const bottom = sy(clamp(b.from, yMin, yMax));
    if (bottom > top) root.append(svg('rect', { x: L, y: top, width: pw, height: bottom - top, class: b.cls }));
  }
  (cfg.solarEvents || []).filter((ev) => ev.dose_relevant).forEach((ev) => {
    const x1 = sx(clamp(ev.startX, cfg.xMin, cfg.xMax));
    const x2 = sx(clamp(ev.endX, cfg.xMin, cfg.xMax));
    if (x2 > x1) root.append(svg('rect', { x: x1, y: T, width: x2 - x1, height: ph, class: 'band-solar' }));
  });
  groupSolarEvents(cfg.solarEvents || []).forEach((group) => {
    const x = sx(clamp(group.day, cfg.xMin, cfg.xMax));
    root.append(svg('circle', { cx: x, cy: T - 9, r: group.dose_relevant ? 4 : 3, class: group.dose_relevant ? 'solar-day solar-day--dose' : 'solar-day' },
      svg('title', {}, `Day ${group.day}: ${group.events.length} event(s)`)));
  });
  for (const t of cfg.yTicks) {
    root.append(
      svg('line', { x1: L, x2: L + pw, y1: sy(t), y2: sy(t), class: 'grid-line' }),
      svg('text', { x: L - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, fmtTick(t)),
    );
  }
  for (const t of xTicks) {
    root.append(
      svg('line', { x1: sx(t), x2: sx(t), y1: T, y2: T + ph, class: 'grid-line grid-line--vertical' }),
      svg('text', { x: sx(t), y: T + ph + 19, 'text-anchor': 'middle', class: 'axis-label' }, String(t)),
    );
  }
  root.append(
    svg('line', { x1: L, x2: L, y1: T, y2: T + ph, class: 'axis' }),
    svg('line', { x1: L, x2: L + pw, y1: T + ph, y2: T + ph, class: 'axis' }),
    svg('text', { x: L, y: 14, class: 'axis-label' }, cfg.yLabel),
    svg('text', { x: L + pw / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-label' }, cfg.xLabel),
  );
  for (const h of cfg.hlines || []) {
    root.append(
      svg('line', { x1: L, x2: L + pw, y1: sy(h.y), y2: sy(h.y), class: `threshold ${h.cls}` }),
      svg('text', { x: L + pw - 4, y: sy(h.y) - 5, 'text-anchor': 'end', class: 'axis-label' }, h.label),
    );
  }
  for (const v of cfg.verticals || []) {
    root.append(
      svg('line', { x1: sx(v.x), x2: sx(v.x), y1: T, y2: T + ph, class: 'marker' }),
      svg('text', { x: sx(v.x) + 4, y: T + 12, class: 'axis-label' }, v.label),
    );
  }
  for (const ln of cfg.lines) {
    let d = '';
    let pen = false;
    for (const [x, y] of ln.points) {
      if (!isNum(y)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)} ${sy(y).toFixed(1)} `;
      pen = true;
    }
    root.append(svg('path', { d: d.trim(), class: ln.cls, 'clip-path': `url(#${clipId})` }));
  }
  // Unusual check-ins are diamonds in advisory blue; ordinary readings are circles in accent colour.
  const dots = cfg.points.map((pt) => {
    if (!isNum(pt.y)) return null;
    const cx = sx(pt.x);
    const cy = sy(pt.y);
    const node = pt.anomaly
      ? svg('path', { d: diamond(cx, cy, 5), class: 'point-anomaly', 'clip-path': `url(#${clipId})` })
      : svg('circle', { cx, cy, r: 3.5, class: 'trend-point', 'clip-path': `url(#${clipId})` });
    root.append(node);
    return node;
  });
  if (cfg.onPick) {
    root.addEventListener('pointermove', (e) => {
      const box = root.getBoundingClientRect();
      const vx = ((e.clientX - box.left) / box.width) * width;
      let best = -1;
      let bestD = Infinity;
      cfg.points.forEach((pt, i) => {
        if (!isNum(pt.y)) return;
        const d = Math.abs(sx(pt.x) - vx);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) cfg.onPick(best);
    });
  }
  const setActive = (i) => dots.forEach((n, k) => { if (n) n.classList.toggle('point-active', k === i); });
  return { root, setActive };
}

// Small line with the normal band, for the grid of all indicators.
function sparkline(pts, ind) {
  const W = 160;
  const H = 40;
  const P = 3;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart spark', 'aria-hidden': 'true', focusable: 'false' });
  const vals = pts.map((p) => p.y).filter(isNum);
  if (!vals.length) return root;
  const [lo, hi] = valueDomain(vals, ind);
  const x = (i) => P + (i * (W - 2 * P)) / Math.max(1, pts.length - 1);
  const y = (v) => P + (H - 2 * P) * (1 - (v - lo) / (hi - lo));
  if (isNum(ind.normal_low) || isNum(ind.normal_high)) {
    const top = isNum(ind.normal_high) ? Math.min(hi, ind.normal_high) : hi;
    const bottom = isNum(ind.normal_low) ? Math.max(lo, ind.normal_low) : lo;
    if (top > bottom) root.append(svg('rect', { x: P, y: y(top), width: W - 2 * P, height: y(bottom) - y(top), class: 'band-normal' }));
  }
  let d = '';
  let pen = false;
  pts.forEach((p, i) => {
    if (!isNum(p.y)) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.y).toFixed(1)} `;
    pen = true;
  });
  root.append(svg('path', { d: d.trim(), class: 'series' }));
  pts.forEach((p, i) => {
    if (p.anomaly && isNum(p.y)) root.append(svg('path', { d: diamond(x(i), y(p.y), 3), class: 'point-anomaly' }));
  });
  const last = pts.map((p, i) => ({ p, i })).filter((o) => isNum(o.p.y)).pop();
  if (last) root.append(svg('circle', { cx: x(last.i), cy: y(last.p.y), r: 2.6, class: 'trend-point' }));
  return root;
}

function setIndex(i) {
  state.index = i;
  for (const fn of activeSetters) fn(i);
  if (ui.range) ui.range.value = String(i);
  fillReadout();
  fillChainReadout();
}

function fillChainReadout() {
  if (!chainReadout) return;
  const p = state.points[state.index];
  if (!p) return;
  const list = indicatorList();
  const find = (id) => list.find((x) => x.id === id) || { id, name: id, unit: '', decimals: 1 };
  const parts = [el('strong', {}, `Day ${p.mission_day}`), ' · ', el('span', {}, formatDate(p.taken_at))];
  for (const id of ['sleep_hours', 'reaction_ms', 'mood']) {
    const ind = find(id);
    const v = p.values[id];
    const txt = isNum(v) ? `${formatValue(v, ind.decimals)}${ind.unit ? ` ${ind.unit}` : ''}` : '–';
    parts.push(' · ', el('span', { class: 'chain-readout__item' }, el('span', {}, ind.name), ': ', el('strong', {}, txt)));
  }
  chainReadout.replaceChildren(...parts);
}

function fillReadout() {
  if (!ui.readout || !ui.ind) return;
  const p = state.points[state.index];
  if (!p) return;
  const ind = ui.ind;
  const v = p.values[ind.id];
  const parts = [
    el('strong', {}, `Day ${p.mission_day}`),
    ` · ${formatDate(p.taken_at)} · `,
    isNum(v) ? `${formatValue(v, ind.decimals)}${ind.unit ? ` ${ind.unit}` : ''}` : 'No reading',
    ' ',
    statusBadge(readingStatus(v, ind)),
  ];
  if (p.is_anomaly) parts.push(' ', statusBadge('advisory', 'Unusual for you'));
  ui.readout.replaceChildren(...parts);
}

function pickIndicator(id) {
  state.indicatorId = id;
  render('ind-select');
}

function rangeText(ind) {
  const unit = ind.unit ? ` ${ind.unit}` : '';
  const lo = isNum(ind.normal_low) ? fmtTick(ind.normal_low) : null;
  const hi = isNum(ind.normal_high) ? fmtTick(ind.normal_high) : null;
  const source = (ind.id === 'kcal_intake' || ind.id === 'grip_strength')
    ? 'This range is personalised for this crew member from the indicator settings.'
    : 'This is the Earth reference range from the indicator settings.';
  if (lo && hi) return `Shaded band: normal range ${lo} to ${hi}${unit}. ${source}`;
  if (lo) return `Shaded band: normal from ${lo}${unit} up. ${source}`;
  if (hi) return `Shaded band: normal up to ${hi}${unit}. ${source}`;
  return 'No normal range is set for this indicator.';
}

function tableOf(ind) {
  return el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
    el('caption', { class: 'visually-hidden' }, `${labelOf(ind)} by check-in, oldest first`),
    el('thead', {}, el('tr', {},
      ['Mission day', 'Date', 'Value', 'Status'].map((h) => el('th', { scope: 'col' }, h)))),
    el('tbody', {}, state.points.map((p) => {
      const v = p.values[ind.id];
      return el('tr', {},
        el('td', {}, String(p.mission_day)),
        el('td', {}, formatDate(p.taken_at)),
        el('td', {}, isNum(v) ? `${formatValue(v, ind.decimals)}${ind.unit ? ` ${ind.unit}` : ''}` : '–'),
        el('td', {}, statusBadge(readingStatus(v, ind)), p.is_anomaly ? [' ', statusBadge('advisory', 'Unusual for you')] : null));
    }))));
}

function solarEventsStrip(events) {
  if (!events.length) {
    return el('p', { class: 'muted trend-note' }, 'No DONKI or simulated solar events occurred during this check-in window.');
  }
  const groups = groupSolarEvents(events);
  return el('details', { class: 'solar-strip', role: 'region', 'aria-label': 'Solar events on this timeline' },
    el('summary', {}, `Solar events: ${events.length} records · ${groups.length} mission days — show details`),
    el('div', { class: 'solar-strip__head' },
      el('strong', {}, `Solar events in this period (${events.length})`),
      el('span', { class: 'muted' }, 'Select an event to jump the timeline cursor to that mission day.')),
    el('div', { class: 'solar-strip__groups' }, groups.map((group) => el('details', { class: 'solar-day-group' },
      el('summary', {}, `Mission day ${group.day} · ${group.events.length} ${group.events.length === 1 ? 'event' : 'events'}${group.dose_relevant ? ' · includes a dose-relevant event' : ''}`),
      el('div', { class: 'solar-strip__list' }, group.events.map((ev) => el('button', {
      type: 'button',
      class: 'solar-chip',
      'data-dose': ev.dose_relevant ? '1' : '0',
      onclick: () => jumpToMissionDay(ev.startDay),
    },
    el('span', { class: 'solar-chip__badge' }, ev.dose_relevant ? '☀ SEP' : ev.event_type),
    el('span', { class: 'solar-chip__meta' }, [
      `Day ${ev.startDay}`,
      formatDate(ev.start_time),
      ev.class_type || null,
      `severity ${formatValue(ev.severity, 1)}`,
      ev.dose_relevant ? 'adds to dose' : null,
    ].filter(Boolean).join(' · ')))))))));
}

function indicatorPanel() {
  const list = indicatorList();
  const ind = list.find((i) => i.id === state.indicatorId) || list[0];
  ui.ind = ind;
  const pts = seriesOf(ind.id);
  const vals = pts.map((p) => p.y).filter(isNum);
  const yTicks = vals.length ? niceTicks(...valueDomain(vals, ind), 4) : [0, 1];
  const { xMin, xMax, xTicks } = xDomain();
  const events = eventsInWindow();
  const bands = isNum(ind.normal_low) || isNum(ind.normal_high)
    ? [{ from: isNum(ind.normal_low) ? ind.normal_low : yTicks[0], to: isNum(ind.normal_high) ? ind.normal_high : yTicks[yTicks.length - 1], cls: 'band-normal' }]
    : [];
  const cfg = {
    label: `${labelOf(ind)} for ${pts.length} check-ins, mission days ${xMin} to ${xMax}. Use the slider or move the pointer over the chart to read a single value.`,
    xMin, xMax, xTicks, yTicks, bands,
    solarEvents: events,
    xLabel: 'Mission day',
    yLabel: labelOf(ind),
    lines: [{ points: pts.map((p) => [p.x, p.y]), cls: 'series' }],
    points: pts,
    onPick: (i) => setIndex(i),
  };
  ui.range = el('input', {
    id: 'day-range', type: 'range', class: 'range', min: 0,
    max: Math.max(0, state.points.length - 1), step: 1, value: state.index,
    'aria-label': 'Choose a check-in by mission day',
    oninput: (e) => setIndex(Number(e.target.value)),
  });
  ui.readout = el('p', { class: 'readout', 'aria-live': 'polite' });
  fillReadout();
  const select = el('select', {
    id: 'ind-select', class: 'input',
    onchange: (e) => pickIndicator(e.target.value),
  }, list.map((i) => el('option', { value: i.id, selected: i.id === ind.id }, labelOf(i))));
  const chart = state.showTable
    ? tableOf(ind)
    : chartSlot((w) => {
      const c = lineChart(w, cfg);
      if (ui.setActive) {
        activeSetters = activeSetters.filter((fn) => fn !== ui.setActive);
      }
      ui.setActive = c.setActive;
      activeSetters.push(c.setActive);
      c.setActive(state.index);
      return c.root;
    });
  return el('section', { class: 'panel', 'aria-labelledby': 'trend-title' },
    el('h2', { id: 'trend-title' }, 'Indicator trend'),
    el('div', { class: 'trend-controls' },
      el('div', { class: 'field' }, el('label', { for: 'ind-select' }, 'Indicator'), select),
      el('button', {
        id: 'table-toggle', type: 'button', class: 'btn',
        onclick: () => { state.showTable = !state.showTable; render('table-toggle'); },
      }, state.showTable ? 'Show as chart' : 'Show as table')),
    el('p', { class: 'muted trend-note' }, rangeText(ind)),
    chart,
    state.showTable ? null : el('ul', { class: 'key-row', 'aria-label': 'Key' },
      el('li', {}, el('span', { class: 'key-band' }), 'Normal range'),
      el('li', {}, svg('svg', { viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' },
        svg('circle', { cx: 6, cy: 6, r: 3.5, class: 'trend-point' })), 'Check-in'),
      el('li', {}, svg('svg', { viewBox: '0 0 12 12', width: 12, height: 12, 'aria-hidden': 'true' },
        svg('path', { d: diamond(6, 6, 5), class: 'key-diamond' })), 'Unusual for you'),
      el('li', {}, el('span', { class: 'key-solar' }), 'Dot: a solar event that day · shading: duration of a dose-relevant event')),
    solarEventsStrip(events),
    el('div', { class: 'range-row' },
      el('label', { for: 'day-range' }, 'Check-in'),
      ui.range,
      ui.readout));
}

function solarStormChainPanel() {
  const chainIds = ['sleep_hours', 'reaction_ms', 'mood'];
  const list = indicatorList().filter((i) => chainIds.includes(i.id));
  if (!list.length) return null;
  const events = eventsInWindow();
  const { xMin, xMax, xTicks } = xDomain();
  chainReadout = el('p', { class: 'readout chain-readout', 'aria-live': 'polite' });
  fillChainReadout();
  const items = chainIds.map((id) => list.find((i) => i.id === id)).filter(Boolean).map((ind) => {
    const pts = seriesOf(ind.id);
    const vals = pts.map((p) => p.y).filter(isNum);
    const yTicks = vals.length ? niceTicks(...valueDomain(vals, ind), 3) : [0, 1];
    const bands = isNum(ind.normal_low) || isNum(ind.normal_high)
      ? [{ from: isNum(ind.normal_low) ? ind.normal_low : yTicks[0], to: isNum(ind.normal_high) ? ind.normal_high : yTicks[yTicks.length - 1], cls: 'band-normal' }]
      : [];
    const cfg = {
      label: `${labelOf(ind)} alongside solar events from mission day ${xMin} to ${xMax}.`,
      height: responsiveChartHeight(720, true),
      xMin, xMax, xTicks, yTicks, bands,
      solarEvents: events,
      xLabel: 'Mission day',
      yLabel: labelOf(ind),
      lines: [{ points: pts.map((p) => [p.x, p.y]), cls: 'series' }],
      points: pts,
      onPick: (i) => setIndex(i),
    };
    let mySetter = null;
    return el('div', { class: 'storm-chain-item' },
      el('div', { class: 'storm-chain-item__head' },
        el('strong', {}, ind.name),
        el('button', { type: 'button', class: 'btn btn--sm', onclick: () => pickIndicator(ind.id) }, 'Inspect above ↑')),
      chartSlot((w) => {
        const c = lineChart(w, cfg);
        if (mySetter) activeSetters = activeSetters.filter((fn) => fn !== mySetter);
        mySetter = c.setActive;
        activeSetters.push(c.setActive);
        c.setActive(state.index);
        return c.root;
      }));
  });
  return el('section', { class: 'panel', 'aria-labelledby': 'storm-chain-title' },
    el('h2', { id: 'storm-chain-title' }, 'Solar events & crew response (Sleep · Reaction time · Mood)'),
    el('p', { class: 'muted' }, 'Synchronised mission-day timeline comparing solar events against sleep duration, reaction time and mood so post-storm changes can be inspected together.'),
    solarEventsStrip(events),
    chainReadout,
    el('div', { class: 'storm-chain-grid' }, items));
}

function smallMultiples() {
  const list = indicatorList();
  const cards = list.map((ind) => {
    const latest = latestOf(ind.id);
    const status = readingStatus(latest ? latest.value : null, ind);
    return el('button', { type: 'button', class: 'spark-card', onclick: () => pickIndicator(ind.id) },
      el('span', { class: 'spark-name' }, ind.name),
      el('span', { class: 'spark-value' },
        el('span', { class: 'metric__value' }, latest ? formatValue(latest.value, ind.decimals) : '–',
          el('span', { class: 'metric__unit' }, ind.unit || '')),
        statusBadge(status)),
      sparkline(seriesOf(ind.id), ind));
  });
  return el('section', { class: 'panel', 'aria-labelledby': 'all-title' },
    el('h2', { id: 'all-title' }, 'All indicators'),
    el('details', { class: 'more' },
      el('summary', {}, `Show all ${list.length} indicators`),
      el('p', { class: 'muted' }, 'Latest reading and its status against the normal range. Select a card to chart it above.'),
      el('div', { class: 'spark-grid' }, cards)));
}

function scorePanel() {
  const pts = state.points.map((p) => ({ x: p.mission_day, y: isNum(p.score) ? p.score : null }));
  if (!pts.some((p) => p.y !== null)) return null;
  const { xMin, xMax, xTicks } = xDomain();
  const cfg = {
    label: `Health score for each check-in, mission days ${xMin} to ${xMax}.`,
    xMin, xMax, xTicks,
    yTicks: [0, 25, 50, 75, 100],
    xLabel: 'Mission day',
    yLabel: 'Health score (0 to 100)',
    bands: [
      { from: 75, to: 100, cls: 'band-normal' },
      { from: 50, to: 75, cls: 'band-watch' },
      { from: 0, to: 50, cls: 'band-alert' },
    ],
    solarEvents: eventsInWindow(),
    lines: [{ points: pts.map((p) => [p.x, p.y]), cls: 'series' }],
    points: pts.map((p) => ({ x: p.x, y: p.y, anomaly: false })),
  };
  return el('section', { class: 'panel', 'aria-labelledby': 'score-title' },
    el('h2', { id: 'score-title' }, 'Health score'),
    el('details', { class: 'more' },
      el('summary', {}, 'Show health score history'),
      el('p', { class: 'muted' },
        `The vitals part of the health score for each check-in. Good is 75 and above. ${STATUS_LABEL.watch} is 50 to 74. ${STATUS_LABEL.alert} is below 50.`),
      chartSlot((w) => lineChart(w, cfg).root)));
}

function bonePanel() {
  const b = state.bone;
  const sites = b.sites || [];
  const head = el('h2', { id: 'bone-title' }, 'Projected bone loss');
  if (!sites.length) {
    return el('section', { class: 'panel', 'aria-labelledby': 'bone-title' }, head,
      el('p', { class: 'state' }, 'No bone sites are set up yet. Add them to the reference data and reload.'));
  }
  const watch = param('bone.watch_pct', 5);
  const alert = param('bone.alert_pct', 10);
  const windowDays = param('bone.exercise_window_days', 7);
  const allDays = sites.flatMap((s) => s.projected.map((p) => p.mission_day));
  const maxLoss = Math.max(...sites.flatMap((s) => s.projected.map((p) => p.loss_pct)));
  const xMin = Math.min(...allDays);
  const xMax = Math.max(...allDays, xMin + 1);
  const cfg = {
    label: `Projected bone loss by site from mission day ${xMin} to ${xMax}, with ${STATUS_LABEL.watch} and ${STATUS_LABEL.alert} lines.`,
    xMin, xMax,
    xTicks: niceTicks(xMin, xMax, 6).filter((t) => t >= xMin && t <= xMax),
    yTicks: niceTicks(0, Math.max(alert, maxLoss) * 1.05, 4),
    xLabel: 'Mission day',
    yLabel: 'Projected loss (%)',
    bands: [],
    lines: sites.map((s, k) => ({
      points: s.projected.map((p) => [p.mission_day, p.loss_pct]),
      cls: `series ${siteClass(k)}`,
    })),
    points: [],
    hlines: [
      { y: watch, cls: 'threshold-watch', label: `${STATUS_LABEL.watch} ${fmtTick(watch)}%` },
      { y: alert, cls: 'threshold-alert', label: `${STATUS_LABEL.alert} ${fmtTick(alert)}%` },
    ],
    verticals: [{ x: b.mission_day, label: `Today, day ${b.mission_day}` }],
  };
  const lastDay = sites[0].projected.length ? sites[0].projected[sites[0].projected.length - 1].mission_day : xMax;
  return el('section', { class: 'panel', 'aria-labelledby': 'bone-title' },
    head,
    el('p', {}, b.note || 'Projection from published loss rates, not a scan.'),
    el('p', { class: 'muted' },
      `Exercise averaged ${formatValue(b.exercise_avg_min, 1)} min a day over the last ${windowDays} days. `,
      `Exercise factor ${formatValue(b.exercise_factor, 2)} (1 means no effect), so exercise lowers the projected loss by ${formatValue((1 - b.exercise_factor) * 100, 0)}%. `,
      `Gravity factor ${formatValue(b.gravity_factor, 2)}.`),
    chartSlot((w) => lineChart(w, cfg).root),
    el('ul', { class: 'key-row', 'aria-label': 'Sites, by line pattern' }, sites.map((s, k) => el('li', {},
      svg('svg', { viewBox: '0 0 18 4', width: 18, height: 4, 'aria-hidden': 'true' },
        svg('line', { x1: 0, y1: 2, x2: 18, y2: 2, class: `key-line ${siteClass(k)}` })),
      s.name))),
    el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
      el('caption', { class: 'visually-hidden' }, 'Projected bone loss by site'),
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col' }, 'Site'),
        el('th', { scope: 'col' }, 'Projected loss today'),
        el('th', { scope: 'col' }, 'Status'),
        el('th', { scope: 'col' }, `Projected by day ${lastDay}`))),
      el('tbody', {}, sites.map((s) => {
        const end = s.projected.length ? s.projected[s.projected.length - 1].loss_pct : null;
        return el('tr', {},
          el('th', { scope: 'row' }, s.name),
          el('td', {}, `${formatValue(s.loss_pct, 2)}%`),
          el('td', {}, statusBadge(s.status)),
          el('td', {}, isNum(end) ? `${formatValue(end, 2)}%` : '–'));
      })))));
}

// ---- How your readings relate (correlation) ----
const fmtR = (r) => `${r < 0 ? '−' : '+'}${Math.abs(r).toFixed(2)}`;
// Lower-case a name in mid-sentence unless it carries its own capitals (SpO2).
const lc = (n) => (/^[A-Z][a-z]/.test(n) ? n[0].toLowerCase() + n.slice(1) : n);
const strengthWord = (r) => (Math.abs(r) < 0.3 ? 'weak' : Math.abs(r) < 0.6 ? 'moderate' : 'strong');

function pairSentence(a, b, c) {
  const body = c.r > 0
    ? `${a.name} and ${lc(b.name)} tend to rise together`
    : `When ${lc(a.name)} is higher, ${lc(b.name)} tends to be lower`;
  return `${body} (${strengthWord(c.r)}, r = ${fmtR(c.r)}, ${c.n} days).`;
}

function scatterPlot(a, b) {
  const pairs = state.points
    .map((p) => [p.values[a.id], p.values[b.id]])
    .filter(([x, y]) => isNum(x) && isNum(y));
  const xs = pairs.map((q) => q[0]);
  const ys = pairs.map((q) => q[1]);
  const { r, n } = pearson(xs, ys, minPairs(state.config));
  const caption = isNum(r)
    ? `${a.name} against ${lc(b.name)}: r = ${fmtR(r)} from ${n} check-ins. ${pairSentence(a, b, { r, n })}`
    : `${a.name} against ${lc(b.name)}: not enough paired check-ins to measure a link (${n}).`;
  const head = el('p', { class: 'readout', 'aria-live': 'polite' }, caption);
  if (!n) return head;
  const [x0, x1] = valueDomain(xs, {});
  const [y0, y1] = valueDomain(ys, {});
  const xT = niceTicks(x0, x1, 5);
  const yT = niceTicks(y0, y1, 4);
  const xMin = xT[0];
  const xMax = xT[xT.length - 1];
  const yMin = yT[0];
  const yMax = yT[yT.length - 1];
  const slot = chartSlot((width) => {
    const H = 260; const L = 52; const R = 14; const T = 14; const B = 46;
    const pw = Math.max(60, width - L - R);
    const ph = H - T - B;
    const sx = (v) => L + ((v - xMin) / (xMax - xMin)) * pw;
    const sy = (v) => T + ph - ((v - yMin) / (yMax - yMin)) * ph;
    const root = svg('svg', { viewBox: `0 0 ${width} ${H}`, class: 'chart', role: 'img', 'aria-label': caption });
    for (const t of yT) {
      root.append(svg('line', { x1: L, x2: L + pw, y1: sy(t), y2: sy(t), class: 'grid-line' }),
        svg('text', { x: L - 8, y: sy(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, fmtTick(t)));
    }
    for (const t of xT) root.append(svg('text', { x: sx(t), y: T + ph + 16, 'text-anchor': 'middle', class: 'axis-label' }, fmtTick(t)));
    root.append(
      svg('line', { x1: L, x2: L, y1: T, y2: T + ph, class: 'axis' }),
      svg('line', { x1: L, x2: L + pw, y1: T + ph, y2: T + ph, class: 'axis' }),
      svg('text', { x: L + pw / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-label' }, labelOf(a)),
      svg('text', { x: 14, y: T + ph / 2, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 14 ${T + ph / 2})` }, labelOf(b)));
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    const sxx = xs.reduce((s, v) => s + (v - mx) ** 2, 0);
    if (isNum(r) && sxx > 0) {
      const k = xs.reduce((s, v, i) => s + (v - mx) * (ys[i] - my), 0) / sxx;
      root.append(
        svg('clipPath', { id: 'scatter-clip' }, svg('rect', { x: L, y: T, width: pw, height: ph })),
        svg('line', {
          x1: sx(xMin), x2: sx(xMax), y1: sy(my + k * (xMin - mx)), y2: sy(my + k * (xMax - mx)),
          class: 'fit-line', 'clip-path': 'url(#scatter-clip)',
        }));
    }
    for (const [x, y] of pairs) root.append(svg('circle', { cx: sx(x), cy: sy(y), r: 4, class: 'trend-point scatter-dot' }));
    return root;
  });
  return el('div', {}, head, slot,
    el('p', { class: 'muted trend-note' }, 'Each dot is one check-in. The dashed line is the straight-line fit.'));
}

function correlationPanel() {
  const min = minPairs(state.config);
  const list = indicatorList().filter((i) => state.points.some((p) => isNum(p.values[i.id])));
  const head = el('h2', { id: 'corr-title' }, 'How your readings relate');
  const note = el('p', { class: 'muted trend-note' },
    'Correlation shows readings that move together, not what causes what. The demo crew’s history is simulated, so most links here are weak.');
  if (list.length < 2) {
    return el('section', { class: 'panel', 'aria-labelledby': 'corr-title' }, head,
      el('p', { class: 'state' }, 'Record more check-ins to compare readings.'), note);
  }
  const m = matrix(state.points, list.map((i) => i.id), min);
  const pairs = [];
  list.forEach((a, i) => list.forEach((b, j) => { if (j > i && m[i][j].r !== null) pairs.push({ a, b, c: m[i][j] }); }));
  const top = pairs.filter((p) => Math.abs(p.c.r) >= 0.2).sort((x, y) => Math.abs(y.c.r) - Math.abs(x.c.r)).slice(0, 5);
  const detail = el('div', { id: 'corr-detail', class: 'corr-detail' });
  const same = (n, a, b) => n.dataset.pair === `${a.id}|${b.id}` || n.dataset.pair === `${b.id}|${a.id}`;
  const show = (a, b) => {
    state.corrPair = [a.id, b.id];
    detail.replaceChildren(scatterPlot(a, b));
    document.querySelectorAll('.corr-cell').forEach((n) => n.setAttribute('aria-pressed', String(same(n, a, b))));
  };
  const cell = (a, b, c) => {
    const label = isNum(c.r)
      ? `${a.name} and ${lc(b.name)}: r = ${fmtR(c.r)} from ${c.n} days`
      : `${a.name} and ${lc(b.name)}: not enough data`;
    return el('button', {
      type: 'button', class: 'corr-cell', 'aria-label': label, 'aria-pressed': 'false',
      'data-pair': `${a.id}|${b.id}`, onclick: () => show(a, b),
    }, el('span', { class: 'corr-shade', style: `opacity:${isNum(c.r) ? (Math.abs(c.r) * 0.45).toFixed(2) : 0}` }),
    el('span', { class: 'corr-num', 'aria-hidden': 'true' }, isNum(c.r) ? fmtR(c.r) : '–'));
  };
  const grid = el('div', { class: 'corr-wrap' }, el('table', { class: 'corr-table' },
    el('caption', { class: 'visually-hidden' }, 'Correlation between each pair of indicators. Select a cell to see the scatter plot.'),
    el('thead', {}, el('tr', {}, el('td', {}), list.map((i) => el('th', { scope: 'col' }, i.name)))),
    el('tbody', {}, list.map((a, i) => el('tr', {},
      el('th', { scope: 'row' }, a.name),
      list.map((b, j) => el('td', {}, i === j ? null : cell(a, b, m[i][j]))))))));
  const links = top.length
    ? el('ul', { class: 'corr-links' }, top.map((p) => el('li', {},
      el('button', { type: 'button', class: 'corr-link', onclick: () => show(p.a, p.b) }, pairSentence(p.a, p.b, p.c)))))
    : el('p', { class: 'state' }, 'No clear links in this period.');
  const prior = (state.corrPair || []).map((id) => list.find((i) => i.id === id));
  const section = el('section', { class: 'panel', 'aria-labelledby': 'corr-title' }, head,
    el('p', { class: 'muted' }, `Each cell is the correlation (r) between two readings, from −1 to +1. Darker means stronger. It needs ${min} or more days with both readings.`),
    grid, el('h3', {}, 'Strongest links'), links, detail, note);
  if (prior.length === 2 && prior[0] && prior[1]) show(prior[0], prior[1]);
  else detail.replaceChildren(el('p', { class: 'muted' }, 'Select a cell or a link to see the two readings plotted against each other.'));
  return section;
}

function contextPanel() {
  const summaries = state.contextLayers.map((layer) => layerSummary(layer, 60)).filter(Boolean);
  const head = el('h2', { id: 'context-title' }, 'Mission context data');
  if (!summaries.length) {
    return el('section', { class: 'panel', 'aria-labelledby': 'context-title' }, head,
      el('p', { class: 'state' }, 'No environmental observations are available for this period.'),
      el('p', { class: 'muted trend-note' }, 'Context data is kept separate from the health score.'));
  }
  const blocks = summaries.map((summary) => {
    const freshness = summary.freshness.status === 'current' ? 'Current'
      : summary.freshness.status === 'stale' ? 'Stale' : 'Missing';
    const cards = summary.metrics.map((metric) => el('div', { class: 'spark-card context-card' },
      el('span', { class: 'spark-name' }, metric.label),
      metric.latest
        ? el('span', { class: 'metric__value' }, formatValue(metric.latest.value, metric.id === 'co2_ppm' ? 0 : 1),
          el('span', { class: 'metric__unit' }, metric.unit))
        : el('span', { class: 'muted' }, 'No observations')));
    const gravity = summary.id === 'gravity' && state.gravityAssessment
      ? el('p', { class: 'muted trend-note' },
        `${state.gravityAssessment.interpretation}. Window-equivalent microgravity exposure: ${formatValue(state.gravityAssessment.window_equivalent_microgravity_days, 1)} days. `,
        `Gravity-field transitions detected: ${state.gravityAssessment.transition_count}. `,
        `Analysis areas: ${(state.gravityAssessment.analysis_areas || []).map((id) => id.replaceAll('_', ' ')).join(', ') || 'none flagged'}. `,
        `Evidence: ${state.gravityAssessment.evidence === 'limited_human_evidence' ? 'limited human evidence' : 'mission profile'}.`)
      : null;
    return el('div', { class: 'context-layer' },
      el('h3', {}, summary.label),
      el('p', {}, `${freshness} · ${summary.observedDays} of 60 days observed (${summary.coveragePct}%).`),
      el('div', { class: 'spark-grid' }, cards), gravity);
  });
  return el('section', { class: 'panel', 'aria-labelledby': 'context-title' }, head,
    blocks,
    el('p', { class: 'muted trend-note' },
      'Context layers support analysis but do not establish a cause. Gravity feeds the bone projection through the latest measured g value; partial-gravity effects remain uncertain.'));
}

function render(focusId) {
  resizeObserver.disconnect();
  activeSetters = [];
  ui.setActive = null;
  chainReadout = null;
  const parts = [el('div', { class: 'page-head' },
    el('h1', {}, 'Trends'),
    el('p', {}, 'Readings over the last 60 check-ins, the normal range for each, and projected bone loss for this mission.'))];
  parts.push(contextPanel());
  if (!state.points.length) {
    parts.push(el('section', { class: 'panel' },
      el('h2', {}, 'No check-ins yet'),
      el('p', { class: 'state' }, 'Record a check-in to see trends here. ', el('a', { href: 'checkin.html' }, 'Go to check-in'))));
  } else {
    parts.push(indicatorPanel(), solarStormChainPanel(), smallMultiples(), scorePanel(), correlationPanel(), bonePanel());
  }
  main.replaceChildren(el('div', { class: 'stack' }, parts));
  if (focusId) {
    const node = document.getElementById(focusId);
    if (node) node.focus();
  }
}

async function load() {
  const seq = ++state.seq;
  if (!state.astronautId) {
    main.replaceChildren(el('p', { class: 'state' }, 'No crew member yet. Run the seeder, then reload this page.'));
    return;
  }
  main.replaceChildren(el('p', { class: 'state' }, 'Loading…'));
  try {
    const [history, bone, status, rad, solarFallback, environment, gravity] = await Promise.all([
      api.history(state.astronautId, 60),
      api.bone(state.astronautId, 180),
      api.status(state.astronautId).catch(() => null),
      api.radiation(state.astronautId).catch(() => null),
      api.solarEvents(60).catch(() => null),
      api.environment(state.astronautId, null, 60).catch(() => null),
      api.gravity(state.astronautId, null, 60).catch(() => null),
    ]);
    if (seq !== state.seq) return;
    state.history = history;
    state.bone = bone;
    state.status = status;
    state.solarEvents = selectSolarEvents(rad, solarFallback);
    state.contextLayers = [environment && environment.layer, gravity && gravity.layer].filter(Boolean);
    state.gravityAssessment = gravity && gravity.assessment;
    state.points = history.points || [];
    const list = indicatorList();
    if (!list.some((i) => i.id === state.indicatorId)) {
      const pref = list.find((i) => i.id === 'heart_rate') || list[0];
      state.indicatorId = pref ? pref.id : null;
    }
    state.index = Math.max(0, state.points.length - 1);
    render();
  } catch (err) {
    if (seq === state.seq) showError(main, err);
  }
}

window.addEventListener('astronaut-change', (event) => {
  if (!state.config) return;
  state.astronautId = event.detail.astronautId;
  load();
});

async function start() {
  try {
    const ctx = await initShell({ page: 'trends' });
    state.config = ctx.config;
    state.astronautId = ctx.astronautId;
    await load();
  } catch (err) {
    showError(main, err);
  }
}

start();
