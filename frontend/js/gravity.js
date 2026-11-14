import { api } from './api.js';
import { el, formatDate, formatValue, initShell, showError } from './shell.js';
import { gravityPoints, seriesDomain, transitionPoints } from './gravity-chart.js';
import { responsiveChartHeight } from './trend-data.js';

const NS = 'http://www.w3.org/2000/svg';
const root = document.getElementById('gravity-root');
let ctx;
let missionId;
let windowDays = 60;
let seq = 0;

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, String(value)));
  children.filter((child) => child !== null && child !== undefined).forEach((child) => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
  return node;
}

function chart(readings, kind, label) {
  const points = gravityPoints(readings);
  const wrap = el('div', { class: 'gravity-chart-slot' });
  const draw = () => {
    const width = Math.max(320, Math.round(wrap.clientWidth || 760));
    const height = responsiveChartHeight(width);
    const L = 58; const R = 20; const T = 26; const B = 52;
    const pw = width - L - R; const ph = height - T - B;
    const values = points.map((point) => kind === 'gravity' ? point.g : Math.max(0, 1 - point.g) * 100);
    const [yMin, yMax] = kind === 'gravity' ? seriesDomain(values, [0, 1]) : [0, 100];
    const start = points.length ? Date.parse(points[0].at) : 0;
    const span = points.length ? Math.max(1, Date.parse(points.at(-1).at) - start) : 1;
    const x = (index) => L + ((Date.parse(points[index].at) - start) / span) * pw;
    const y = (value) => T + ph - ((value - yMin) / Math.max(0.001, yMax - yMin)) * ph;
    const graph = svg('svg', { viewBox: `0 0 ${width} ${height}`, class: 'gravity-chart', role: 'img', 'aria-label': label });
    graph.append(svg('rect', { x: L, y: T, width: pw, height: ph, class: 'gravity-plot-bg' }));
    for (let step = 0; step <= 4; step += 1) {
      const value = yMin + ((yMax - yMin) * step) / 4;
      graph.append(
        svg('line', { x1: L, x2: L + pw, y1: y(value), y2: y(value), class: 'gravity-grid' }),
        svg('text', { x: L - 8, y: y(value) + 4, 'text-anchor': 'end', class: 'gravity-axis-label' }, formatValue(value, kind === 'gravity' ? 2 : 0)),
      );
    }
    const tickIndexes = points.length ? [...new Set([0, Math.round((points.length - 1) / 4), Math.round((points.length - 1) / 2), Math.round(((points.length - 1) * 3) / 4), points.length - 1])] : [];
    tickIndexes.forEach((index) => graph.append(
      svg('line', { x1: x(index), x2: x(index), y1: T, y2: T + ph, class: 'gravity-grid gravity-grid--vertical' }),
      svg('text', { x: x(index), y: T + ph + 20, 'text-anchor': 'middle', class: 'gravity-axis-label' }, formatDate(points[index]?.at)),
    ));
    let path = '';
    values.forEach((value, index) => { path += `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)} `; });
    if (path) graph.append(svg('path', { d: path.trim(), class: 'gravity-series' }));
    transitionPoints(points).forEach((transition) => {
      const index = points.findIndex((point) => point.at === transition.at);
      graph.append(svg('line', { x1: x(index), x2: x(index), y1: T, y2: T + ph, class: 'gravity-transition' }));
    });
    if (values.length) graph.append(svg('circle', { cx: x(values.length - 1), cy: y(values.at(-1)), r: 5, class: 'gravity-current' }));
    graph.append(
      svg('line', { x1: L, x2: L, y1: T, y2: T + ph, class: 'gravity-axis' }),
      svg('line', { x1: L, x2: L + pw, y1: T + ph, y2: T + ph, class: 'gravity-axis' }),
      svg('text', { x: L, y: 15, class: 'gravity-axis-label gravity-axis-title' }, kind === 'gravity' ? 'Local gravity (g)' : 'Modeled load deficit (%)'),
    );
    wrap.replaceChildren(graph);
  };
  if (!points.length) return el('p', { class: 'state' }, 'Bu zaman aralığında yerçekimi kaydı yok. Daha uzun bir aralık seçin.');
  new ResizeObserver(draw).observe(wrap);
  requestAnimationFrame(draw);
  return wrap;
}

function assessmentCards(assessment) {
  const cards = [
    ['Current gravity', `${formatValue(assessment.current_g, 3)} g`],
    ['Earth load', `${formatValue(assessment.earth_load_pct, 1)}%`],
    ['Modeled load deficit', `${formatValue(assessment.load_deficit_pct, 1)}%`],
    ['Equivalent microgravity', `${formatValue(assessment.window_equivalent_microgravity_days, 1)} days`],
    ['Field transitions', String(assessment.transition_count)],
  ];
  return el('div', { class: 'gravity-metrics' }, cards.map(([name, value]) => el('div', { class: 'gravity-metric' },
    el('span', { class: 'metric__label' }, name), el('strong', { class: 'metric__value' }, value))));
}

function render(data) {
  const assessment = data.assessment;
  const transitions = transitionPoints(gravityPoints(data.readings));
  const picker = el('select', { class: 'input', 'aria-label': 'Mission gravity profile', onchange: (event) => { missionId = event.target.value; load(); } },
    ctx.config.missions.map((mission) => el('option', { value: mission.id, selected: mission.id === missionId }, `${mission.name} · ${formatValue(mission.gravity_g, 3)} g`)));
  const period = el('select', { class: 'input', 'aria-label': 'Gösterilecek zaman aralığı', onchange: (event) => { windowDays = Number(event.target.value); load(); } },
    [7, 30, 60, 180].map((days) => el('option', { value: days, selected: days === windowDays }, `Son ${days} gün`)));
  const sources = [...new Set((data.readings || []).map((reading) => reading.source).filter(Boolean))];
  const sourceText = sources.length ? sources.map((source) => source.includes('sim') ? 'Simülasyon / görev profili' : source).join(', ') : 'Kayıt yok; görev profili kullanılıyor';
  const areas = (assessment.analysis_areas || []).map((area) => area.replaceAll('_', ' '));
  root.replaceChildren(el('div', { class: 'gravity-stack' },
    el('div', { class: 'page-head' }, el('h1', {}, 'Gravital Tracking'),
      el('p', {}, 'Follow local gravity, mechanical unloading and gravity-field transitions. Calculations are transparent decision support, not clinical probabilities.')),
    el('section', { class: 'panel gravity-picker' }, el('div', { class: 'field' }, el('label', {}, 'Görev profili'), picker), el('div', { class: 'field' }, el('label', {}, 'Zaman aralığı'), period),
      el('p', { class: 'muted' }, assessment.interpretation)),
    el('section', { class: 'panel gravity-overview' }, el('div', {}, el('span', { class: 'eyebrow' }, 'GÖREV BAĞLAMI'), el('h2', {}, `${formatValue(assessment.current_g, 3)} g`), el('p', {}, 'Yerel yerçekimi · Dünya = 1 g')), el('div', {}, el('span', { class: 'eyebrow' }, 'VERİ KAPSAMI'), el('h2', {}, `${data.readings.length} kayıt`), el('p', {}, `Kaynak: ${sourceText}`)), el('div', {}, el('span', { class: 'eyebrow' }, 'ANALİZE ETKİSİ'), el('p', {}, 'Kemik tahminine günlük yerçekimi geçmişi, aktivite önerilerine güncel görev bağlamı eklenir.'), el('a', { class: 'btn', href: 'activity.html' }, 'Aktiviteler ve öneriler →'))),
    el('section', { class: 'panel' }, el('h2', {}, 'Current gravity context'), assessmentCards(assessment),
      el('p', { class: 'muted gravity-note' }, `Analysis areas: ${areas.join(', ') || 'none flagged'}. Evidence: ${assessment.evidence === 'limited_human_evidence' ? 'limited human evidence' : 'mission profile'}.`)),
    el('section', { class: 'panel' }, el('h2', {}, 'Local gravity over time'),
      el('p', { class: 'muted' }, 'A vertical dashed marker shows a change of at least 0.05 g.'),
      chart(data.readings, 'gravity', 'Local gravity in g over the selected window')),
    el('section', { class: 'panel' }, el('h2', {}, 'Modeled mechanical load deficit'),
      el('p', { class: 'muted' }, 'Calculated as max(0, 1 − local gravity). This feeds the bone projection but is not a diagnosis.'),
      chart(data.readings, 'deficit', 'Modeled mechanical load deficit percentage over the selected window')),
    el('section', { class: 'panel' }, el('h2', {}, 'Detected field transitions'),
      transitions.length ? el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Observed'), el('th', {}, 'From'), el('th', {}, 'To'), el('th', {}, 'Change'))),
        el('tbody', {}, transitions.map((item) => el('tr', {}, el('td', {}, formatDate(item.at)), el('td', {}, `${formatValue(item.from, 3)} g`), el('td', {}, `${formatValue(item.to, 3)} g`), el('td', {}, `${formatValue(Math.abs(item.to - item.from), 3)} g`))))))
        : el('p', { class: 'state' }, 'No gravity-field transition was detected in this window.')),
    el('section', { class: 'panel gravity-method' }, el('h2', {}, 'How this is used'),
      el('p', {}, 'Each mission day keeps its own gravity value. Bone projections integrate that daily history; future days carry the latest valid reading forward.'),
      el('p', { class: 'muted' }, data.note))));
}

async function load() {
  const current = ++seq;
  root.replaceChildren(el('p', { class: 'state' }, 'Loading gravity profile…'));
  try {
    const data = await api.gravity(null, missionId, windowDays);
    if (current === seq) render(data);
  } catch (error) { if (current === seq) showError(root, error); }
}

try {
  ctx = await initShell({ page: 'gravity' });
  const status = ctx.astronautId ? await api.status(ctx.astronautId).catch(() => null) : null;
  missionId = status?.mission?.id || ctx.config.missions[0]?.id;
  await load();
} catch (error) { showError(root, error); }
