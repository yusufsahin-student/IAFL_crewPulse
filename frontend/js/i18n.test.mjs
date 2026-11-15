// Unit test for the translate function, plus a coverage sweep of the data files.
// Run: node frontend/js/i18n.test.mjs   (add --list to print every string that has no Turkish yet)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { translate, toEnglish } from './i18n.js';

// exact match
assert.equal(translate('Trends'), 'Eğilimler');
assert.equal(translate('Radiation hazard'), 'Radyasyon tehlikesi');
// whitespace is kept around the translated text
assert.equal(translate('  Home\n'), '  Ana sayfa\n');
// patterns with numbers and names
assert.equal(translate('6.7% of the 600 mSv career limit (estimated).'), '600 mSv kariyer sınırının 6.7%\'i (tahmini).');
assert.equal(translate('Show 2 more reasons'), '2 neden daha göster');
assert.equal(translate('Overdue by 2 h. Take a minute now.'), '2 sa gecikti. Şimdi bir dakikanızı ayırın.');
assert.equal(translate('Signal takes 1.3 s each way · reply in about 2.6 s'), 'Sinyal her yönde 1.3 s sürer · yanıt yaklaşık 2.6 s içinde');
assert.equal(translate('Mira Okafor · ISS mission · mission day 73'), 'Mira Okafor · ISS görevi · görev günü 73');
assert.equal(translate('Last check-in: 12 Nov, 09:30.'), 'Son kontrol: 12 Nov, 09:30.');
// lower-cased names the app builds itself
assert.equal(translate('Keep heart rate in the usual range'), 'Nabız değerini olağan aralıkta tutun');
assert.equal(translate('Heart rate 72 bpm is above the usual limit (100).'), 'Nabız 72 bpm, olağan sınırın üzerinde (100).');
// several sentences: each is translated on its own
assert.equal(translate('Drink water. Rest and drink water.'), 'Su için. Dinlenin ve su için.');
// unknown text is left alone
assert.equal(translate('Mira Okafor'), 'Mira Okafor');
assert.equal(translate('72 bpm'), '72 bpm');
assert.equal(toEnglish('Bugünün hareket yükü.'), "Today's movement load.");
assert.equal(toEnglish('Dikkat: Plan güncel olmayan ölçümlere göre konservatif tutuldu. Önce günlük kontrolü yenile.'), 'Caution: The plan is conservative because the readings are out of date. Refresh the daily check-in first.');
assert.equal(toEnglish('ÖLÇÜM 3 / 22 · GEREKLİ'), 'MEASUREMENT 3 / 22 · REQUIRED');

// coverage sweep over the data files: list sentences with no Turkish
const root = new URL('../../', import.meta.url);
const files = ['data/seed/guidance.json', 'data/seed/triage_actions.json', 'data/seed/habitat_zones.json',
  'data/seed/indicator_adjustments.json', 'data/seed/body_regions.json', 'data/seed/indicators.json',
  'data/seed/missions.json', 'data/seed/bone_sites.json', 'frontend/mock/config.json', 'frontend/mock/status.json',
  'frontend/mock/status-moon.json', 'frontend/mock/status-mars.json', 'frontend/mock/checkin-post.json',
  'frontend/mock/radiation.json', 'frontend/mock/radiation-moon.json', 'frontend/mock/radiation-mars.json',
  'frontend/mock/radiation-rover.json', 'frontend/mock/radiation-transit.json'];
const SKIP_KEYS = new Set(['id', 'unit', 'color', 'url', 'region_id', 'indicator_id', 'mission_id', 'source_ref', 'kind',
  'hazard', 'input_type', 'consult_mode', 'direction', 'severity', 'body_region_id', 'title', 'event_type', 'class_type',
  'note_key', 'icon']);
const NAMES = /^(Mars|Pelvis|Mira Okafor|Tomas Lind|Yuki Hara|Sam Adeyemi|Mira Sato|Tomas Reyes|Priya Lind|Owen Varga|Ines Okafor|https?:.*)$/; // proper names and URLs stay as they are
const missing = new Set();
const walk = (o, key) => {
  if (typeof o === 'string') {
    if (SKIP_KEYS.has(key) || !/[A-Za-z]{3}/.test(o) || /^\d{4}-\d\d/.test(o) || /^[\w./-]+$/.test(o) && !/^[A-Z][a-z]+$/.test(o)) return;
    o = o.replace(/{reply_minutes}/g, '44').replace(/{delay}/g, '1.3 s').replace(/{mission}/g, 'Mars'); // as the API fills them in
    if (translate(o) !== o) return;
    for (const s of o.split(/(?<=[.!?])\s+(?=[A-Z])/)) if (translate(s) === s && !NAMES.test(s)) missing.add(s);
  } else if (Array.isArray(o)) o.forEach((x) => walk(x, key));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, k);
};
for (const f of files) {
  try { walk(JSON.parse(fs.readFileSync(new URL(f, root), 'utf8')), ''); } catch { /* file not present */ }
}
if (process.argv.includes('--list')) console.log([...missing].join('\n'));
console.log(`i18n: unit tests passed; ${missing.size} data sentences without Turkish${missing.size ? ' (run with --list)' : ''}`);
assert.equal(missing.size, 0, 'untranslated data text');

// Page code must stay English; Turkish lives only in the i18n-tr*.js dictionaries.
// Turkish source text shows up untranslated in English mode, so fail on any Turkish letter outside comments.
const jsDir = new URL('./', import.meta.url);
const turkish = [];
const pages = fs.readdirSync(new URL('../', jsDir)).filter((n) => n.endsWith('.html')).map((n) => `../${n}`);
for (const name of [...fs.readdirSync(jsDir), ...pages]) {
  if (!/\.(js|html)$/.test(name) || name.startsWith('i18n')) continue;
  fs.readFileSync(new URL(name, jsDir), 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim().startsWith('//') && /[ğĞıİşŞçÇöÖüÜ]/.test(line)) turkish.push(`${name}:${i + 1}`);
  });
}
assert.deepEqual(turkish, [], 'Turkish text in page code');
