// Radiation page: storm status, habitat zone map, estimated crew dose, solar events.
// Data: api.radiation (docs/CONTRACT.md section 5). Doses are estimates from a simplified model (section 4.4).
import { initShell, el, showError, formatValue, formatDateTime, missionById, masterAlert, statusBadge, dateLocale } from './shell.js';
import { api } from './api.js';

const NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86400000;
const DEFAULT_SEP_HOURS = 24;
const MAP_W = 100; // zone geometry (CONTRACT section 5 example) sits on a 100 x 60 grid
const MAP_H = 60;
const MODEL_NOTE = 'Estimate from a simplified shielding model.';
const SOURCE_LABEL = { donki: 'NASA DONKI', gbm: 'Fermi GBM flare list', sample: 'Sample record', sim: 'Simulated for the demo' };
const LEARN_IDS = ['csa_radiation', 'hrp_hazards', 'donki', 'gbm', 'iss_tepc', 'radlab'];
const DOSE_TEXT = { 1: 'lower dose', 2: 'middle dose', 3: 'higher dose' };

const main = document.getElementById('content');
const state = { config: null, missionId: null, data: null, zoneId: null, zoneEls: new Map(), seq: 0 };

// Charts measure their slot and redraw at that width, so text stays readable at 360 px and 1440 px.
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

const fmt = (v, d = 1) => formatValue(v, d);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function param(key, fallback) {
  const v = state.config && state.config.params ? state.config.params[key] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function zoneById(id) {
  return ((state.data && state.data.zones) || []).find((z) => z.id === id) || null;
}

function eventEnd(e) {
  if (e.end_time) return Date.parse(e.end_time);
  return Date.parse(e.start_time) + param('rad.sep_default_duration_h', DEFAULT_SEP_HOURS) * 3600000;
}

// True when a dose-relevant event overlaps this UTC day (YYYY-MM-DD).
function isStormDay(day, events) {
  const start = Date.parse(`${day}T00:00:00Z`);
  const end = start + DAY_MS;
  return (events || []).some((e) => e.dose_relevant && Date.parse(e.start_time) < end && eventEnd(e) > start);
}

function shortDate(day) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

// Tick values with round steps (1, 2, 2.5, 5 x 10^n).
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

// Three equal bands of the range: 1 lower, 2 middle, 3 higher relative dose (magenta fills, HIDH p. 1064).
function doseBand(value, min, max) {
  if (!(max > min)) return 1;
  const t = (value - min) / (max - min);
  return t < 1 / 3 ? 1 : t < 2 / 3 ? 2 : 3;
}

// Greedy word wrap for zone names, so a name fits its zone at 13 px.
function wrapText(text, maxPx) {
  const max = Math.max(6, Math.floor(maxPx / 7.5));
  const lines = [];
  for (const word of String(text || '').split(/\s+/).filter(Boolean)) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + 1 + word.length <= max) lines[last] = `${lines[last]} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function selectZone(id) {
  state.zoneId = id;
  for (const [zid, g] of state.zoneEls) {
    const on = zid === id;
    g.classList.toggle('zone--selected', on);
    g.setAttribute('aria-pressed', String(on));
  }
  document.querySelectorAll('.zone-compare__row').forEach((row) => {
    const on = row.dataset.zoneRow === id;
    row.classList.toggle('zone-compare__row--selected', on);
    row.setAttribute('aria-pressed', String(on));
  });
  const panel = document.getElementById('zone-details');
  if (panel) panel.replaceChildren(zoneDetails(zoneById(id)));
}

function goToZone(id) {
  selectZone(id);
  const g = state.zoneEls.get(id);
  if (g) {
    g.scrollIntoView({ block: 'center', behavior: 'smooth' });
    g.focus();
  }
}

function fact(label, value) {
  return [el('dt', {}, label), el('dd', {}, value)];
}

function zoneDetails(z) {
  if (!z) return el('p', { class: 'muted' }, 'Select a zone on the map to see its details.');
  return el('div', {},
    el('h3', {}, z.name),
    el('dl', { class: 'facts' },
      fact('Shielding', `${fmt(z.shielding_g_cm2, 1)} g/cm²`),
      fact('Background (estimated)', `${fmt(z.background_msv_per_day, 2)} mSv/day`),
      // event_msv_per_h is the rate for the active event only, so it is 0 when no event is running.
      fact('Solar particle dose rate now (estimated)', Number(z.event_msv_per_h) > 0
        ? `${fmt(z.event_msv_per_h, 2)} mSv/h` : `${fmt(0, 2)} mSv/h · no active event`)),
    z.is_shelter ? el('p', { class: 'muted' }, 'Shelter: the most-shielded area. It is the recommended place during a solar particle event.') : null,
    el('details', { class: 'more' },
      el('summary', {}, 'Show description and typical hours'),
      el('div', {},
        z.description ? el('p', { class: 'muted' }, z.description) : null,
        el('dl', { class: 'facts' }, fact('Typical time here', `${fmt(z.default_hours, 1)} h/day`)))));
}

// Drawn at the slot's real width, so zone text is 13 px like the other chart text.
function habitatMap(d, zones, width) {
  const doseOf = (z) => (d.active_event ? z.event_msv_per_h : z.background_msv_per_day);
  const values = zones.map(doseOf);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const unit = d.active_event ? 'mSv/h' : 'mSv/day';
  const k = width / MAP_W;
  const board = svg('svg', {
    viewBox: `0 0 ${width} ${(MAP_H * k).toFixed(1)}`,
    class: 'chart habitat',
    role: 'group',
    'aria-label': 'Habitat floor plan',
  });
  state.zoneEls = new Map();
  for (const z of [...zones].sort((a, b) => a.display_order - b.display_order)) {
    const value = doseOf(z);
    const band = doseBand(value, min, max);
    const zx = z.x * k;
    const zy = z.y * k;
    const zw = z.w * k;
    const zh = z.h * k;
    const nameLines = wrapText(z.name, zw - 12);
    const g = svg('g', {
      class: 'zone',
      role: 'button',
      tabindex: 0,
      'data-zone': z.id,
      'aria-label': `${z.name}. ${DOSE_TEXT[band]}. Estimated ${fmt(value, 2)} ${unit}.${z.is_shelter ? ' Shelter.' : ''}`,
      'aria-pressed': String(z.id === state.zoneId),
    });
    g.append(svg('rect', {
      x: zx, y: zy, width: zw, height: zh,
      class: z.is_shelter ? 'zone-rect zone-rect--shelter' : 'zone-rect',
      'data-fill-dose': band,
    }));
    nameLines.forEach((t, i) => g.append(svg('text', { x: zx + 6, y: zy + 18 + i * 17, class: 'axis-label zone-name' }, t)));
    g.append(svg('text', { x: zx + 6, y: zy + 18 + nameLines.length * 17, class: 'axis-label zone-value' }, `${fmt(value, 2)} ${unit}`));
    if (z.is_shelter) g.append(svg('text', { x: zx + 6, y: zy + zh - 8, class: 'axis-label zone-tag' }, 'Shelter'));
    if (z.id === state.zoneId) g.classList.add('zone--selected');
    g.addEventListener('click', () => selectZone(z.id));
    g.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectZone(z.id);
      }
    });
    board.append(g);
    state.zoneEls.set(z.id, g);
  }
  return board;
}

function habitatPanel(d, zones) {
  const z = zoneById(state.zoneId);
  return el('section', { class: 'panel', 'aria-labelledby': 'habitat-title' },
    el('h2', { id: 'habitat-title' }, 'Habitat zones'),
    el('p', { class: 'muted' }, 'Teal shading compares relative dose between zones: a deeper shade means a higher dose. Radiation alerts remain magenta. Select a zone for its shielding and estimated dose rates.'),
    el('ul', { class: 'legend', 'aria-label': 'Key' },
      el('li', {}, el('span', { class: 'swatch', 'data-fill-dose': '1' }), 'Lower dose'),
      el('li', {}, el('span', { class: 'swatch', 'data-fill-dose': '2' }), 'Middle'),
      el('li', {}, el('span', { class: 'swatch', 'data-fill-dose': '3' }), 'Higher dose'),
      el('li', {}, el('span', { class: 'swatch swatch--shelter' }), 'Shelter (dashed outline)')),
    zones.length
      ? chartSlot((w) => habitatMap(d, zones, w))
      : el('p', { class: 'state' }, 'This mission has no habitat zones yet. Check the habitat data and reload.'),
    el('div', { id: 'zone-details', 'aria-live': 'polite' }, zoneDetails(z)));
}

function metric(label, value, unit) {
  return el('div', { class: 'metric' },
    el('span', { class: 'metric__label' }, label),
    el('span', { class: 'metric__value' }, value, el('span', { class: 'metric__unit' }, unit)));
}

function dailyChart(daily, events, width) {
  const H = 220;
  const L = 40;
  const R = 8;
  const T = 22;
  const B = 34;
  const pw = width - L - R;
  const ph = H - T - B;
  const ticks = niceTicks(0, Math.max(0.5, ...daily.map((p) => p.msv)) * 1.1, 4);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v) => T + ph - (v / top) * ph;
  const bw = pw / Math.max(1, daily.length);
  const barW = Math.max(2, bw * 0.7);
  const storm = daily.map((p) => isStormDay(p.day, events));
  // The tallest storm day carries the words, so colour is not the only cue.
  let peak = -1;
  daily.forEach((p, i) => { if (storm[i] && (peak < 0 || p.msv > daily[peak].msv)) peak = i; });
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${H}`,
    class: 'chart',
    role: 'img',
    'aria-label': 'Daily estimated dose for the last 30 days. Solar particle event days are highlighted. Values are in the table below the chart.',
  });
  root.append(svg('text', { x: L, y: 12, class: 'axis-label' }, 'mSv per day (estimated)'));
  for (const t of ticks) {
    root.append(
      svg('line', { x1: L, x2: width - R, y1: y(t), y2: y(t), class: 'grid-line' }),
      svg('text', { x: L - 6, y: y(t) + 4, 'text-anchor': 'end', class: 'axis-label' }, String(t)),
    );
  }
  daily.forEach((p, i) => {
    const x = L + i * bw + (bw - barW) / 2;
    root.append(svg('rect', {
      x,
      y: y(p.msv),
      width: barW,
      height: Math.max(0, y(0) - y(p.msv)),
      class: storm[i] ? 'bar-storm' : 'bar-day',
    }, svg('title', {}, `${shortDate(p.day)}: ${fmt(p.msv, 2)} mSv (estimated)${storm[i] ? ', solar particle event day' : ''}`)));
    if (i % 5 === 0) {
      root.append(svg('text', { x: x + barW / 2, y: H - 12, 'text-anchor': 'middle', class: 'axis-label' }, shortDate(p.day)));
    }
  });
  if (peak >= 0) {
    const anchor = peak < 3 ? 'start' : peak > daily.length - 4 ? 'end' : 'middle';
    root.append(svg('text', {
      x: L + peak * bw + bw / 2,
      y: y(daily[peak].msv) - 6,
      'text-anchor': anchor,
      class: 'axis-label storm-label',
    }, 'Solar particle event'));
  }
  return root;
}

function dosePanel(d) {
  const a = d.astronaut;
  const pct = clamp(Number(a.pct_of_limit) || 0, 0, 100);
  const events = d.events || [];
  const daily = a.daily || [];
  return el('section', { class: 'panel', 'aria-labelledby': 'dose-title' },
    el('h2', { id: 'dose-title' }, 'Crew dose (estimated)'),
    el('div', { class: 'metrics' },
      metric('Mission dose so far (estimated)', fmt(a.mission_dose_msv, 1), 'mSv'),
      metric('Today (estimated)', fmt(a.today_msv, 2), 'mSv')),
    el('p', {}, `${fmt(a.pct_of_limit, 1)}% of the ${a.limit_msv} mSv career limit (estimated).`),
    el('div', {
      class: 'bar-track',
      role: 'img',
      'aria-label': `${fmt(a.pct_of_limit, 1)} percent of the ${a.limit_msv} millisievert career limit, estimated`,
    }, el('span', { class: 'bar-fill', style: `width: ${pct}%` })),
    el('h3', {}, 'Daily dose, last 30 days (estimated)'),
    daily.length
      ? chartSlot((w) => dailyChart(daily, events, w))
      : el('p', { class: 'state' }, 'No daily dose yet. It appears after the first full day of exposure.'),
    el('div', { class: 'daily-key' },
      el('span', {}, el('span', { class: 'swatch swatch--day' }), 'Normal day'),
      el('span', {}, el('span', { class: 'swatch swatch--storm' }), 'Solar particle event day')),
    el('details', { class: 'more daily-details' },
      el('summary', {}, 'Show daily values as a table'),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('caption', { class: 'visually-hidden' }, 'Estimated daily dose, last 30 days, oldest first'),
        el('thead', {}, el('tr', {},
          el('th', { scope: 'col' }, 'Day'),
          el('th', { scope: 'col' }, 'Estimated dose (mSv)'),
          el('th', { scope: 'col' }, 'Solar particle event day'))),
        el('tbody', {}, daily.map((p) => el('tr', {},
          el('td', {}, shortDate(p.day)),
          el('td', {}, fmt(p.msv, 2)),
          el('td', {}, isStormDay(p.day, events) ? 'Yes' : 'No'))))))));
}

function crewName() {
  const a = state.astronauts.find((x) => x.id === state.astronautId);
  return a ? a.name : null;
}

function nonCrewPanel(missionName, ownName) {
  const who = crewName();
  return el('section', { class: 'panel' },
    el('h2', {}, 'Crew dose'),
    el('p', { class: 'muted' },
      who
        ? `Dose is shown for ${who} on their own mission (${ownName}). This view shows habitat and background rates for ${missionName} only.`
        : 'No crew member yet. Add one to the database to see personal dose.'));
}

function missionSummaryPanel(d, zones, missionName) {
  const mission = missionById(state.config, d.mission_id) || {};
  const refShield = param('rad.ref_shield_g_cm2', 20);
  const sepPeak = param('rad.sep_peak_msv_per_h', 50);
  const sepAtten = param('rad.sep_atten_g_cm2', 10);
  const gcrBase = Number(mission.gcr_msv_per_day) || 0;
  const sepExposure = mission.sep_exposure_factor != null ? Number(mission.sep_exposure_factor) : 1;
  const sev = d.active_event ? (Number(d.active_event.severity) || 1) : 1;
  const stormRateOf = (z) => {
    if (d.active_event && Number(z.event_msv_per_h) > 0) return Number(z.event_msv_per_h);
    return sepPeak * sepExposure * Math.exp(-(Number(z.shielding_g_cm2) || 0) / sepAtten) * sev;
  };
  const ordered = [...zones].sort((a, b) => (a.display_order || 0) - (b.display_order || 0));
  const routineDaily = ordered.reduce(
    (acc, z) => acc + ((Number(z.default_hours) || 0) / 24) * (Number(z.background_msv_per_day) || 0),
    0,
  );
  const shelter = zoneById(d.recommended_zone_id)
    || ordered.find((z) => z.is_shelter)
    || [...ordered].sort((a, b) => Number(b.shielding_g_cm2) - Number(a.shielding_g_cm2))[0];
  const exposed = [...ordered].sort((a, b) => Number(a.shielding_g_cm2) - Number(b.shielding_g_cm2))[0];
  const deltaShield = shelter && exposed ? Number(shelter.shielding_g_cm2) - Number(exposed.shielding_g_cm2) : 0;
  const stormDropPct = shelter && exposed && stormRateOf(exposed) > 0
    ? (1 - stormRateOf(shelter) / stormRateOf(exposed)) * 100
    : 0;
  const gcrDropPct = shelter && exposed && Number(exposed.background_msv_per_day) > 0
    ? (1 - Number(shelter.background_msv_per_day) / Number(exposed.background_msv_per_day)) * 100
    : 0;
  const maxBg = Math.max(0.01, ...ordered.map((z) => Number(z.background_msv_per_day) || 0));
  const maxStorm = Math.max(0.01, ...ordered.map((z) => stormRateOf(z)));
  const blockedPct = Math.round(clamp(1 - sepExposure, 0, 1) * 100);

  return el('section', { class: 'panel', 'aria-labelledby': 'context-title' },
    el('h2', { id: 'context-title' }, 'Mission radiation & shielding summary'),
    el('p', { class: 'muted' }, `Shielding comparison, storm shelter protection gain and space-environment factors for ${missionName}.`),
    el('div', { class: 'rad-env-grid' },
      el('div', { class: 'rad-env-card' },
        el('span', { class: 'metric__label' }, 'Magnetosphere factor'),
        el('strong', { class: 'rad-env-val' }, `${fmt(sepExposure, 2)}×`),
        el('small', { class: 'muted' }, sepExposure < 1 ? `Blocks ${blockedPct}% of solar storm particles` : 'Deep space / surface (no magnetosphere shield)')),
      el('div', { class: 'rad-env-card' },
        el('span', { class: 'metric__label' }, 'Baseline GCR rate'),
        el('strong', { class: 'rad-env-val' }, `${fmt(gcrBase, 2)} mSv/day`),
        el('small', { class: 'muted' }, `At ${fmt(refShield, 0)} g/cm² reference shielding`)),
      el('div', { class: 'rad-env-card' },
        el('span', { class: 'metric__label' }, 'Routine habitat dose'),
        el('strong', { class: 'rad-env-val' }, `${fmt(routineDaily, 2)} mSv/day`),
        el('small', { class: 'muted' }, 'Weighted across 24 h default schedule'))),
    shelter && exposed && shelter.id !== exposed.id
      ? el('div', { class: 'shelter-gain' },
        el('h3', {}, 'Storm shelter protection gain'),
        el('p', { class: 'muted' },
          el('span', {}, 'Storm shelter'), ': ',
          el('strong', {}, shelter.name),
          ' · ',
          el('span', {}, 'Most exposed zone'), ': ',
          el('strong', {}, exposed.name)),
        el('div', { class: 'shelter-gain__grid' },
          el('div', { class: 'rad-env-card' },
            el('span', { class: 'metric__label' }, 'Storm dose reduction'),
            el('strong', { class: 'rad-env-val' }, `−${fmt(stormDropPct, 1)}%`),
            el('small', { class: 'muted' }, `${fmt(stormRateOf(exposed), 2)} → ${fmt(stormRateOf(shelter), 2)} mSv/h`)),
          el('div', { class: 'rad-env-card' },
            el('span', { class: 'metric__label' }, 'Extra shelter shielding'),
            el('strong', { class: 'rad-env-val' }, `+${fmt(deltaShield, 1)} g/cm²`),
            el('small', { class: 'muted' }, `${fmt(exposed.shielding_g_cm2, 1)} → ${fmt(shelter.shielding_g_cm2, 1)} g/cm²`)),
          el('div', { class: 'rad-env-card' },
            el('span', { class: 'metric__label' }, 'Daily GCR reduction'),
            el('strong', { class: 'rad-env-val' }, `−${fmt(gcrDropPct, 1)}%`),
            el('small', { class: 'muted' }, `${fmt(exposed.background_msv_per_day, 2)} → ${fmt(shelter.background_msv_per_day, 2)} mSv/day`))))
      : null,
    ordered.length
      ? el('div', { class: 'zone-compare' },
        el('div', { class: 'zone-compare__head' },
          el('h3', {}, 'Zone dose & shielding comparison'),
          el('span', { class: 'muted' }, d.active_event ? 'Live active storm rate (mSv/h)' : 'Reference SEP storm (severity 1.0)')),
        el('div', { class: 'zone-compare__list' }, ordered.map((z) => {
          const bg = Number(z.background_msv_per_day) || 0;
          const st = stormRateOf(z);
          const bgPct = clamp((bg / maxBg) * 100, 4, 100);
          const stPct = clamp((st / maxStorm) * 100, 4, 100);
          const selected = z.id === state.zoneId;
          const row = el('button', {
            type: 'button',
            class: `zone-compare__row${selected ? ' zone-compare__row--selected' : ''}`,
            'data-zone-row': z.id,
            'aria-pressed': String(selected),
            onclick: () => selectZone(z.id),
          },
          el('div', { class: 'zone-compare__top' },
            el('span', { class: 'zone-compare__name' }, z.name, z.is_shelter ? el('span', { class: 'shelter-pill' }, 'Shelter') : null),
            el('span', { class: 'muted' }, `${fmt(z.shielding_g_cm2, 1)} g/cm²`)),
          el('div', { class: 'zone-compare__bars' },
            el('div', { class: 'zone-bar-row' },
              el('span', { class: 'zone-bar-lbl' }, 'Daily GCR'),
              el('span', { class: 'zone-bar-track' }, el('span', { class: 'zone-bar-fill', style: `width:${bgPct.toFixed(1)}%` })),
              el('span', { class: 'zone-bar-val' }, `${fmt(bg, 2)} mSv/d`)),
            el('div', { class: 'zone-bar-row' },
              el('span', { class: 'zone-bar-lbl' }, 'SPE storm'),
              el('span', { class: 'zone-bar-track' }, el('span', { class: 'zone-bar-fill zone-bar-fill--storm', style: `width:${stPct.toFixed(1)}%` })),
              el('span', { class: 'zone-bar-val' }, `${fmt(st, 2)} mSv/h`))));
          return row;
        })))
      : el('p', { class: 'state' }, 'No habitat zones defined for this mission.'));
}

function sourceCell(e) {
  const label = SOURCE_LABEL[e.source] || e.source;
  return e.link
    ? el('span', {}, label, ' · ', el('a', { href: e.link, target: '_blank', rel: 'noopener' }, 'View source'))
    : label;
}

function eventsPanel(events) {
  const n = events.length;
  const body = n
    ? el('details', { class: 'more' },
      el('summary', {}, `Show ${n} recent solar ${n === 1 ? 'event' : 'events'}`),
      el('div', { class: 'table-wrap' }, el('table', { class: 'table' },
        el('caption', { class: 'visually-hidden' }, 'Solar events from the last 30 days, newest first'),
        el('thead', {}, el('tr', {},
          ['Type', 'Started', 'Class', 'Severity (0 to 1)', 'Adds to dose', 'Source'].map((h) => el('th', { scope: 'col' }, h)))),
        el('tbody', {}, events.map((e) => el('tr', {},
          el('td', {}, e.event_type),
          el('td', {}, formatDateTime(e.start_time)),
          el('td', {}, e.class_type || '–'),
          el('td', {}, fmt(e.severity, 1)),
          el('td', {}, e.dose_relevant ? 'Yes' : 'No'),
          el('td', {}, sourceCell(e))))))))
    : el('p', { class: 'state' }, 'No solar events in the last 30 days. Check again after the next update.');
  return el('section', { class: 'panel', 'aria-labelledby': 'events-title' },
    el('h2', { id: 'events-title' }, 'Recent solar events'),
    body);
}

function stormBanner(d) {
  const a = d.active_event;
  if (a) {
    const zid = d.recommended_zone_id;
    const z = zoneById(zid);
    const zoneName = z ? z.name : 'the recommended zone';
    const banner = masterAlert('radiation', 'Solar particle event in progress',
      `Go to ${zoneName}. Started ${formatDateTime(a.start_time)}, severity ${fmt(a.severity, 1)}.`);
    banner.lastElementChild.append(el('p', {},
      el('button', { type: 'button', class: 'btn btn--primary', onclick: () => goToZone(zid) }, `Go to ${zoneName}`)));
    return banner;
  }
  const last = (d.events || [])[0];
  return el('section', { class: 'notice', 'data-status': 'normal', 'aria-label': 'Solar particle event status' },
    el('p', {}, statusBadge('normal', 'No solar particle event')),
    el('p', { class: 'muted' }, last
      ? `Most recent event: ${last.event_type}${last.class_type ? ` ${last.class_type}` : ''}, started ${formatDateTime(last.start_time)}.`
      : 'No solar events in the last 30 days.'));
}

function missionSelector() {
  const missions = state.config.missions || [];
  return el('div', { class: 'mission-picker' },
    el('span', { class: 'muted', id: 'mission-label' }, 'Mission'),
    el('div', { class: 'segmented', role: 'group', 'aria-labelledby': 'mission-label' },
      missions.map((m) => el('button', {
        type: 'button',
        'aria-pressed': String(m.id === state.missionId),
        onclick: () => chooseMission(m.id),
      }, m.name))));
}

function footnote(note, events = []) {
  const sources = new Set(events.map((event) => event.source).filter(Boolean));
  const hasLiveNASA = sources.has('donki') || sources.has('gbm');
  const sourceNote = hasLiveNASA
    ? 'Recent event context includes live NASA DONKI or Fermi GBM records.'
    : sources.size
      ? 'Recent event context uses stored sample or simulated records; it is not live NASA event data.'
      : 'No recent solar-event record is included in this estimate.';
  return el('footer', { class: 'stack' },
    el('p', { class: 'estimate-note' }, MODEL_NOTE),
    el('p', { class: 'estimate-note' }, sourceNote),
    note && !MODEL_NOTE.startsWith(note.replace(/\.$/, '')) ? el('p', { class: 'estimate-note' }, note) : null);
}

function learnMore() {
  const links = LEARN_IDS.map((id) => (state.config.sources || []).find((x) => x.id === id)).filter((x) => x && x.url);
  return links.length
    ? el('details', { class: 'more' },
      el('summary', {}, `Learn more about space radiation (${links.length} links)`),
      el('ul', {}, links.map((x) => el('li', {}, el('a', { href: x.url, target: '_blank', rel: 'noopener' }, x.title)))))
    : null;
}

function render() {
  const d = state.data;
  const zones = d.zones || [];
  resizeObserver.disconnect();
  const missionName = (missionById(state.config, d.mission_id) || {}).name || d.mission_id;
  main.replaceChildren(el('div', { class: 'stack' },
    el('div', { class: 'page-head' },
      el('h1', {}, 'Radiation'),
      el('p', {}, 'Storm status, habitat zones and mission-level dose rates. No personal crew profile is used on this page.')),
    missionSelector(),
    stormBanner(d),
    el('div', { class: 'rad-grid' },
      habitatPanel(d, zones),
      missionSummaryPanel(d, zones, missionName)),
    eventsPanel(d.events || []),
    learnMore(),
    footnote(d.note, d.events || [])));
}

async function load() {
  const seq = ++state.seq;
  main.replaceChildren(el('p', { class: 'state' }, 'Loading…'));
  try {
    const data = await api.radiation(null, state.missionId);
    if (seq !== state.seq) return;
    state.data = data;
    state.missionId = data.mission_id || state.missionId;
    state.zoneId = data.recommended_zone_id || (data.zones && data.zones[0] ? data.zones[0].id : null);
    render();
  } catch (err) {
    if (seq === state.seq) showError(main, err);
  }
}

function chooseMission(id) {
  if (id === state.missionId) return;
  state.missionId = id;
  load();
}

async function start() {
  try {
    const ctx = await initShell({ page: 'radiation' });
    state.config = ctx.config;
    state.missionId = (state.config.missions || [])[0]?.id || null;
    if (!state.missionId) {
      main.replaceChildren(el('p', { class: 'state' }, 'No missions are set up yet. Run the seeder, then reload this page.'));
      return;
    }
    await load();
  } catch (err) {
    showError(main, err);
  }
}

start();
