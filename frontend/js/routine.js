// Daily routine panel: check-in reminder, streak, today's tasks, badges. Logic is pure (no DOM) so Node can test it.
import { el, statusBadge, indicatorById } from './shell.js';

const DAY_MS = 86400000;
const MAX_TASKS = 5;
const dayNum = (iso) => Math.floor(Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`) / DAY_MS);
export const utcDay = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// Consecutive-day check-in streak from history points (UTC dates). Current streak must end today or yesterday.
export function streak(points, todayISO) {
  const days = [...new Set((points || []).map((p) => dayNum(utcDay(p.taken_at))))].filter(Number.isFinite).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  days.forEach((d, i) => {
    run = i > 0 && d === days[i - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  const set = new Set(days);
  let d = dayNum(todayISO);
  if (!set.has(d)) d -= 1;
  let current = 0;
  while (set.has(d)) { current += 1; d -= 1; }
  return { current, best };
}

// state: 'none' (no check-in yet), 'ok' (hours left) or 'overdue' (hours late).
export function dueState(lastTakenAt, intervalH, now) {
  const last = Date.parse(lastTakenAt);
  if (!lastTakenAt || Number.isNaN(last)) return { state: 'none', hours: 0 };
  const hours = (last + intervalH * 3600000 - now) / 3600000;
  return hours > 0 ? { state: 'ok', hours } : { state: 'overdue', hours: -hours };
}

// Badge day thresholds from params routine.badge_days_1, _2, ... in numeric order.
export function badgeDays(params) {
  return Object.keys(params || {}).filter((k) => /^routine\.badge_days_\d+$/.test(k))
    .sort((a, b) => Number(a.split('_').pop()) - Number(b.split('_').pop()))
    .map((k) => Number(params[k])).filter((n) => n > 0);
}

const hoursText = (h) => (h < 1 ? 'under 1 h' : `${Math.round(h)} h`);
const plural = (n, one, many) => (n === 1 ? one : many);

// Tasks: today's check-in, then keep-in-range for indicators the crew wants high or that have a lower normal bound.
export function tasks(status, config, todayISO) {
  const checkedToday = Boolean(status.checkin) && status.checkin.taken_at.slice(0, 10) === todayISO;
  const list = [{ text: "Complete today's check-in", done: checkedToday }];
  for (const i of status.indicators || []) {
    if (list.length >= MAX_TASKS) break;
    const cfg = indicatorById(config, i.indicator_id) || {};
    const low = (i.range && i.range.normal_low) ?? cfg.normal_low;
    if (i.value == null || !(cfg.higher_is_better === 1 || low != null)) continue;
    list.push({ text: `Keep ${i.name.toLowerCase()} in the usual range`, done: checkedToday && i.status === 'normal' });
  }
  return list;
}

export function badgeMeta(days) {
  if (days <= 3) return { tier: 'bronze', label: 'Orbit Star' };
  if (days <= 7) return { tier: 'silver', label: 'Lunar Shield' };
  return { tier: 'gold', label: 'Deep Space Crest' };
}

export function routineSummary({ status = {}, points = null, config = {}, now = Date.now() } = {}) {
  const intervalH = Number((config.params || {})['routine.checkin_interval_h']) || 24;
  const todayISO = utcDay(now);
  const last = status.checkin ? status.checkin.taken_at : null;
  const due = dueState(last, intervalH, now);
  const s = points ? streak(points, todayISO) : null;
  const days = badgeDays(config.params);
  const list = tasks(status, config, todayISO);
  const doneCount = list.filter((t) => t.done).length;
  const best = s ? s.best : 0;
  const current = s ? s.current : 0;
  const badges = days.map((n) => {
    const earned = Boolean(s && s.best >= n);
    return {
      days: n,
      earned,
      remainingDays: earned ? 0 : Math.max(1, n - best),
      ...badgeMeta(n),
    };
  });
  const nextBadge = badges.find((b) => !b.earned) || null;
  return {
    intervalH,
    todayISO,
    due,
    streak: s,
    currentDays: current,
    bestDays: best,
    tasks: list,
    doneCount,
    totalTasks: list.length,
    badges,
    earnedCount: badges.filter((b) => b.earned).length,
    nextBadgeDays: nextBadge ? nextBadge.days : null,
    daysToNext: nextBadge ? nextBadge.remainingDays : 0,
  };
}

export function badgeMedalSvg(days, earned, size = 44) {
  const { tier } = badgeMeta(days);
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('class', `badge-medal badge-medal--${tier}${earned ? ' badge-medal--earned' : ' badge-medal--locked'}`);
  svg.setAttribute('aria-hidden', 'true');

  let emblem = '';
  if (tier === 'bronze') {
    emblem = `
      <polygon points="24,4 41,14 41,34 24,44 7,34 7,14" class="medal-rim"/>
      <circle cx="24" cy="24" r="12" class="medal-ring"/>
      <polygon points="24,13 27,21 35,24 27,27 24,35 21,27 13,24 21,21" class="medal-core"/>`;
  } else if (tier === 'silver') {
    emblem = `
      <path d="M24 5 L39 11 V23 C39 33 32 40 24 43 C16 40 9 33 9 23 V11 Z" class="medal-rim"/>
      <path d="M27 15 A9 9 0 1 0 31 31 A7 7 0 1 1 27 15 Z" class="medal-core"/>
      <circle cx="31" cy="18" r="2" class="medal-accent"/>`;
  } else {
    emblem = `
      <circle cx="24" cy="24" r="19" class="medal-rim"/>
      <ellipse cx="24" cy="24" rx="16" ry="6.5" transform="rotate(-24 24 24)" class="medal-ring"/>
      <polygon points="24,11 31,32 24,27 17,32" class="medal-core"/>
      <circle cx="24" cy="21" r="2.5" class="medal-accent"/>`;
  }

  const lockOverlay = earned
    ? ''
    : `<g class="medal-lock"><circle cx="38" cy="38" r="8" class="medal-lock__bg"/><rect x="34.5" y="37" width="7" height="5.5" rx="1.2" class="medal-lock__body"/><path d="M36 37 v-2 a2 2 0 0 1 4 0 v2" class="medal-lock__shackle"/></g>`;

  svg.innerHTML = `${emblem}${lockOverlay}`;
  return svg;
}

let timer = null;

function scheduleNotice(due, intervalH, last) {
  clearTimeout(timer);
  const ms = Date.parse(last) + intervalH * 3600000 - Date.now();
  // setTimeout caps near 24.8 days; only the page being open can fire it.
  if (due.state === 'ok' && ms < 2 ** 31 - 1 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    timer = setTimeout(() => new Notification('Check-in due', { body: "It's time for your health check-in." }), ms);
  }
}

// host: element; ctx: { status, points (or null), config, now }
export function renderRoutine(host, { status, points, config, now = Date.now() }) {
  const summary = routineSummary({ status, points, config, now });
  const { intervalH, due, streak: s, tasks: list, doneCount: done, badges } = summary;
  const last = status.checkin ? status.checkin.taken_at : null;
  scheduleNotice(due, intervalH, last);

  const reminder = due.state === 'ok'
    ? el('p', {}, statusBadge('normal', 'On track'), ` Next check-in due in ${hoursText(due.hours)}.`)
    : el('p', {}, statusBadge('watch', 'Check-in due'),
      due.state === 'none' ? ' No check-in yet. Start your first one.' : ` Overdue by ${hoursText(due.hours)}. Take a minute now.`);
  const allow = typeof Notification !== 'undefined' && Notification.permission === 'default'
    ? el('button', {
      type: 'button', class: 'btn',
      onclick: async () => {
        await Notification.requestPermission().catch(() => {});
        renderRoutine(host, { status, points, config, now: Date.now() });
      },
    }, 'Allow reminders')
    : null;

  host.replaceChildren(...[
    reminder,
    el('div', { class: 'btn-row' },
      el('a', { class: `btn${due.state === 'ok' ? '' : ' btn--primary'}`, href: 'checkin.html' }, "Start today's check-in"), allow),
    allow ? el('p', { class: 'muted routine-note', tabindex: '-1' }, 'Reminders only appear while this page is open.') : null,
    el('h3', {}, 'Your streak'),
    s
      ? el('p', {}, el('strong', { class: 'routine-streak' }, `${s.current} ${plural(s.current, 'day', 'days')}`),
        ` in a row. Best: ${s.best} ${plural(s.best, 'day', 'days')}.`)
      : el('p', { class: 'muted' }, 'Streak is not available right now.'),
    el('h3', {}, `Today's health tasks (${done} of ${list.length} done)`),
    el('ul', { class: 'list routine-tasks' }, list.map((t) => el('li', {}, t.text, ' ',
      statusBadge(t.done ? 'normal' : 'advisory', t.done ? 'Done' : 'To do')))),
    badges.length
      ? el('div', {},
        el('h3', {}, 'Badges'),
        el('ul', { class: 'routine-badges' }, badges.map((b) =>
          el('li', { class: `routine-badge-card routine-badge-card--${b.earned ? 'earned' : 'locked'}` },
            badgeMedalSvg(b.days, b.earned, 44),
            el('div', { class: 'routine-badge-card__info' },
              el('strong', {}, b.label),
              el('span', { class: 'muted' }, `${b.days}-day streak`),
              !b.earned && s
                ? el('span', { class: 'routine-badge-card__progress' }, plural(b.remainingDays, '1 day left', `${b.remainingDays} days left`))
                : null,
            ),
            statusBadge(b.earned ? 'good' : 'missing', b.earned ? 'Earned' : 'Locked'),
          ),
        )))
      : null,
  ].filter(Boolean));
}
