// Home page: master alert, triage and score first, then the body map and mission distance, then radiation and bone.
import { api } from './api.js';
import {
  initShell, el, statusBadge, masterAlert, showError, formatValue, formatDateTime,
  indicatorById, missionById, STATUS_LABEL,
} from './shell.js';
import { renderRoutine, utcDay } from './routine.js';
import { openMeasureDialog, hasDiagram } from './measure.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const LEARN_IDS = ['hrp_hazards', 'hrp_risks', 'hrp_research', 'csa_science', 'i4_cmp'];
const SUMMARY_IDS = ['score', 'triage', 'radiation', 'bone'];
// Caution and warning get a pattern over the region fill, so status is never colour alone (HIDH p. 1033).
const HATCH = { watch: 'hatch-watch', alert: 'hatch-alert' };
// Worst first, for picking the region to show from the score.
const RANK = { alert: 0, watch: 1, normal: 2, missing: 3 };
const PART_DEFS = [
  ['vitals', 'Vitals'],
  ['anomaly', 'Personal pattern'],
  ['bone', 'Bone (projected)'],
  ['radiation', 'Radiation (estimated)'],
];

const CONSULT_TEXT = {
  ground_led: 'ground leads medical decisions',
  shared: 'crew and ground decide together',
  crew_led: 'crew leads; ground replies are delayed',
};

const state = {
  config: null,
  astronautId: null,
  status: null,     // real status (no mission override)
  missionId: null,  // mission chosen in the distance control
  regionId: null,   // selected body region
  partId: null,     // selected score part
  zoneName: null,   // shelter name for a solar particle event
  history: new Map(), // astronaut id -> promise of the 14-day history
  loadToken: 0,
  missionToken: 0,
  detailToken: 0,
};

// Signal delay as a short human string: "1.3 s" or "22 min".
function fmtDelay(seconds) {
  if (seconds === null || seconds === undefined) return '–';
  return seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function plural(n, one, many) {
  return n === 1 ? one : many;
}

// The API headline may start with a status word ("Watch: ..."). The badge already says the status, so drop the word.
function plainHeadline(text) {
  const t = String(text || '').replace(/^(watch|alert|caution|warning):\s*/i, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function reduceMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Small SVG helper: null attributes are skipped, children may be null.
function svgEl(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined && v !== false) node.setAttribute(k, String(v));
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

// ---- Region helpers ----

function regionInfo(s, id) {
  const cfg = (state.config.body_regions || []).find((r) => r.id === id);
  const found = (s.regions || []).find((r) => r.body_region_id === id);
  return {
    id,
    name: (cfg && cfg.name) || (found && found.name) || id,
    status: found ? found.status : 'missing',
  };
}

function orderedRegions(s) {
  const cfg = new Map((state.config.body_regions || []).map((r) => [r.id, r]));
  const order = (id) => (cfg.has(id) ? cfg.get(id).display_order : Infinity);
  return (s.regions || [])
    .map((r) => regionInfo(s, r.body_region_id))
    .sort((a, b) => order(a.id) - order(b.id));
}

// The region that needs most attention first (missing last).
function worstRegion(s) {
  const list = orderedRegions(s);
  return list.length ? [...list].sort((a, b) => RANK[a.status] - RANK[b.status])[0] : null;
}

// ---- Text helpers for one indicator ----

function valueOut(value, i, cfg) {
  const scale = cfg && cfg.input_type === 'scale';
  const label = scale && cfg.scale_labels ? cfg.scale_labels[value - cfg.min_plausible] : null;
  if (label) return `${label} (${formatValue(value)} of ${cfg.max_plausible})`;
  return `${formatValue(value, i.decimals)}${scale ? '' : ` ${i.unit}`}`;
}

function valueText(i, cfg) {
  if (i.value === null || i.value === undefined) return 'No reading';
  return valueOut(i.value, i, cfg);
}

function rangeText(i, cfg) {
  const r = i.range || {};
  const unit = cfg && cfg.input_type === 'scale' ? '' : ` ${i.unit}`;
  const f = (v) => formatValue(v, i.decimals);
  if (r.normal_low !== null && r.normal_low !== undefined && r.normal_high !== null && r.normal_high !== undefined) {
    return `${f(r.normal_low)} to ${f(r.normal_high)}${unit}`;
  }
  if (r.normal_low !== null && r.normal_low !== undefined) return `${f(r.normal_low)}${unit} or more`;
  if (r.normal_high !== null && r.normal_high !== undefined) return `${f(r.normal_high)}${unit} or less`;
  return 'No usual range set';
}

// "+12% vs your usual (73 bpm)." from the personal baseline.
function deltaText(i) {
  if (i.value === null || i.value === undefined) return 'No reading today to compare.';
  if (i.baseline_mean === null || i.baseline_mean === undefined) return 'Not enough check-ins yet for your usual level.';
  if (i.delta_pct === null || i.delta_pct === undefined) return 'No comparison available yet.';
  const usual = `${formatValue(i.baseline_mean, i.decimals)} ${i.unit}`;
  if (i.delta_pct === 0) return `At your usual level (${usual}).`;
  const sign = i.delta_pct > 0 ? '+' : '';
  return `${sign}${i.delta_pct}% vs your usual (${usual}).`;
}

// ---- Boot and load ----

async function boot() {
  wireBodyMap();
  $('mission-control').addEventListener('keydown', onDistKey);
  let ctx;
  try {
    ctx = await initShell({ page: 'details' });
  } catch (err) {
    showError($('home'), err);
    return;
  }
  state.config = ctx.config;
  state.astronautId = ctx.astronautId;
  $('learn').replaceChildren(...LEARN_IDS.map((id) => (ctx.config.sources || []).find((x) => x.id === id))
    .filter((x) => x && x.url)
    .map((x) => el('li', {}, el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title))));
  window.addEventListener('astronaut-change', (e) => {
    state.astronautId = e.detail.astronautId;
    state.regionId = null;
    state.partId = null;
    load();
  });
  await load();
}

function setLoading() {
  for (const id of SUMMARY_IDS) $(id).replaceChildren(el('p', { class: 'state' }, 'Loading…'));
}

async function load() {
  const token = ++state.loadToken;
  ++state.missionToken; // a late mission change must not overwrite this crew member's view
  $('home-error').replaceChildren();
  $('master-alert').replaceChildren();

  if (!state.astronautId) {
    $('home-who').textContent = 'No crew members yet.';
    $('home-checkin').textContent = '';
    for (const id of SUMMARY_IDS) {
      $(id).replaceChildren(el('p', { class: 'state' }, 'Add a crew member to the database, then reload this page.'));
    }
    return;
  }

  setLoading();
  try {
    const status = await api.status(state.astronautId);
    if (token !== state.loadToken) return;
    state.zoneName = status.radiation.active_event ? await zoneNameFor(status) : null;
    if (token !== state.loadToken) return;
    state.status = status;
    state.missionId = status.mission.id;
    renderAll(status);
    renderDailyRoutine(status, token);
  } catch (err) {
    if (token !== state.loadToken) return;
    showError($('home-error'), err);
    for (const id of SUMMARY_IDS) $(id).replaceChildren();
  }
}

// Streak needs more than the 14-day history used for sparklines; a failed fetch still shows reminder and tasks.
async function renderDailyRoutine(status, token) {
  const draw = (points) => { if (token === state.loadToken) renderRoutine($('routine'), { status, points, config: state.config }); };
  draw(null);
  try {
    draw((await api.history(state.astronautId, 90)).points || []);
  } catch {
    // Keep the version without streaks.
  }
}

// Shelter name for the master alert: the zone name, or its id when the name cannot be read.
async function zoneNameFor(s) {
  const id = s.radiation.recommended_zone_id;
  try {
    const rad = await api.radiation(state.astronautId);
    const zone = (rad.zones || []).find((z) => z.id === id);
    if (zone) return zone.name;
  } catch {
    // Fall through to the id.
  }
  return id || 'the shelter';
}

// Returns the alert status that was shown ('alert' | 'watch' | 'radiation' | null).
function renderAll(s) {
  renderMasterAlert(s);
  renderHead(s);
  renderTriage(s);
  renderScore(s);
  renderMissionControl();
  renderMissionLabel(s);
  renderBodyMap(s);
  renderSummaries(s);
  return masterAlertTone(s);
}

// ---- Master alert: the first thing on the page when something needs attention ----

// An active solar particle event always raises triage to level 2, so the shelter banner
// is shown on its own first and the health headline stays visible below it.
function masterAlertTone(s) {
  if (s.radiation.active_event) return 'radiation';
  if (s.triage.level >= 2) return 'alert';
  if (s.triage.level === 1) return 'watch';
  return null;
}

function renderMasterAlert(s) {
  const t = s.triage;
  const nodes = [];
  if (s.radiation.active_event) {
    nodes.push(masterAlert('radiation', 'Solar particle event in progress', `Go to ${state.zoneName || s.radiation.recommended_zone_id || 'the shelter'}`));
  }
  const tone = t.level >= 2 ? 'alert' : t.level === 1 ? 'watch' : null;
  if (tone && t.headline) nodes.push(masterAlert(tone, plainHeadline(t.headline)));
  $('master-alert').replaceChildren(...nodes);
}

// ---- Header ----

function renderHead(s) {
  const a = s.astronaut;
  $('home-who').textContent = `${a.name} · ${s.mission.name} mission · mission day ${a.mission_day}`;
  $('home-checkin').textContent = s.checkin
    ? `Last check-in: ${formatDateTime(s.checkin.taken_at)}.`
    : "No check-in yet. Start today's check-in.";
}

// ---- Health score: number, band and the first two reasons; the parts explain themselves on press ----

function renderScore(s) {
  const sc = s.score;
  if (!sc) {
    $('score').replaceChildren(
      statusBadge('missing', 'New check-in required'),
      el('p', { class: 'muted' }, 'The last-known readings are too old for a current health score.'),
      el('a', { class: 'btn btn--primary', href: 'checkin.html' }, 'Start check-in'));
    return;
  }
  const reasons = sc.reasons || [];
  const first = reasons.slice(0, 2);
  const more = reasons.slice(2);
  const moreLabel = `Show ${more.length} more ${plural(more.length, 'reason', 'reasons')}`;

  const parts = PART_DEFS.map(([key, label]) => {
    const v = sc.parts[key];
    const pct = Math.max(0, Math.min(100, Number(v) || 0));
    const open = state.partId === key;
    return el('li', {},
      el('button', {
        type: 'button', class: 'part-btn', 'data-part': key, 'aria-expanded': String(open),
        'aria-controls': open ? `part-${key}` : null, onclick: () => selectPart(key),
      },
      el('span', { class: 'part__label' }, label),
      el('span', { class: 'bar', 'aria-hidden': 'true' }, el('span', { class: 'bar__fill', style: `width: ${pct}%` })),
      el('span', { class: 'part__value' }, formatValue(v))),
      open ? el('div', { class: 'part-explain', id: `part-${key}` }, partExplain(s, key)) : null);
  });

  $('score').replaceChildren(...[
    el('div', { class: 'score-line' },
      el('span', { class: 'score-number' }, formatValue(sc.value)),
      el('div', {}, statusBadge(sc.band), el('p', { class: 'muted' }, 'out of 100'))),
    el('h3', {}, 'Why this score'),
    first.length
      ? el('ul', { class: 'list' }, first.map((r) => el('li', {}, r)))
      : el('p', { class: 'muted' }, 'Nothing needs attention right now.'),
    more.length
      ? el('details', { class: 'more' },
        el('summary', {}, moreLabel),
        el('ul', { class: 'list' }, more.map((r) => el('li', {}, r))))
      : null,
    el('h3', { class: 'part-title' }, 'Score parts'),
    el('p', { class: 'muted' }, 'Select a part to see what feeds it.'),
    el('ul', { class: 'part-list' }, parts)].filter((c) => c != null && c !== false));
}

function selectPart(key) {
  state.partId = state.partId === key ? null : key;
  renderScore(state.status);
  const btn = document.querySelector(`[data-part="${key}"]`);
  if (btn) btn.focus();
}

// The explanation under one score part, with the current number and a link where there is one.
function partExplain(s, key) {
  const v = formatValue(s.score.parts[key]);
  if (key === 'vitals') {
    const worst = worstRegion(s);
    const needsLook = worst && (worst.status === 'alert' || worst.status === 'watch');
    return el('div', {},
      el('p', {}, `Your latest readings, each weighted by importance. Normal counts 100, caution 60 and warning 10. Now ${v} out of 100.`),
      worst && needsLook
        ? el('p', {}, `Most attention: ${worst.name} (${STATUS_LABEL[worst.status]}).`)
        : el('p', {}, 'No body part needs attention right now.'),
      needsLook
        ? el('button', {
          type: 'button', class: 'btn', onclick: () => {
            selectRegion(worst.id);
            $('body-title').scrollIntoView({ block: 'start' });
          },
        }, 'Show on body map')
        : null);
  }
  if (key === 'anomaly') {
    const contributors = (s.anomaly && s.anomaly.contributors) || [];
    if (!s.anomaly) return el('p', {}, 'Needs a few more check-ins before it can compare you with your usual pattern.');
    if (!contributors.length) return el('p', {}, 'Nothing stands out from your usual pattern in today\'s check-in.');
    return el('div', {},
      el('p', {}, 'Readings that differ most from your usual pattern:'),
      el('ul', { class: 'list' }, contributors.map((c) => {
        const cfg = indicatorById(state.config, c.indicator_id);
        const ind = s.indicators.find((i) => i.indicator_id === c.indicator_id);
        const name = (ind && ind.name) || (cfg && cfg.name) || c.indicator_id;
        const unit = (ind && ind.unit) || (cfg && cfg.unit) || '';
        const dec = (ind && ind.decimals) ?? (cfg && cfg.decimals) ?? 0;
        return el('li', {}, `${name} ${formatValue(c.value, dec)} ${unit}, usually ${formatValue(c.baseline_mean, dec)} ${unit}`);
      })));
  }
  if (key === 'bone') {
    const site = (state.config.bone_sites || []).find((x) => x.id === s.bone.worst_site_id);
    return el('div', {},
      el('p', {}, `Worst projected loss: ${formatValue(s.bone.worst_loss_pct, 1)}% at ${site ? site.name : s.bone.worst_site_id}. Projected from published loss rates, not a scan.`),
      el('p', {}, 'Status: ', statusBadge(s.bone.status)),
      el('a', { class: 'btn', href: 'trends.html' }, 'Bone trends'));
  }
  // radiation
  const r = s.radiation;
  return el('div', {},
    el('p', {}, `Mission dose so far ${formatValue(r.mission_dose_msv, 1)} mSv (estimated), ${formatValue(r.pct_of_limit, 1)}% of the career limit.`),
    r.active_event ? el('p', {}, 'A solar particle event is in progress.') : null,
    el('a', { class: 'btn', href: 'radiation.html' }, 'Radiation details'));
}

// ---- Body map: figure and chips show the same regions; the detail panel lists one card per reading ----

// The body map starts empty: every part shows "No reading" until today's check-in.
// Older readings stay visible in the 14-day trend and on the rest of the page.
function checkedInToday(s) {
  const t = s && s.checkin && s.checkin.taken_at;
  return Boolean(t) && utcDay(t) === utcDay(Date.now());
}

function bodyView(s) {
  if (!s || checkedInToday(s)) return s;
  return {
    ...s,
    regions: (s.regions || []).map((r) => ({ ...r, status: 'missing' })),
    indicators: (s.indicators || []).map((i) => ({ ...i, value: null, status: 'missing', delta_pct: null })),
  };
}

function shapeFor(id) {
  return document.querySelector(`#body-map [data-region="${id}"]`);
}

// Regions in display order, only those drawn on the figure (arrow keys follow this order).
function figureOrder() {
  if (!state.status) return [];
  return orderedRegions(bodyView(state.status)).map((r) => r.id).filter((id) => shapeFor(id));
}

// Wired once: the figure and the chips keep their listeners across re-renders.
function wireBodyMap() {
  for (const shape of document.querySelectorAll('#body-map [data-region]')) {
    shape.addEventListener('click', () => selectRegion(shape.dataset.region));
    shape.addEventListener('keydown', (e) => onRegionKey(e, shape));
    shape.addEventListener('pointerenter', () => showTip(shape));
    shape.addEventListener('pointerleave', () => { if (document.activeElement !== shape) hideTip(); });
    shape.addEventListener('focus', () => showTip(shape));
    shape.addEventListener('blur', hideTip);
  }
}

function onRegionKey(e, shape) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectRegion(shape.dataset.region);
    return;
  }
  if (e.key === 'Escape') {
    hideTip();
    return;
  }
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const ids = figureOrder();
  const i = ids.indexOf(shape.dataset.region);
  const next = ids[Math.max(0, Math.min(ids.length - 1, i + step))];
  if (next) shapeFor(next).focus();
}

// Tooltip inside the map container: region name, status word and the readings.
function showTip(shape) {
  const s = bodyView(state.status);
  if (!s) return;
  const id = shape.dataset.region;
  const region = regionInfo(s, id);
  const readings = s.indicators.filter((i) => i.body_region_id === id);
  const tip = $('body-tip');
  tip.replaceChildren(
    el('strong', {}, region.name),
    el('div', {}, statusBadge(region.status)),
    readings.length
      ? el('ul', { class: 'tip-list' }, readings.map((i) => el('li', {},
        i.value === null || i.value === undefined
          ? `${i.name}: no reading`
          : `${i.name} ${formatValue(i.value, i.decimals)} ${i.unit}`)))
      : el('p', {}, 'No readings for this part.'),
  );
  tip.hidden = false;
  positionTip(shape);
}

// The readout sits under the figure (see .body-tip in home.css), so it never covers a badge.
function positionTip() {}

function hideTip() {
  const tip = $('body-tip');
  tip.hidden = false;
  tip.replaceChildren(el('p', { class: 'tip-hint' }, 'Point at or tab to a body part to see its readings here.'));
}

function renderBodyMap(status) {
  const s = bodyView(status);
  for (const shape of document.querySelectorAll('#body-map [data-region]')) {
    const r = regionInfo(s, shape.dataset.region);
    shape.setAttribute('data-fill-status', r.status);
    shape.setAttribute('aria-label', `${r.name}: ${STATUS_LABEL[r.status] || r.status}`);
    paintHatch(shape, r.status);
  }
  buildChips(s);
  paintSelection();
  renderRegionDetail(s);
}

// Copies each visible shape with the hatch pattern on top, for caution and warning only.
function paintHatch(shape, status) {
  shape.querySelectorAll(':scope > .hatch-overlay').forEach((n) => n.remove());
  const pattern = HATCH[status];
  if (!pattern) return;
  for (const child of shape.querySelectorAll(':scope > .shape')) {
    const overlay = child.cloneNode(false);
    const strokeOnly = child.classList.contains('line') || child.classList.contains('outline');
    overlay.setAttribute('class', 'hatch-overlay');
    overlay.style.fill = strokeOnly ? 'none' : `url(#${pattern})`;
    overlay.style.stroke = strokeOnly ? `url(#${pattern})` : 'none';
    overlay.setAttribute('aria-hidden', 'true');
    shape.append(overlay);
  }
}

function buildChips(s) {
  const regions = orderedRegions(s);
  const groups = [
    ['Head and senses', ['head', 'eyes', 'ears']],
    ['Chest and abdomen', ['heart', 'lungs', 'abdomen', 'kidneys']],
    ['Movement and whole body', ['spine', 'hips', 'arms', 'legs', 'whole_body']],
  ];
  $('region-chips').replaceChildren(...groups.map(([label, ids]) => el('section', { class: 'region-group', 'aria-label': label },
    el('h3', {}, label),
    el('div', { class: 'region-group__items' }, ids.map((id) => regions.find((r) => r.id === id)).filter(Boolean).map((r) => el('button', {
      type: 'button', class: 'region-chip', 'data-region-btn': r.id, onclick: () => selectRegion(r.id),
    }, el('span', {}, r.name), statusBadge(r.status)))))));
}

function paintSelection() {
  for (const shape of document.querySelectorAll('#body-map [data-region]')) {
    shape.setAttribute('aria-pressed', String(shape.dataset.region === state.regionId));
  }
  for (const btn of document.querySelectorAll('[data-region-btn]')) {
    btn.setAttribute('aria-pressed', String(btn.dataset.regionBtn === state.regionId));
  }
}

function selectRegion(id) {
  state.regionId = id;
  paintSelection();
  renderRegionDetail(bodyView(state.status));
}

function renderRegionDetail(s) {
  const box = $('region-detail');
  if (!s || !state.regionId) {
    box.replaceChildren(el('p', { class: 'muted' }, 'Choose a body part on the figure or from the chips to see its readings.'));
    return;
  }
  const region = regionInfo(s, state.regionId);
  const cfg = (state.config.body_regions || []).find((r) => r.id === region.id);
  const inds = s.indicators.filter((i) => i.body_region_id === region.id);
  const hasBone = (state.config.bone_sites || []).some((b) => b.body_region_id === region.id);
  const token = ++state.detailToken;
  box.replaceChildren(...[
    el('div', { class: 'ind__head' }, el('h3', {}, region.name), statusBadge(region.status)),
    cfg && cfg.description ? el('p', { class: 'muted' }, cfg.description) : null,
    // Optional per-region advisory from the data (body_regions.alert), e.g. the eye risk on long missions.
    cfg && cfg.alert ? el('p', { class: 'notice', 'data-status': 'advisory' }, el('strong', {}, `${region.name}: spaceflight risk. `), cfg.alert) : null,
    checkedInToday(state.status) ? null : el('p', { class: 'state' }, "No check-in today yet. Today's readings appear here after the check-in."),
    inds.length
      ? el('div', { class: 'stack' }, inds.map((i) => indicatorCard(i)))
      : el('p', { class: 'muted' }, hasBone ? 'Bone loss here is a projection. See Bone below.' : 'No readings for this area yet.')].filter((c) => c != null && c !== false));
  if (inds.length) fillTrends(token, box, inds);
}

function indicatorCard(i) {
  const cfg = indicatorById(state.config, i.indicator_id);
  const r = i.range || {};
  const explain = cfg && (cfg.why_it_matters || cfg.how_to_measure);
  const src = cfg && (state.config.sources || []).find((x) => x.id === cfg.source_ref);
  return el('article', { class: 'ind-card' },
    el('div', { class: 'ind__head' }, el('h4', {}, i.name), statusBadge(i.status)),
    el('p', { class: 'ind-value' }, el('span', { class: 'metric__value' }, valueText(i, cfg))),
    el('p', { class: 'muted' }, deltaText(i)),
    rangeGauge(i, cfg),
    el('p', {}, `Normal range: ${rangeText(i, cfg)}.`),
    r.adjusted ? el('p', { class: 'notice', 'data-status': 'advisory' }, el('strong', {}, 'Normal for space. '), r.note) : null,
    el('div', { class: 'spark-slot', 'data-spark': i.indicator_id }, el('p', { class: 'state' }, 'Loading the 14-day trend…')),
    cfg ? el('div', { class: 'btn-row' }, measureButton(cfg)) : null,
    explain
      ? el('details', { class: 'more' },
        el('summary', {}, 'Why it matters and how it is measured'),
        cfg.why_it_matters ? el('p', {}, cfg.why_it_matters) : null,
        cfg.how_to_measure ? el('ol', { class: 'plain-steps' }, cfg.how_to_measure.split('\n').map((x) => el('li', {}, x))) : null,
        src ? el('h5', {}, 'Source') : null,
        src ? el('p', {}, src.url ? el('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.title) : src.title) : null,
        src && src.note ? el('p', { class: 'muted' }, src.note) : null)
      : null,
  );
}

function measureButton(cfg) {
  return el('button', {
    type: 'button',
    class: 'btn',
    'data-diagram': hasDiagram(cfg.id) ? 'true' : 'false',
    onclick: () => { openMeasureDialog(cfg).catch(() => {}); },
  }, 'How to measure');
}

// Range bar: caution and warning zones around the normal band, each labelled with its bounds in words.
function rangeGauge(i, cfg) {
  const r = i.range || {};
  const f = (v) => formatValue(v, i.decimals);
  const unit = cfg && cfg.input_type === 'scale' ? '' : ` ${i.unit}`;
  const W = 300;
  const PAD = 10;
  const bounds = [r.critical_low, r.normal_low, r.normal_high, r.critical_high].filter((v) => v !== null && v !== undefined);
  const pts = i.value === null || i.value === undefined ? bounds : [...bounds, i.value];
  if (!pts.length) return el('p', { class: 'muted' }, 'No usual range set.');
  let lo = Math.min(...pts);
  let hi = Math.max(...pts);
  if (hi === lo) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.08;
  hi += span * 0.08;
  const X = (v) => PAD + ((v - lo) / (hi - lo)) * (W - 2 * PAD);

  const nlE = r.normal_low ?? r.critical_low ?? lo;
  const nhE = r.normal_high ?? r.critical_high ?? hi;
  const segs = [];
  const add = (a, b, status, text) => { if (b > a) segs.push({ a, b, status, text }); };
  if (r.critical_low !== null && r.critical_low !== undefined) {
    add(lo, r.critical_low, 'alert', `${STATUS_LABEL.alert} below ${f(r.critical_low)}${unit}`);
    add(r.critical_low, nlE, 'watch', `${STATUS_LABEL.watch} ${f(r.critical_low)} to ${f(nlE)}${unit}`);
  } else {
    add(lo, nlE, 'watch', `${STATUS_LABEL.watch} below ${f(nlE)}${unit}`);
  }
  add(nlE, nhE, 'normal', `${STATUS_LABEL.normal} ${f(nlE)} to ${f(nhE)}${unit}`);
  if (r.critical_high !== null && r.critical_high !== undefined) {
    add(nhE, r.critical_high, 'watch', `${STATUS_LABEL.watch} ${f(nhE)} to ${f(r.critical_high)}${unit}`);
    add(r.critical_high, hi, 'alert', `${STATUS_LABEL.alert} above ${f(r.critical_high)}${unit}`);
  } else {
    add(nhE, hi, 'watch', `${STATUS_LABEL.watch} above ${f(nhE)}${unit}`);
  }

  const readText = segs.map((g) => g.text).join('. ') + (r.adjusted && r.note ? `. ${r.note}` : '');
  const svg = svgEl('svg', {
    class: 'chart gauge',
    viewBox: '0 0 300 62',
    role: 'img',
    tabindex: '0',
    focusable: 'true',
    'aria-label': `Range for ${i.name}. ${readText}`,
  });
  for (const g of segs) {
    svg.append(svgEl('rect', { class: `zone zone-${g.status}`, x: X(g.a), y: 8, width: X(g.b) - X(g.a), height: 20 }));
  }
  for (const v of bounds) {
    svg.append(svgEl('line', { class: 'axis', x1: X(v), x2: X(v), y1: 4, y2: 32 }));
    svg.append(svgEl('text', { class: 'axis-label', x: X(v), y: 52, 'text-anchor': 'middle' }, f(v)));
  }
  if (i.value !== null && i.value !== undefined) {
    svg.append(svgEl('rect', { class: 'gauge-marker', x: X(i.value) - 2, y: 2, width: 4, height: 30 }));
  }
  const readout = el('p', { class: 'gauge-readout', hidden: true }, readText);
  const show = () => { readout.hidden = false; };
  const hide = () => { readout.hidden = true; };
  svg.addEventListener('pointerenter', show);
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('focus', show);
  svg.addEventListener('blur', hide);
  return el('div', { class: 'gauge-wrap' }, svg, readout);
}

// 14-day history: fetched once per crew member and kept.
function historyFor(id) {
  if (!state.history.has(id)) {
    const p = api.history(id, 14).catch((err) => {
      state.history.delete(id); // allow a retry next time
      throw err;
    });
    state.history.set(id, p);
  }
  return state.history.get(id);
}

function sparkSeries(hist, id) {
  return (hist.points || [])
    .filter((p) => p.values && p.values[id] !== null && p.values[id] !== undefined)
    .map((p) => ({ day: p.mission_day, value: p.values[id], anomaly: Boolean(p.is_anomaly) }));
}

async function fillTrends(token, box, inds) {
  let hist = null;
  try {
    hist = await historyFor(state.astronautId);
  } catch {
    hist = null;
  }
  if (token !== state.detailToken) return;
  for (const i of inds) {
    const slot = box.querySelector(`[data-spark="${i.indicator_id}"]`);
    if (!slot) continue;
    const cfg = indicatorById(state.config, i.indicator_id);
    const series = hist ? sparkSeries(hist, i.indicator_id) : [];
    slot.replaceChildren(series.length > 1
      ? sparkline(series, i, cfg)
      : el('p', { class: 'muted' }, hist ? 'Not enough check-ins for a 14-day trend yet.' : 'The trend is not available right now.'));
  }
}

function diamond(x, y, r) {
  return `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
}

// Mini line chart: hover or arrow keys read one day; unusual check-ins are diamonds.
function sparkline(series, i, cfg) {
  const W = 300;
  const H = 96;
  const P = 12;
  const dmin = Math.min(...series.map((p) => p.day));
  const dmax = Math.max(...series.map((p) => p.day));
  let vmin = Math.min(...series.map((p) => p.value));
  let vmax = Math.max(...series.map((p) => p.value));
  if (vmax === vmin) { vmin -= 1; vmax += 1; }
  const pad = (vmax - vmin) * 0.12;
  vmin -= pad;
  vmax += pad;
  const X = (d) => (dmax === dmin ? W / 2 : P + ((d - dmin) / (dmax - dmin)) * (W - 2 * P));
  const Y = (v) => H - P - ((v - vmin) / (vmax - vmin)) * (H - 2 * P);
  const fmt = (p) => `Day ${p.day}: ${valueOut(p.value, i, cfg)}${p.anomaly ? ' · unusual for you' : ''}`;

  const svg = svgEl('svg', {
    class: 'chart spark',
    viewBox: `0 0 ${W} ${H}`,
    role: 'img',
    tabindex: '0',
    focusable: 'true',
    'aria-label': `14-day trend for ${i.name}. Use the left and right arrow keys to read each day.`,
  });
  const cursor = svgEl('line', { class: 'axis spark-cursor', x1: 0, x2: 0, y1: 4, y2: H - 4, visibility: 'hidden' });
  svg.append(
    svgEl('polyline', { class: 'series', points: series.map((p) => `${X(p.day).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ') }),
    cursor,
    ...series.map((p) => (p.anomaly
      ? svgEl('path', { class: 'spark-anomaly', 'data-fill-status': 'watch', d: diamond(X(p.day), Y(p.value), 6) })
      : svgEl('circle', { class: 'spark-dot', cx: X(p.day).toFixed(1), cy: Y(p.value).toFixed(1), r: 3 }))),
  );

  const readout = el('p', { class: 'spark-readout' });
  let idx = series.length - 1;
  const paint = (k) => {
    idx = Math.max(0, Math.min(series.length - 1, k));
    const p = series[idx];
    cursor.setAttribute('x1', X(p.day).toFixed(1));
    cursor.setAttribute('x2', X(p.day).toFixed(1));
    cursor.setAttribute('visibility', 'visible');
    readout.textContent = fmt(p);
  };
  const rest = () => {
    cursor.setAttribute('visibility', 'hidden');
    readout.textContent = `Latest · ${fmt(series[series.length - 1])}`;
  };
  rest();

  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const vx = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    series.forEach((p, k) => {
      if (Math.abs(X(p.day) - vx) < Math.abs(X(series[best].day) - vx)) best = k;
    });
    paint(best);
  });
  svg.addEventListener('pointerleave', rest);
  svg.addEventListener('focus', () => paint(idx));
  svg.addEventListener('blur', rest);
  svg.addEventListener('keydown', (e) => {
    const moves = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -Infinity, End: Infinity };
    const step = moves[e.key];
    if (step === undefined) return;
    e.preventDefault();
    if (step === -Infinity) paint(0);
    else if (step === Infinity) paint(series.length - 1);
    else paint(idx + step);
  });

  return el('div', { class: 'spark-wrap' },
    el('p', { class: 'spark-title' }, `Last 14 days, mission days ${dmin} to ${dmax}. Diamonds mark unusual check-ins.`),
    svg,
    readout);
}

// ---- Mission distance: Earth and one node per mission, placed by log distance ----

function fmtReply(delaySeconds) {
  return fmtDelay(2 * delaySeconds);
}

function distNote(missionId) {
  const m = missionById(state.config, missionId);
  $('dist-note').textContent = m
    ? `Signal takes ${fmtDelay(m.comms_delay_s)} each way · reply in about ${fmtReply(m.comms_delay_s)}`
    : '';
}

// Sorted 0..1 positions pushed apart so neighbours are at least `gap` apart (Earth sits at 0).
// Places at nearly the same distance (Moon base, rover) would otherwise sit on top of each other.
export function spreadPositions(ps, gap) {
  const out = [];
  ps.forEach((p, i) => out.push(Math.max(p, (i ? out[i - 1] : 0) + gap)));
  for (let i = out.length - 1; i >= 0; i -= 1) out[i] = Math.min(out[i], i === out.length - 1 ? 1 : out[i + 1] - gap);
  return out;
}

// Nodes are sorted by distance. Arrow keys move focus between them, Enter or Space selects.
function renderMissionControl() {
  const host = $('mission-control');
  const focusedId = host.contains(document.activeElement) ? document.activeElement.dataset.mission : null;
  const missions = [...(state.config.missions || [])].sort((a, b) => a.distance_km - b.distance_km);
  const realId = state.status ? state.status.astronaut.mission_id : null;
  const logOf = (km) => Math.log10(Math.max(km, 1));
  const lo = 1.5; // about 30 km: Earth sits at the left end
  const hi = Math.max(lo + 1, ...missions.map((m) => logOf(m.distance_km))) + 0.25;
  const pos = (m) => (logOf(m.distance_km) - lo) / (hi - lo);
  const ps = spreadPositions(missions.map(pos), 0.15);

  const nodes = missions.map((m, i) => {
    const p = ps[i];
    const edge = p < 0.12 ? ' edge-start' : p > 0.88 ? ' edge-end' : '';
    return el('button', {
      type: 'button',
      class: `dist-node${edge}${i % 2 ? ' dist-node--up' : ''}`, // alternate labels above/below so neighbours never collide
      'data-mission': m.id,
      'data-here': m.id === realId ? 'true' : null,
      'aria-pressed': String(m.id === state.missionId),
      style: `--p: ${p.toFixed(3)}`,
      onclick: () => selectMission(m.id),
    }, el('span', { class: 'dist-label' },
      el('strong', {}, m.name),
      el('span', { class: 'dist-delay' }, `${fmtDelay(m.comms_delay_s)} one way`),
      m.id === realId ? el('span', { class: 'dist-here' }, 'You are here') : null));
  });

  host.replaceChildren(
    el('span', { class: 'dist-line', 'aria-hidden': 'true' }),
    el('span', { class: 'dist-earth edge-start', style: '--p: 0', 'aria-hidden': 'true' },
      el('span', { class: 'dist-label' }, el('strong', {}, 'Earth'))),
    el('span', { class: 'dist-signal', style: '--p: 0', 'aria-hidden': 'true' }),
    ...nodes,
  );
  if (focusedId) {
    const node = host.querySelector(`[data-mission="${focusedId}"]`);
    if (node) node.focus();
  }
  distNote(state.missionId);
}

function onDistKey(e) {
  const nodes = [...$('mission-control').querySelectorAll('.dist-node')];
  const i = nodes.indexOf(e.target);
  if (i === -1) return;
  const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity };
  const step = moves[e.key];
  if (step === undefined) return;
  e.preventDefault();
  const next = step === -Infinity ? 0 : step === Infinity ? nodes.length - 1 : Math.max(0, Math.min(nodes.length - 1, i + step));
  nodes[next].focus();
}

// Selecting a node: the what-if re-fetches the status (chooseMission), then a signal dot travels there and back.
function selectMission(missionId) {
  chooseMission(missionId);
  pulseSignal(missionId);
}

// Duration is scaled, not real time: 0.6 s for the shortest delay up to 3 s for the longest.
function signalDuration(delaySeconds) {
  const t = Math.log10(delaySeconds + 1) / Math.log10(1320 + 1);
  return Math.round(Math.max(600, Math.min(3000, 600 + 2400 * t)));
}

function pulseSignal(missionId) {
  const m = missionById(state.config, missionId);
  if (!m || reduceMotion()) return;
  const host = $('mission-control');
  const dot = host.querySelector('.dist-signal');
  const node = host.querySelector(`[data-mission="${missionId}"]`);
  const earth = host.querySelector('.dist-earth');
  if (!dot || !node || !earth || !dot.animate) return;
  const a = earth.getBoundingClientRect();
  const b = node.getBoundingClientRect();
  const dx = (b.left + b.width / 2) - (a.left + a.width / 2);
  const dy = (b.top + b.height / 2) - (a.top + a.height / 2);
  dot.getAnimations().forEach((an) => an.cancel());
  dot.animate([
    { translate: '0px 0px', opacity: 1 },
    { translate: `${dx}px ${dy}px`, opacity: 1, offset: 0.5 },
    { translate: '0px 0px', opacity: 0 },
  ], { duration: signalDuration(m.comms_delay_s), easing: 'ease-in-out' });
}

// A what-if re-renders only the master alert, the triage and the mission label.
async function chooseMission(missionId) {
  if (!state.status || missionId === state.missionId) return;
  const previous = state.missionId;
  state.missionId = missionId;
  renderMissionControl();

  const token = ++state.missionToken;
  $('triage').replaceChildren(el('p', { class: 'state' }, 'Loading…'));
  try {
    const shown = await api.status(state.astronautId, missionId);
    if (token !== state.missionToken) return;
    renderMasterAlert(shown);
    renderTriage(shown);
    renderMissionLabel(shown);
  } catch (err) {
    if (token !== state.missionToken) return;
    state.missionId = previous;
    renderMissionControl();
    showError($('triage'), err);
  }
}

function renderMissionLabel(s) {
  const m = s.mission;
  const realName = (state.config.missions || []).find((x) => x.id === s.astronaut.mission_id);
  const nodes = [
    el('p', {}, el('strong', {}, `Guidance for ${m.name}`),
      ` · signal delay ${fmtDelay(m.comms_delay_s)} each way · ${CONSULT_TEXT[m.consult_mode] || m.consult_mode}`),
  ];
  if (m.id !== s.astronaut.mission_id) {
    nodes.push(el('p', { class: 'notice' },
      `What-if: showing guidance as if the crew were at ${m.name}. Real mission: ${realName ? realName.name : s.astronaut.mission_id}.`));
  }
  $('mission-label').replaceChildren(...nodes);
}

// ---- Triage: headline, contact, numbered steps, most severe guidance first ----

function severityRank(g) {
  return g.severity === 'alert' ? 0 : 1;
}

function renderTriage(s) {
  const t = s.triage;
  const crew = t.consult_mode === 'crew_led';

  const delayLine = crew
    ? el('p', { class: 'notice', 'data-status': 'advisory' },
      `Reply from ground takes about ${t.reply_minutes} min. Act on this protocol first.`)
    : el('p', { class: 'muted' }, `Signal delay ${fmtDelay(s.mission.comms_delay_s)} each way.`);

  const sorted = [...(t.guidance || [])].sort((a, b) => severityRank(a) - severityRank(b));
  const [first, ...rest] = sorted;
  const guidance = sorted.length
    ? el('div', { class: 'stack' },
      guidanceCard(s, first),
      rest.length
        ? el('details', { class: 'more' },
          el('summary', {}, `Show ${rest.length} more ${plural(rest.length, 'reading', 'readings')} outside the usual range`),
          el('div', { class: 'stack' }, rest.map((g) => guidanceCard(s, g))))
        : null)
    : el('p', { class: 'muted' }, t.level >= 1
      // The level can come from the personal pattern, bone or stale data, not only from a flagged reading.
      ? 'No single reading is outside its usual range. See "Why this score" for what raised this level.'
      : "No guidance needed for today's readings.");

  $('triage').replaceChildren(
    el('p', { class: 'muted' }, `Triage level ${t.level} of 3 · ${CONSULT_TEXT[t.consult_mode] || t.consult_mode}`),
    el('div', { class: 'headline' }, statusBadge(t.level >= 2 ? 'alert' : t.level === 1 ? 'watch' : 'normal'),
      el('h3', {}, plainHeadline(t.headline))),
    delayLine,
    el('p', {}, el('strong', {}, 'Who to contact: '), t.contact),
    renderSteps(s),
    guidance,
  );
}

// Checked state is kept per crew member, day, triage level and consult mode. Storage may be unavailable.
function stepStoreKey(s) {
  const day = new Date().toISOString().slice(0, 10);
  return `astro.steps.${s.astronaut.id}.${day}.${s.triage.level}.${s.triage.consult_mode}`;
}

function readChecks(key, n) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(v) && v.length === n) return v.map(Boolean);
  } catch {
    // Storage unavailable or corrupt: start again.
  }
  return new Array(n).fill(false);
}

function writeChecks(key, checks) {
  try { localStorage.setItem(key, JSON.stringify(checks)); } catch { /* storage unavailable */ }
}

function renderSteps(s) {
  const items = s.triage.instructions || [];
  if (!items.length) return null;
  const key = stepStoreKey(s);
  const checks = readChecks(key, items.length);
  const list = el('ol', { class: 'steps', 'aria-label': 'Steps to follow' },
    items.map((text, i) => {
      const box = el('input', { type: 'checkbox' });
      box.checked = checks[i];
      return el('li', {}, el('label', {}, box, el('span', { class: 'step-text' }, text)));
    }));
  const done = el('p', { class: 'notice', 'data-status': 'normal', role: 'status' }, 'All steps done.');
  const wrap = el('div', {}, list, done);
  list.addEventListener('change', () => {
    const boxes = [...list.querySelectorAll('input')];
    writeChecks(key, boxes.map((b) => b.checked));
    paintSteps(wrap);
  });
  paintSteps(wrap);
  return wrap;
}

// Done steps are checked; the first unchecked step is current; the rest carry no attribute.
function paintSteps(wrap) {
  const lis = [...wrap.querySelectorAll('ol.steps > li')];
  const boxes = lis.map((li) => li.querySelector('input'));
  const firstOpen = boxes.findIndex((b) => !b.checked);
  lis.forEach((li, i) => {
    if (boxes[i].checked) li.dataset.step = 'done';
    else if (i === firstOpen) li.dataset.step = 'current';
    else delete li.dataset.step;
  });
  wrap.querySelector('.notice').hidden = firstOpen !== -1;
}

function guidanceCard(s, g) {
  const ind = s.indicators.find((i) => i.indicator_id === g.indicator_id);
  const cfg = indicatorById(state.config, g.indicator_id);
  const name = (ind && ind.name) || (cfg && cfg.name) || g.indicator_id;
  const protocol = g.protocol && g.protocol.length
    ? el('div', { class: 'protocol' },
      el('h5', {}, 'Protocol steps'),
      el('ol', {}, g.protocol.map((x) => el('li', {}, x))))
    : null;
  return el('article', { class: 'guidance' },
    el('div', { class: 'ind__head' }, el('h4', {}, name), statusBadge(g.severity)),
    el('p', {}, g.summary),
    el('h5', {}, 'Self-care'),
    el('ul', {}, (g.self_care || []).map((x) => el('li', {}, x))),
    protocol,
  );
}

// ---- Radiation and bone summaries ----

function renderSummaries(s) {
  const r = s.radiation;
  const b = s.bone;
  const site = (state.config.bone_sites || []).find((x) => x.id === b.worst_site_id);

  $('radiation').replaceChildren(...[
    r.active_event
      ? el('div', { class: 'notice', 'data-status': 'radiation', role: 'status' },
        el('strong', {}, 'Solar particle event in progress. '),
        `Go to ${state.zoneName || r.recommended_zone_id || 'the shelter'}.`)
      : null,
    el('p', {}, 'Mission dose so far: ', el('strong', {}, `${formatValue(r.mission_dose_msv, 1)} mSv`), ' (estimated)'),
    el('p', { class: 'muted' }, `${formatValue(r.pct_of_limit, 1)}% of the career limit · today ${formatValue(r.today_msv, 2)} mSv`),
    el('p', { class: 'estimate-note' }, 'Estimated from a simplified shielding model.')].filter((c) => c != null && c !== false));

  $('bone').replaceChildren(
    el('p', {}, 'Worst projected loss: ', el('strong', {}, `${formatValue(b.worst_loss_pct, 1)}%`),
      ` (${site ? site.name : b.worst_site_id}) `, statusBadge(b.status)),
    el('p', { class: 'estimate-note' }, 'Projected from published loss rates, not a scan.'),
  );
}

boot();
