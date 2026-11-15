import { localRecord } from './storage.js';
// Check-in page: a form built from config.indicators, checked in the browser, reviewed, then posted once.
import { api } from './api.js';
import { initShell, el, statusBadge, showError, formatValue, masterAlert, confirmAction } from './shell.js';
import { measureGuide } from './measure.js';
import { visionTest, amslerTest } from './vision-ui.js';

const REVIEW_LABEL = 'Review check-in';
const root = document.getElementById('checkin');

let config = null;
let crew = [];
let astronautId = null;
let cleanups = [];      // stop functions for interactive tests
let reactionPress = null; // set while a reaction test runs, so Space counts as a press
let configSeq = 0;

function stopAll() {
  for (const stop of cleanups) stop();
  reactionPress = null;
}

async function loadAstronautConfig(id) {
  const [cfg, status] = await Promise.all([
    api.config(id),
    api.status(id).catch(() => null),
  ]);
  if (status && Array.isArray(status.indicators)) {
    const byId = new Map(status.indicators.map((i) => [i.indicator_id, i]));
    for (const ind of cfg.indicators || []) {
      const stInd = byId.get(ind.id);
      if (stInd && stInd.range) {
        ind.range = stInd.range;
        ind.normal_low = stInd.range.normal_low;
        ind.normal_high = stInd.range.normal_high;
        ind.critical_low = stInd.range.critical_low;
        ind.critical_high = stInd.range.critical_high;
      }
    }
  }
  return cfg;
}

async function boot() {
  let ctx;
  try {
    ctx = await initShell({ page: 'checkin' });
  } catch (err) {
    showError(root, err);
    return;
  }
  config = ctx.config;
  crew = ctx.astronauts;
  astronautId = ctx.astronautId;

  document.addEventListener('keydown', (e) => {
    if (e.key === ' ' && e.target === document.body && reactionPress) {
      e.preventDefault();
      reactionPress();
    }
  });
  window.addEventListener('astronaut-change', async (e) => {
    astronautId = e.detail.astronautId;
    const seq = ++configSeq;
    try {
      const nextCfg = await loadAstronautConfig(astronautId);
      if (seq !== configSeq) return;
      config = nextCfg;
    } catch {
      if (seq !== configSeq) return;
    }
    build();
  });
  const seq = ++configSeq;
  try {
    const nextCfg = await loadAstronautConfig(astronautId);
    if (seq === configSeq) config = nextCfg;
  } catch {
    // Personal ranges could not load: keep the general config from initShell so the form still opens.
  }
  build();
}

function errorBox(message) {
  return el('div', { class: 'error-box', role: 'alert' }, message);
}

// ---- Form ----

function build() {
  stopAll();
  cleanups = [];
  const selectedId = astronautId;
  const a = crew.find((c) => c.id === astronautId);
  if (!a) {
    root.replaceChildren(
      el('h1', {}, 'Daily check-in'),
      el('p', { class: 'state' }, 'No crew member is selected. Add one to the database, then reload this page.'),
    );
    return;
  }

  const indicators = [...config.indicators].sort((x, y) => x.display_order - y.display_order);
  const fields = indicators.map(buildField);
  const byId = new Map(fields.map((f) => [f.ind.id, f]));

  const formError = el('div', { class: 'form-error' });
  const notes = el('textarea', { class: 'input', id: 'notes', name: 'notes', rows: 3 });
  const submit = el('button', { type: 'submit', class: 'btn btn--primary' }, REVIEW_LABEL);
  const result = el('section', { class: 'panel stack', hidden: true, 'aria-labelledby': 'result-title' });

  let currentField = 0;
  let focused = true;
  let pending = null;
  let saving = false;
  const localKey = `checkin-draft:${selectedId}`;
  function showResult(res) {
    const s = res.status;
    const level = s.triage.level;
    const alertLevel = level >= 2 ? 'alert' : level === 1 ? 'watch' : null;
    const reasons = (s.score.reasons || []).slice(0, 3);
    result.replaceChildren(
      alertLevel
        ? masterAlert(alertLevel, s.triage.headline)
        : el('div', { class: 'normal-line' }, statusBadge('normal'), el('p', {}, 'All readings are in the usual range.')),
      el('h2', { id: 'result-title', tabindex: '-1' }, 'Check-in saved'),
      el('div', { class: 'score-line' },
        el('span', { class: 'score-number' }, formatValue(s.score.value)),
        el('div', {}, statusBadge(s.score.band), el('p', { class: 'muted' }, 'Health score out of 100'))),
      reasons.length
        ? el('div', {}, el('h3', {}, 'Top reasons'), el('ul', { class: 'list' }, reasons.map((r) => el('li', {}, r))))
        : el('p', { class: 'muted' }, 'Nothing needs attention right now.'),
      alertLevel ? '' : el('p', {}, el('strong', {}, 'Next step: '), s.triage.headline), // '' not null: replaceChildren prints null as text
      el('p', {}, el('a', { class: 'btn btn--primary', href: 'index.html' }, 'Back to home')),
    );
    form.hidden = true;
    result.hidden = false;
    result.querySelector('h2').focus();
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (saving) return;
    clearTimeout(draftTimer);
    stopAll(); // a running test must not change values during the save
    const first = validateAll(fields);
    if (first) {
      formError.replaceChildren(errorBox('Check the highlighted fields.'));
      currentField = fields.indexOf(first);
      showField();
      first.focus();
      return;
    }
    formError.replaceChildren();
    const rows = fields
      .filter((f) => f.read() !== null)
      .map((f) => ({ f, v: f.read(), flag: flagOf(f) }));
    const listed = [...rows].sort((x, y) => flagRank(x.flag) - flagRank(y.flag));
    const flaggedFields = fields.filter((f) => flagOf(f) !== null);

    // Command confirmation: a check-in cannot be edited once sent (HIDH p. 1015).
    const confirmed = await confirmAction({
      title: 'Submit this check-in?',
      body: [
        flaggedFields.length ? el('p', {}, 'Check these values before you submit.') : null,
        reviewTable(listed),
        el('p', {}, 'You cannot edit a check-in after you submit it.'),
      ],
      confirmLabel: 'Submit check-in',
      cancelLabel: 'Go back and edit',
    });
    if (!confirmed) {
      if (flaggedFields.length) flaggedFields[0].focus();
      else submit.focus();
      return;
    }

    const readings = rows.map((r) => ({ indicator_id: r.f.ind.id, value: r.v, method: r.f.method }));

    saving = true;
    submit.disabled = true;
    submit.textContent = 'Saving…';
    try {
      const data = { astronaut_id: selectedId, readings, notes: notes.value.trim() };
      const signature = JSON.stringify(data);
      if (!pending || pending.signature !== signature) pending = {signature, payload:{...data, client_submission_id:crypto.randomUUID()}};
      try {
        await localRecord(localKey, {pending, readings, notes:data.notes});
      } catch {
        recovery.textContent = 'The local draft could not be stored; the record will still be sent to the health server.';
      }
      const res = await api.submitCheckin(pending.payload);
      clearTimeout(draftTimer); // a pending draft save must not bring back the submitted record
      try { await localRecord(localKey, null); } catch { /* submission already succeeded */ }
      showResult(res);
    } catch (err) {
      const f = err.field ? byId.get(err.field) : null;
      if (f) {
        // In step-by-step mode the field may be hidden: go to its step, as for a browser-side error.
        formError.replaceChildren(errorBox(err.message));
        currentField = fields.indexOf(f);
        showField();
        setError(f, err.message);
        f.focus();
      } else {
        formError.replaceChildren(errorBox(err.message));
      }
    } finally {
      saving = false;
      submit.disabled = false;
      submit.textContent = REVIEW_LABEL;
    }
  }

  const form = el('form', { id: 'checkin-form', class: 'stack', novalidate: true, onsubmit: onSubmit },
    el('div', { class: 'checkin-fields' }, fields.map((f) => f.wrap)),
    el('div', { class: 'field' }, el('label', { for: 'notes' }, 'Notes (optional)'), notes),
    formError,
    el('div', { class: 'form-actions' }, submit),
  );

  const progress = el('p',{class:'eyebrow',role:'status'});
  const previous = el('button',{type:'button',class:'btn',onclick:()=>{currentField=Math.max(0,currentField-1);showField();}},'← Previous');
  const next = el('button',{type:'button',class:'btn btn--primary',onclick:()=>{
    const f=fields[currentField];const error=validate(f);setError(f,error);if(error){f.focus();return;}
    currentField=Math.min(fields.length-1,currentField+1);showField();
  }},'Next measurement →');
  const overview = el('button',{type:'button',class:'btn',onclick:()=>{focused=!focused;showField();}},'Show all');
  const wizard=el('div',{class:'lab-footer'},previous,overview,next);
  form.prepend(progress);form.append(wizard);
  function showField(){
    form.classList.toggle("focused-form",focused);
    for(const stop of cleanups)stop();
    fields.forEach((f,i)=>f.wrap.hidden=focused&&i!==currentField);
    progress.textContent=focused?`MEASUREMENT ${currentField+1} / ${fields.length} · ${fields[currentField].ind.required?'REQUIRED':'OPTIONAL'}`:'ALL MEASUREMENTS';
    previous.hidden=!focused||currentField===0;next.hidden=!focused||currentField===fields.length-1;
    overview.textContent=focused?'Show all':'Continue step by step';
    submit.hidden=focused&&currentField!==fields.length-1;
    notes.parentElement.hidden=focused&&currentField!==fields.length-1;
  }
  showField();
  const recovery = el('p', {class:'trust-note', role:'status'}, 'The draft is stored in this browser. If the connection drops, you can submit the same record again.');
  form.prepend(recovery);
  let draftTimer;
  const saveDraft = () => {
    clearTimeout(draftTimer);
    draftTimer=setTimeout(()=>localRecord(localKey,{pending,readings:fields.filter(f=>f.read()!==null).map(f=>({indicator_id:f.ind.id,value:f.read(),method:f.method})),notes:notes.value}).catch(()=>{recovery.textContent='The draft could not be stored. Check browser storage.';}),250);
  };
  form.addEventListener('input', saveDraft);
  form.addEventListener('draftchange', saveDraft);
  localRecord(localKey).then(draft=>{
    if(!draft)return;pending=draft.pending;
    const restore=el('button',{type:'button',class:'btn',onclick:()=>{
      for(const r of draft.readings||[]){const f=byId.get(r.indicator_id);if(!f)continue;if(f.setValue)f.setValue(r.value,r.method);else for(const i of f.inputs)i.checked=Number(i.value)===r.value;}
      notes.value=draft.notes||'';recovery.textContent='The previous draft was restored. Review and submit it.';
    }},'Restore previous draft');
    recovery.replaceChildren('There is a draft for this person. ',restore);
  }).catch(()=>{recovery.textContent='Local draft storage is unavailable.';});

  root.replaceChildren(
    el('div', { class: 'page-head' },
      el('h1', {}, 'Daily check-in'),
      el('p', {}, `${a.name}, mission day ${a.mission_day}. Items marked Required are asked every time. Tools such as the reaction test are optional: you can always type a value.`)),
    form,
    result,
  );
}

function unitOf(ind) {
  return ind.input_type === 'scale' ? '' : ` ${ind.unit}`;
}

// Text under each input, built from config so no range is hard-coded.
function usualRange(ind) {
  const u = unitOf(ind);
  const fmt = (x) => formatValue(x, ind.decimals);
  const lo = typeof ind.normal_low === 'number' ? ind.normal_low : null;
  const hi = typeof ind.normal_high === 'number' ? ind.normal_high : null;
  if (lo !== null && lo === hi) return `Usual value ${fmt(lo)}${u}`;
  if (lo !== null && hi !== null) return `Usual range ${fmt(lo)}–${fmt(hi)}${u}`;
  if (lo !== null) return `Usual at least ${fmt(lo)}${u}`;
  if (hi !== null) return `Usual at most ${fmt(hi)}${u}`;
  return `Allowed ${fmt(ind.min_plausible)}–${fmt(ind.max_plausible)}${u}`;
}

function buildField(ind) {
  const id = ind.id;
  const describedBy = `range-${id} err-${id}`;
  const req = ind.required ? el('span', { class: 'req' }, ' · Required') : null;
  const range = el('p', { class: 'hint', id: `range-${id}` }, usualRange(ind));
  const more = ind.how_to_measure ? measureDetails(ind, () => f) : null;
  const errorEl = el('p', { class: 'error', id: `err-${id}`, hidden: true });
  const f = { ind, method: 'manual', errorEl, inputs: [], wrap: null, read: null, focus: null, setValue: null };

  if (ind.input_type === 'scale') {
    const radios = [];
    for (let v = ind.min_plausible; v <= ind.max_plausible; v += 1) {
      const k = v - ind.min_plausible;
      const label = ind.scale_labels && ind.scale_labels[k];
      const input = el('input', { type: 'radio', name: `f-${id}`, value: String(v), 'aria-describedby': describedBy });
      f.inputs.push(input);
      radios.push(el('label', { class: 'choice' }, input, el('span', {}, label ? `${v} · ${label}` : `${v}`)));
    }
    f.read = () => {
      const checked = f.inputs.find((i) => i.checked);
      return checked ? Number(checked.value) : null;
    };
    f.focus = () => f.inputs[0].focus();
    f.wrap = el('fieldset', { class: 'field', 'data-indicator': id },
      el('legend', {}, ind.name, req),
      el('div', { class: 'choices' }, radios),
      range,
      errorEl,
      more);
    return f;
  }

  const input = el('input', {
    class: 'input',
    type: 'number',
    inputmode: 'decimal',
    id: `f-${id}`,
    name: id,
    step: ind.step,
    min: ind.min_plausible,
    max: ind.max_plausible,
    'aria-required': ind.required ? 'true' : null,
    'aria-describedby': describedBy,
  });
  f.inputs = [input];
  f.read = () => (input.value.trim() === '' ? null : Number(input.value));
  f.focus = () => input.focus();
  f.setValue = (v, method) => {
    input.value = String(v);
    f.method = method;
    setError(f, null);
    // Tools (pulse counter, reaction and eye tests) set the value in code, which fires no input event,
    // so tell the form to save the draft. Not 'input': that would reset the method to manual.
    input.dispatchEvent(new CustomEvent('draftchange', { bubbles: true }));
  };
  input.addEventListener('input', () => {
    f.method = 'manual';
    setError(f, null);
  });

  const unit = unitOf(ind).trim();
  let extra = null;
  if (ind.input_type === 'game') extra = reactionTest(ind, f);
  if (ind.input_type === 'vision' || ind.input_type === 'amsler') {
    // The advisory text is data (body_regions.alert), shown above the test.
    const region = (config.body_regions || []).find((r) => r.id === ind.body_region_id);
    const ctx = { alert: region && region.alert, register: (stop) => cleanups.push(stop) };
    extra = ind.input_type === 'vision' ? visionTest(ind, f, ctx) : amslerTest(ind, f, ctx);
  }

  f.wrap = el('div', { class: 'field', 'data-indicator': id },
    el('label', { for: `f-${id}` }, ind.name, req),
    el('div', { class: 'input-row' }, input, unit ? el('span', { class: 'metric__unit' }, unit) : null),
    range,
    errorEl,
    more,
    extra);
  return f;
}

// "How to measure" with steps and drawing. Built on first open, so the page stays short.
function measureDetails(ind, getField) {
  const slot = el('div', { class: 'mg-slot' });
  const details = el('details', { class: 'more' }, el('summary', {}, 'How to measure (with diagram)'), slot);
  details.addEventListener('toggle', () => {
    if (!details.open || slot.hasChildNodes()) return;
    slot.append(measureGuide(ind, {
      onValue: (v) => {
        const f = getField();
        const method = f.method === 'game' ? f.method : 'manual';
        if (f.setValue) f.setValue(v, method);
      },
    }));
  });
  return details;
}

function setError(f, message) {
  f.errorEl.textContent = message || '';
  f.errorEl.hidden = !message;
  for (const i of f.inputs) {
    if (message) i.setAttribute('aria-invalid', 'true');
    else i.removeAttribute('aria-invalid');
  }
}

function validate(f) {
  const { ind } = f;
  const v = f.read();
  if (v === null) {
    if (!ind.required) return null;
    return ind.input_type === 'scale' ? `Choose a rating for ${ind.name}.` : `Enter a value for ${ind.name}.`;
  }
  if (!Number.isFinite(v) || v < ind.min_plausible || v > ind.max_plausible) {
    const lo = formatValue(ind.min_plausible, ind.decimals);
    const hi = formatValue(ind.max_plausible, ind.decimals);
    return `${ind.name} must be between ${lo} and ${hi}${unitOf(ind)}.`;
  }
  return null;
}

// Validates every field, shows messages, and returns the first invalid field (or null).
function validateAll(fields) {
  let first = null;
  for (const f of fields) {
    const message = validate(f);
    setError(f, message);
    if (message && !first) first = f;
  }
  return first;
}

// ---- Review: values outside the usual range are flagged from config bounds ----

// 'alert' beyond the critical bounds, 'watch' outside the normal bounds, null otherwise.
function flagOf(f) {
  const { ind } = f;
  const v = f.read();
  if (v === null) return null;
  const beyond = (lo, hi) => (typeof lo === 'number' && v < lo) || (typeof hi === 'number' && v > hi);
  if (beyond(ind.critical_low, ind.critical_high)) return 'alert';
  if (beyond(ind.normal_low, ind.normal_high)) return 'watch';
  return null;
}

function flagRank(flag) {
  return flag === 'alert' ? 0 : flag === 'watch' ? 1 : 2;
}

function valueText(ind, v) {
  if (ind.input_type === 'scale') {
    const label = ind.scale_labels && ind.scale_labels[v - ind.min_plausible];
    return label ? `${v} · ${label}` : `${v}`;
  }
  return `${formatValue(v, ind.decimals)}${unitOf(ind)}`;
}

function reviewTable(rows) {
  return el('table', { class: 'table' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col' }, 'Indicator'),
      el('th', { scope: 'col' }, 'Value'),
      el('th', { scope: 'col' }, 'Check'))),
    el('tbody', {}, rows.map(({ f, v, flag }) => el('tr', {},
      el('th', { scope: 'row' }, f.ind.name),
      el('td', {}, valueText(f.ind, v)),
      el('td', {}, flag === 'alert' ? statusBadge('alert', 'Far outside usual range')
        : flag === 'watch' ? statusBadge('watch', 'Outside usual range')
          : statusBadge('normal', 'In usual range'))))));
}

// ---- Reaction test (input_type game) ----

function reactionTest(ind, field) {
  const startBtn = el('button', { type: 'button', class: 'btn' }, 'Start reaction test');
  const pad = el('button', { type: 'button', class: 'reaction-pad', hidden: true }, 'Wait for the signal');
  const msg = el('p', { class: 'hint', 'aria-live': 'polite' });
  let times = [];
  let timer = null;
  let signalAt = 0;
  let phase = 'idle';
  let lastPress = -Infinity;

  function stop() {
    clearTimeout(timer);
    phase = 'idle';
    if (reactionPress === press) reactionPress = null;
    pad.hidden = true;
    startBtn.disabled = false;
  }

  function wait() {
    phase = 'wait';
    pad.dataset.phase = 'wait';
    pad.textContent = `Wait for the signal (trial ${times.length + 1} of 5)`;
    timer = setTimeout(() => {
      phase = 'go';
      pad.dataset.phase = 'go';
      pad.textContent = 'Press now!';
      signalAt = performance.now();
    }, 1500 + Math.random() * 2500);
  }

  function press() {
    if (phase === 'wait') {
      clearTimeout(timer);
      wait();
      msg.textContent = 'Too soon. Wait for the signal.';
      return;
    }
    if (phase !== 'go') return;
    const ms = performance.now() - signalAt;
    times.push(ms);
    if (times.length < 5) {
      wait();
      msg.textContent = `Trial ${times.length} of 5: ${Math.round(ms)} ms.`;
      return;
    }
    stop();
    const median = Math.round([...times].sort((a, b) => a - b)[2]);
    field.setValue(median, 'game');
    msg.textContent = `Median of 5 trials: ${median} ms. The field is filled in; you can still change it.`;
    startBtn.textContent = 'Run the test again';
  }

  startBtn.addEventListener('click', () => {
    times = [];
    startBtn.disabled = true;
    pad.hidden = false;
    reactionPress = press;
    msg.textContent = 'Get ready. The target turns on after a short wait.';
    wait();
    pad.focus();
  });
  // Press on pointer down or key down, so the time is not padded by key release or click delay.
  pad.addEventListener('pointerdown', () => {
    lastPress = performance.now();
    press();
  });
  pad.addEventListener('keydown', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      lastPress = performance.now();
      press();
    }
  });
  pad.addEventListener('click', () => {
    // A click right after a pointer or key press is the same press; a screen reader click is not.
    if (performance.now() - lastPress > 400) press();
  });

  cleanups.push(stop);
  return el('div', { class: 'test' }, startBtn, pad, msg);
}

boot();
