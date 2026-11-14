// Turkish / English switch. Translates the rendered DOM in place, so page code stays English-only.
// Dictionary lines are "English => Turkish". A {name} in the English line is a placeholder, so one line
// covers strings with numbers or names ("Overdue by {t}." etc.). The original English is kept per node
// (WeakMap), so switching back restores it exactly.
import { UI } from './i18n-tr.js';
import { DATA } from './i18n-tr-data.js';
import { EYE } from './i18n-tr-eye.js';

const KEY = 'astro.lang';
const exact = new Map();
const lower = new Map();
const specs = []; // pattern lines, compiled on first use (so {k} can list every known name)
const reverseExact = new Map();
const reverseLower = new Map();
const reverseSpecs = [];
let patterns = null;
let reversePatterns = null;

const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');

export function load(raw) {
  for (const line of raw.split('\n')) {
    const i = line.indexOf(' => ');
    if (i < 0) continue;
    const en = line.slice(0, i).trim();
    const tr = line.slice(i + 4).trim();
    if (!en || !tr) continue;
    if (/\{\w+\}/.test(en) || /\{\w+\}/.test(tr)) {
      specs.push({ en, tr }); reverseSpecs.push({ en: tr, tr: en });
    } else {
      exact.set(en, tr); lower.set(en.toLowerCase(), tr);
      reverseExact.set(tr, en); reverseLower.set(tr.toLocaleLowerCase('tr'), en);
    }
  }
}
load(EYE);
load(DATA); // data patterns are the more specific ones, so they go first
load(UI);

// {num..} = a number, {opt..} = anything incl. empty, {u..} = a unit without brackets,
// {k..} = one of the known names (indicator, body part...) in any capitalisation, else {x} = anything.
function build() {
  const names = new Set();
  for (const n of exact.keys()) {
    if (n.length > 48 || /[.:!?]$/.test(n)) continue;
    names.add(n); names.add(n.charAt(0).toLowerCase() + n.slice(1)); names.add(n.toLowerCase());
  }
  const alt = [...names].sort((a, b) => b.length - a.length).map(esc).join('|');
  patterns = specs.map(({ en, tr }) => {
    const src = esc(en).replace(/\{(\w+)\}/g, (_, k) => (k.startsWith('num') ? `(?<${k}>[-−+]?\\d[\\d.,]*)`
      : k.startsWith('opt') ? `(?<${k}>(?:(?!\\.\\s+[A-Z]).)*?)` : k.startsWith('u') ? `(?<${k}>[^()]+)`
        : k.startsWith('k') ? `(?<${k}>${alt})` : `(?<${k}>(?:(?!\\.\\s+[A-Z]).)+?)`)); // never runs across a sentence end
    return { re: new RegExp('^' + src + '$', 's'), tr };
  });
}

function buildReverse() {
  const names = new Set();
  for (const n of reverseExact.keys()) {
    if (n.length > 48 || /[.:!?]$/.test(n)) continue;
    names.add(n); names.add(n.charAt(0).toLocaleLowerCase('tr') + n.slice(1)); names.add(n.toLocaleLowerCase('tr'));
  }
  const alt = [...names].sort((a, b) => b.length - a.length).map(esc).join('|');
  const ordered = [...reverseSpecs].sort((a, b) => Number(a.en.startsWith('{')) - Number(b.en.startsWith('{')));
  reversePatterns = ordered.map(({ en, tr }) => {
    const src = esc(en).replace(/\{(\w+)\}/g, (_, k) => (k.startsWith('num') ? `(?<${k}>[-−+]?\\d[\\d.,]*)`
      : k.startsWith('opt') ? `(?<${k}>(?:(?!\\.\\s+[A-ZÇĞİÖŞÜ]).)*?)` : k.startsWith('u') ? `(?<${k}>[^()]+)`
        : k.startsWith('k') ? `(?<${k}>${alt})` : `(?<${k}>(?:(?!\\.\\s+[A-ZÇĞİÖŞÜ]).)+?)`));
    return { re: new RegExp('^' + src + '$', 's'), tr };
  });
}

const memo = new Map();

// Returns the Turkish text, or null when nothing in it is known.
function tr(core, strict = false) { // strict: whole-string matches only (no sentence or " · " splitting)
  const mk = strict ? '\0' + core : core;
  if (memo.has(mk)) return memo.get(mk);
  let out = null;
  const low = core.toLowerCase();
  if (exact.has(core)) out = exact.get(core);
  else if (lower.has(low)) { // lower-cased names ("heart rate") come from the app's own toLowerCase()
    const t = lower.get(low);
    out = /^[a-z]/.test(core) ? t.charAt(0).toLocaleLowerCase('tr') + t.slice(1) : t;
  } else {
    if (!patterns) build();
    for (const p of patterns) {
      const m = core.match(p.re);
      if (m) {
        out = p.tr.replace(/\{(\w+)\}/g, (_, k) => { const v = m.groups[k]; return tr(v) ?? v; });
        if (/^[A-Z]/.test(core)) out = out.charAt(0).toLocaleUpperCase('tr') + out.slice(1); // "Keep heart rate..." -> "Nabız..."
        break;
      }
    }
    if (out === null) {
      for (const [sep, glue] of [[/(?<=[.!?])\s+(?=[A-Z])/, ' '], [/ · /, ' · ']]) {
        const parts = core.split(sep);
        if (parts.length < 2) continue;
        const done = parts.map(tr);
        if (done.some((d) => d !== null)) {
          out = parts.map((p, i) => done[i] ?? p).join(glue);
          break;
        }
      }
    }
  }
  memo.set(mk, out);
  return out;
}

export function translate(s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!m[2]) return s;
  const t = tr(m[2]);
  return t === null ? s : m[1] + t + m[3];
}

export function toEnglish(s) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  if (!m[2]) return s;
  const core = m[2];
  let out = reverseExact.get(core) ?? reverseLower.get(core.toLocaleLowerCase('tr')) ?? null;
  if (out === null) {
    if (!reversePatterns) buildReverse();
    for (const p of reversePatterns) {
      const hit = core.match(p.re);
      if (!hit) continue;
      out = p.tr.replace(/\{(\w+)\}/g, (_, k) => {
        const value = hit.groups[k];
        return toEnglish(value).trim() || value;
      });
      break;
    }
  }
  if (out === null) {
    for (const [sep, glue] of [[/(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])/, ' '], [/ · /, ' · ']]) {
      const parts = core.split(sep);
      if (parts.length < 2) continue;
      const done = parts.map((part) => toEnglish(part));
      if (done.some((value, i) => value !== parts[i])) { out = done.join(glue); break; }
    }
  }
  return out === null ? s : m[1] + out + m[3];
}

// ---- DOM ----
let lang = 'en';
const ATTRS = ['aria-label', 'title', 'placeholder', 'alt'];
const textRec = new WeakMap(); // Text -> { en, tr }
const attrRec = new WeakMap(); // Element -> { attr: { en, tr } }
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'NOSCRIPT']);
let observer = null;

function skipped(node) {
  for (let e = node.nodeType === 1 ? node : node.parentElement; e; e = e.parentElement) {
    if (SKIP.has(e.tagName) || e.hasAttribute('data-i18n-skip')) return true;
  }
  return false;
}

function doText(node) {
  const rec = textRec.get(node);
  if (lang === 'tr') {
    if (rec && node.data === rec.tr) return;
    const t = translate(node.data);
    if (t === node.data) { textRec.delete(node); return; }
    textRec.set(node, { en: node.data, tr: t });
    node.data = t;
  } else if (rec && node.data === rec.tr) {
    node.data = rec.en;
    textRec.delete(node);
  } else {
    const en = toEnglish(node.data);
    if (en !== node.data) {
      textRec.set(node, { en, tr: node.data });
      node.data = en;
    } else if (rec) {
      textRec.delete(node);
    }
  }
}

function doAttrs(el) {
  let recs = attrRec.get(el);
  for (const a of ATTRS) {
    if (!el.hasAttribute(a)) continue;
    const v = el.getAttribute(a);
    const rec = recs && recs[a];
    if (lang === 'tr') {
      if (rec && v === rec.tr) continue;
      const t = translate(v);
      if (t === v) { if (rec) delete recs[a]; continue; }
      if (!recs) { recs = {}; attrRec.set(el, recs); }
      recs[a] = { en: v, tr: t };
      el.setAttribute(a, t);
    } else if (rec && v === rec.tr) {
      el.setAttribute(a, rec.en);
      delete recs[a];
    } else {
      const en = toEnglish(v);
      if (en !== v) {
        if (!recs) { recs = {}; attrRec.set(el, recs); }
        recs[a] = { en, tr: v };
        el.setAttribute(a, en);
      } else if (rec) {
        delete recs[a];
      }
    }
  }
}

function walk(root) {
  if (skipped(root)) return;
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && (SKIP.has(n.tagName) || n.hasAttribute('data-i18n-skip'))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  doAttrs(root);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (n.nodeType === 3) doText(n); else doAttrs(n);
  }
}

function onMutations(records) {
  for (const r of records) {
    if (r.type === 'childList') r.addedNodes.forEach((n) => walk(n));
    else if (r.type === 'characterData') { if (!skipped(r.target)) doText(r.target); }
    else if (r.type === 'attributes') { if (!skipped(r.target)) doAttrs(r.target); }
  }
  observer.takeRecords(); // drop the records our own writes just caused (no feedback loop)
}

function apply() {
  if (observer) observer.disconnect();
  walk(document.documentElement);
  document.documentElement.lang = lang;
  if (!observer) observer = new MutationObserver(onMutations);
  observer.observe(document.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS,
  });
}

export function currentLang() { return lang; }

// QA helper (used from the browser console): visible strings that look like they are still English.
// Not translated at all = any 3-letter word; translated = only if it still holds common English words.
const EN_WORDS = /(?<!\p{L})(the|and|your|you|for|with|this|that|from|not|are|can|will|when|any|has|have|need|needs|reading|readings|check|time|take|before|after|about|than|more|less|new|day|days|but|all|use)(?!\p{L})/iu;
export function scan() {
  const out = new Set();
  const tw = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (skipped(n)) continue;
    if (n.nodeType === 3) {
      const t = n.data.trim();
      if (t && (textRec.has(n) ? EN_WORDS.test(t) : /[A-Za-z]{3}/.test(t))) out.add(t);
    } else {
      for (const a of ATTRS) {
        const v = n.getAttribute(a);
        if (v && ((attrRec.get(n) || {})[a] ? EN_WORDS.test(v) : /[A-Za-z]{3}/.test(v))) out.add(`[${a}] ${v}`);
      }
    }
  }
  return [...out];
}

export function setLang(next) {
  lang = next === 'tr' ? 'tr' : 'en';
  try { localStorage.setItem(KEY, lang); } catch { /* private mode: the choice just is not remembered */ }
  apply();
}

// Builds the header button into `slot` and applies the saved choice.
export function initI18n(slot) {
  try { lang = localStorage.getItem(KEY) === 'tr' ? 'tr' : 'en'; } catch { lang = 'en'; }
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.setAttribute('data-i18n-skip', '');
  const paint = () => {
    btn.textContent = lang === 'tr' ? 'English' : 'Türkçe';
    btn.lang = lang === 'tr' ? 'en' : 'tr';
    btn.setAttribute('aria-pressed', String(lang === 'tr'));
  };
  btn.addEventListener('click', () => { setLang(lang === 'tr' ? 'en' : 'tr'); paint(); });
  paint();
  slot.append(btn);
  apply();
}
