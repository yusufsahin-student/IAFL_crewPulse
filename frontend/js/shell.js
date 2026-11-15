// Shared page shell: header, navigation, crew selector, helpers.
// Usage: const { config, astronauts, astronautId } = await initShell({ page: 'home' });
import { api } from './api.js';
import { initI18n, currentLang } from './i18n.js';

const PAGES = [
  { id: 'home', href: 'index.html', label: 'Home' },
  { id: 'mind', href: 'mind.html', label: 'Mind lab' },
  { id: 'activity', href: 'activity.html', label: 'Activity & Recommendations' },
  { id: 'details', href: 'details.html', label: 'Body map' },
  { id: 'checkin', href: 'checkin.html', label: 'Check-in' },
  { id: 'radiation', href: 'radiation.html', label: 'Radiation' },
  { id: 'gravity', href: 'gravity.html', label: 'Gravital Tracking' },
  { id: 'trends', href: 'trends.html', label: 'Trends' },
];


export const STATUS_LABEL = {
  normal: 'Normal', good: 'Good', advisory: 'Advisory', watch: 'Caution', alert: 'Warning',
  radiation: 'Radiation hazard', missing: 'No reading',
};

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Word + colour + shape, so status never depends on colour alone (HIDH p. 1033).
export function statusIcon(status) {
  return el('span', { class: 'status-icon', 'data-shape': status || 'missing', 'aria-hidden': 'true' });
}

export function statusBadge(status, label) {
  const s = status || 'missing';
  return el('span', { class: 'status', 'data-status': s }, statusIcon(s), label || STATUS_LABEL[s] || s);
}

// The single banner that announces a warning or caution at the top of a page.
// status: 'alert' | 'watch' | 'advisory' | 'radiation'. Returns the element; pass null text to get nothing.
export function masterAlert(status, title, text) {
  if (!title) return el('div', { hidden: true });
  return el('div', { class: 'master-alert', 'data-status': status, role: status === 'alert' ? 'alert' : 'status' },
    statusIcon(status),
    el('div', {},
      el('p', { class: 'master-alert__title' }, `${STATUS_LABEL[status] || ''}: ${title}`),
      text ? el('p', { class: 'master-alert__text' }, text) : null));
}

// Two-step command confirmation for anything that cannot be undone (HIDH p. 1015).
// Resolves true only when the person presses the confirm button.
export function confirmAction({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Go back', danger = false }) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'confirm', 'aria-labelledby': 'confirm-title' });
    const done = (value) => { dialog.close(); dialog.remove(); resolve(value); };
    const cancel = el('button', { class: 'btn', type: 'button', onclick: () => done(false) }, cancelLabel);
    const ok = el('button', { class: danger ? 'btn btn--danger' : 'btn btn--primary', type: 'button', onclick: () => done(true) }, confirmLabel);
    dialog.append(
      el('h2', { id: 'confirm-title' }, title),
      ...(Array.isArray(body) ? body : [body]).filter(Boolean).map((b) => (b instanceof Node ? b : el('p', {}, b))),
      el('div', { class: 'btn-row' }, cancel, ok));
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus(); // the safe choice has focus, so a stray Enter does not confirm
  });
}

export function formatValue(value, decimals = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–';
  return Number(value).toFixed(decimals);
}

// Dates follow the app language, not the browser language.
export const dateLocale = () => (currentLang() === 'tr' ? 'tr-TR' : 'en-GB');

export function formatDate(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
}

export function formatDateTime(iso) {
  if (!iso) return '–';
  const d = new Date(iso);
  return d.toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function showError(container, err) {
  container.replaceChildren(
    el('div', { class: 'error-box', role: 'alert' },
      el('strong', {}, 'Could not load this view. '),
      (err && err.message) || 'Something went wrong.'),
  );
}

let cache = null;

export async function initShell({ page }) {
  const header = document.getElementById('app-header');
  const current = PAGES.find((p) => p.id === page);
  if (current) document.title = `${current.label} · CrewPulse`;

  const nav = el('nav', { class: 'app-nav', 'aria-label': 'Main' },
    PAGES.map((p) => el('a', { href: p.href, 'aria-current': p.id === page ? 'page' : null }, p.label)));
  const crewSlot = el('div', { class: 'app-crew' });
  if (header) {
    header.className = 'app-header';
    header.replaceChildren(el('div', { class: 'app-header__inner' },
      el('a', { class: 'app-title', href: 'index.html' }, 'CrewPulse'),
      nav, crewSlot));
  }
  initI18n(crewSlot);
  initTheme(crewSlot);
  // // Türkçe / English button; translates the page in place

  if (!cache) {
    const [config, astronauts] = await Promise.all([api.config(), api.astronauts()]);
    cache = { config, astronauts };
  }
  const { config, astronauts } = cache;

  // No crew picker any more, so always use the first crew member (a stored pick could not be changed back).
  const astronautId = astronauts[0] ? astronauts[0].id : null;


  return { config, astronauts, astronautId };
}

const THEME_KEY = 'astro.theme';
function initTheme(slot) {
  let theme = 'dark';
  try { theme = localStorage.getItem(THEME_KEY) || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'); } catch {}
  const button = el('button', { class: 'btn theme-toggle', type: 'button' });
  const paint = () => {
    document.documentElement.dataset.theme = theme;
    button.textContent = theme === 'dark' ? 'Light mode' : 'Night mode';
    button.setAttribute('aria-pressed', String(theme === 'dark'));
  };
  button.addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, theme); } catch {}
    paint();
  });
  slot.append(button);
  paint();
}

export function missionById(config, id) {
  return (config.missions || []).find((m) => m.id === id) || null;
}

export function indicatorById(config, id) {
  return (config.indicators || []).find((i) => i.id === id) || null;
}
