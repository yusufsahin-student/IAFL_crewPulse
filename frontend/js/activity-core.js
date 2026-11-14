const round5 = (n) => Math.max(0, Math.round(n / 5) * 5);
const dayOf = (iso) => String(iso || '').slice(0, 10);
export const localDay = (value = new Date()) => {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export function recentActivity(points = [], localLogs = [], today = localDay()) {
  const byDay = new Map();
  for (const point of points) {
    const day = point.taken_at ? localDay(point.taken_at) : '';
    const value = Number(point.values && point.values.exercise_minutes);
    if (day && day < today && Number.isFinite(value)) byDay.set(day, value);
  }
  for (const log of localLogs) {
    const day = dayOf(log.day);
    const value = Number(log.actual_minutes);
    if (day && day < today && Number.isFinite(value)) byDay.set(day, value);
  }
  return [...byDay].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([day, minutes]) => ({ day, minutes }));
}

export function activityTrend(points = [], indicatorId) {
  const samples = points.map(point => ({ at: point.taken_at, value: point.values?.[indicatorId] }))
    .filter(sample => sample.at && sample.value != null && Number.isFinite(Number(sample.value)))
    .sort((a,b) => String(a.at).localeCompare(String(b.at))).slice(-7);
  if (samples.length < 2) return null;
  return { first: Number(samples[0].value), last: Number(samples.at(-1).value), count: samples.length };
}

function latestValue(status, id) {
  const row = (status.indicators || []).find((item) => item.indicator_id === id);
  if (!row || row.value == null || !Number.isFinite(Number(row.value))) return null;
  const value = Number(row.value);
  if (['mood', 'stress'].includes(id) && (value < 1 || value > 5)) return null;
  return value;
}

function segmentPlan(total, missionId, gentle = false, gravityG = null) {
  if (gentle) return [{ id: 'mobility', label: 'Hafif hareket ve mobilite', minutes: total, intensity: 'RPE 1–2 / 10', detail: 'Ağrısız eklem hareketi, nefes ve çok hafif esneme.', steps: ['5 dk kontrollü nefes ve eklem taraması', `${Math.max(10,total-10)} dk ağrısız mobilite`, '5 dk çok hafif soğuma'] }];
  const surface = ['moon', 'mars', 'rover'].includes(missionId) || (gravityG > 0 && gravityG < 0.95);
  const ratios = gravityG !== null && gravityG < 0.05 ? [0.30, 0.50, 0.20]
    : surface ? [0.30, 0.40, 0.30] : [0.40, 0.35, 0.25];
  const resistance = round5(total * ratios[1]);
  const mobility = round5(total * ratios[2]);
  const aerobic = Math.max(0, total - resistance - mobility);
  return [
    { id: 'aerobic', label: 'Aerobik karşı önlem', minutes: aerobic, intensity: 'RPE 3–5 / 10', detail: 'Koşu bandı veya bisiklet; konuşmayı sürdürebildiğin kontrollü tempo.', steps: ['5 dk kolay ısınma', `${Math.max(5,aerobic-10)} dk sabit kontrollü tempo`, '5 dk kolay soğuma'] },
    { id: 'resistance', label: 'Direnç ve yükleme', minutes: resistance, intensity: 'RPE 5–7 / 10', detail: 'Alt ve üst vücut büyük kas grupları; yalnızca görev ekipmanının onaylı programı.', steps: ['Onaylı 4–6 temel hareket seç', 'Her hareket 2–3 set × 8–12 tekrar', 'Setler arasında 60–90 sn dinlen'] },
    { id: 'mobility', label: surface ? 'Denge ve mobilite' : 'Mobilite ve soğuma', minutes: mobility, intensity: 'RPE 1–3 / 10', detail: surface ? 'Denge, koordinasyon ve eklem hareket açıklığı.' : 'Eklem hareket açıklığı, gövde kontrolü ve soğuma.', steps: [surface ? 'Destek yakınında denge ve koordinasyon' : 'Omuz, kalça ve omurga mobilitesi', 'Ağrısız aralıkta yavaş tekrarlar', 'Nefes normale dönene kadar soğuma'] },
  ];
}

export function buildRecommendations({ status, gravity = null, environment = null, radiation = null, bone = null, points = [] }) {
  const items = [];
  const add = (id, category, title, detail, priority, basis) => items.push({ id, category, title, detail, priority, basis });
  const currentG = gravity?.current_g == null ? NaN : Number(gravity.current_g);
  const flagged = (status?.indicators || []).filter(row => ['alert', 'watch'].includes(row.status));
  for (const row of flagged) add(`health-${row.indicator_id}`, 'Sağlık', `${row.name}: ölçümü gözden geçir`, 'Günlük kontrol ekranındaki kişisel sınırı ve görev sağlık yönergesini incele.', row.status === 'alert' ? 'watch' : 'advisory', `Son değer: ${row.value ?? '—'} ${row.unit || ''} · durum: ${row.status}`);
  for (const id of ['sleep_hours', 'fluid_intake', 'kcal_intake']) {
    const trend = activityTrend(points, id);
    const indicator = (status?.indicators || []).find(row => row.indicator_id === id);
    const label = {sleep_hours:'Uyku',fluid_intake:'Sıvı alımı',kcal_intake:'Besin alımı'}[id];
    if (trend && indicator) add(`trend-${id}`, 'Eğilim', `${label}: yakın dönem değişimini incele`, 'Son ölçümleri günlük kontrol ve kişisel geçmişle birlikte değerlendir; değişim tek başına neden veya tanı göstermez.', 'normal', `${trend.count} kayıt · ilk ${trend.first} → son ${trend.last} ${indicator.unit || ''}`);
  }
  if (Number.isFinite(currentG) && currentG < 0.67) {
    add('gravity-load', 'Aktivite', 'Mekanik yüklemeyi değerlendir',
      'Güvenlik ve görev protokolü izin veriyorsa onaylı direnç bloğunu uygula; tamamlanan yükü, setleri ve tekrarları kaydet.',
      'advisory', `${currentG.toFixed(3)} g · modellenen yük açığı %${Number(gravity.load_deficit_pct || 0).toFixed(1)}`);
  }
  if (Number(gravity?.transition_count) > 0) {
    add('gravity-transition', 'Hazırlık', 'Geçiş hazırlığını kontrol et',
      'Araç, iniş veya yüzey görevlerinden önce onaylı denge, koordinasyon ve ayağa kalkma hazırlığı kontrollerini tamamla.',
      'watch', `Seçili aralıkta ${gravity.transition_count} yerçekimi alanı geçişi`);
  }
  if (!gravity || !Number.isFinite(currentG)) add('gravity-missing', 'Yerçekimi', 'Yerçekimi verisini doğrula', 'Görev profilini ve veri kaynağını kontrol et.', 'watch', 'Yerçekimi verisi eksik');
  if (!radiation) add('radiation-missing', 'Radyasyon', 'Radyasyon verisini kontrol et', 'Görev radyasyon ekranını yenile ve mevcut görev protokolünü izle.', 'watch', 'Radyasyon verisi alınamadı');
  else if (radiation.active_event) add('radiation-event', 'Radyasyon', 'Aktif uzay hava olayını değerlendir', 'Görev radyasyon ve sığınak protokolünü izle; planı görev sorumlusuyla gözden geçir.', 'watch', 'Aktif radyasyon olayı mevcut');
  else {
    const dose = radiation.astronaut?.mission_dose_msv;
    const limit = radiation.astronaut?.pct_of_limit;
    const basis = dose != null ? `Görev için tahmini toplam doz ${dose} mSv${limit != null ? ` · limitin %${limit} kadarı` : ''}` : 'Aktif olay bildirilmedi; doz değeri mevcut değil';
    add('radiation-review', 'Radyasyon', 'Radyasyon bağlamını gözden geçir', 'Tahmini doz ve habitat bölgelerini radyasyon ekranından incele.', 'normal', basis);
  }
  if (!bone?.sites?.length) add('bone-missing', 'Kemik', 'Kemik tahminini kontrol et', 'Kemik eğilimi verisi alınamadı; eğilimler ekranını kontrol et.', 'watch', 'Kemik tahmini eksik');
  else {
    const sites = bone.sites.filter(site => Number.isFinite(Number(site.loss_pct)) && site.loss_pct != null);
    if (sites.length) { const site = sites.reduce((a,b) => Number(a.loss_pct) >= Number(b.loss_pct) ? a : b); add('bone-review', 'Kemik', 'Kemik yüklenmesi ve eğilimini izle', 'Görev onaylı direnç çalışmasını ve kemik eğilimlerini birlikte değerlendir.', 'advisory', `${site.name}: modellenen kayıp %${Number(site.loss_pct).toFixed(1)}; ölçüm değil, tahmin`); }
  }
  if (!environment?.reading || environment?.freshness?.status !== 'current') {
    add('environment-verify', 'Çevre', 'Kabin bağlamı sensörlerini doğrula',
      'Belirtileri çevreyle birlikte yorumlamadan önce kabin CO₂, sıcaklık ve nem gözlemlerini yenile.',
      'watch', 'Çevresel bağlam eksik veya güncel değil');
  } else {
    add('environment-log', 'Çevre', 'Kabin bağlamını belirtilerle birlikte incele',
      'En son kabin ölçümlerini yalnızca bağlam olarak kullan; bir ilişkiyi neden olarak kabul etme.',
      'normal', `CO₂ ${environment.reading.co2_ppm} ppm · ${environment.reading.temperature_c} °C · nem %${environment.reading.humidity_pct}`);
  }
  add('hydration-log', 'Toparlanma', 'Sıvı alımını ve toparlanmayı kaydet',
    'Yarının önerisinin eksiksiz geri bildirime dayanması için sıvı alımını, uykuyu, ruh hâlini, stresi ve aktivite sonrası belirtileri kaydet.',
    'normal', 'Günlük izleme planı');
  for (const [id, title] of [['fluid_intake','Sıvı alımını gözden geçir'],['kcal_intake','Beslenme kaydını gözden geçir']]) {
    const row = (status?.indicators || []).find(item => item.indicator_id === id);
    if (row?.value != null) add(`nutrition-${id}`, 'Beslenme', title, 'Değeri günlük kontrol ve görev beslenme planıyla birlikte değerlendir.', row.status === 'alert' || row.status === 'watch' ? 'watch' : 'normal', `${row.name}: ${row.value} ${row.unit || ''} · ölçümün güncelliğini kontrol et`);
  }
  if (!status?.freshness || status.freshness.state !== 'current') {
    add('health-check', 'İzleme', 'Günlük sağlık kontrolünü yenile',
      'Hafif doğrulama planının ötesine geçmeden önce yeni bir günlük kontrol tamamla.', 'watch', 'Sağlık ölçümleri güncel değil');
  } else {
    add('post-activity-check', 'İzleme', 'Aktivite sonrası yanıtı kaydet',
      'Seansın ardından tamamlanan dakikayı ve ağrı, baş dönmesi, olağandışı nefes darlığı veya diğer belirtileri kaydet.',
      'normal', 'Güncel sağlık kontrolü mevcut');
  }
  return items;
}

function controllerState(recent, target) {
  if (!recent.length) return { error: null, proportional: 0, integral: 0, derivative: 0, correction: 0, suggested: target, samples: 0 };
  const errors = recent.map((x) => target - x.minutes);
  const error = errors.at(-1);
  const proportional = 0.20 * error;
  const integral = 0.05 * (errors.reduce((sum, x) => sum + x, 0) / errors.length);
  const trend = recent.length > 1 ? recent.at(-1).minutes - recent.at(-2).minutes : 0;
  const derivative = -0.10 * trend;
  const correction = Math.max(-10, Math.min(10, proportional + integral + derivative));
  return { error: Math.round(error * 10) / 10, proportional: Math.round(proportional * 10) / 10, integral: Math.round(integral * 10) / 10, derivative: Math.round(derivative * 10) / 10, correction: Math.round(correction * 10) / 10, suggested: round5(target + correction), samples: recent.length };
}

export function buildAdaptivePlan({ status, points = [], localLogs = [], baseTarget = 60, today = localDay(), gravity = null, environment = null, radiation = null, bone = null }) {
  const target = Math.max(30, Math.min(120, Number(baseTarget) || 60));
  const recent = recentActivity(points, localLogs, today);
  const average = recent.length ? recent.reduce((sum, x) => sum + x.minutes, 0) / recent.length : null;
  const controller = controllerState(recent, target);
  const sleep = latestValue(status, 'sleep_hours');
  const mood = latestValue(status, 'mood');
  const stress = latestValue(status, 'stress');
  const safetyIds = new Set(['heart_rate', 'systolic_bp', 'diastolic_bp', 'spo2', 'body_temp']);
  const safetyAlert = (status.indicators || []).some((x) => safetyIds.has(x.indicator_id) && x.status === 'alert');
  const stale = !status.freshness || status.freshness.state !== 'current';
  const reasons = [];
  let mode = 'steady';
  let minutes = target;

  if (safetyAlert || Number(status.triage && status.triage.level) >= 2) {
    mode = 'hold'; minutes = 20;
    reasons.push('Güvenlik uyarısı bulundu: yoğun egzersiz başlamadan önce gemi sağlık protokolünü izle.');
  } else if (stale) {
    mode = 'verify'; minutes = Math.max(30, round5(target * 0.5));
    reasons.push('Sağlık ölçümü güncel değil: önce yeni kontrol, bu arada yalnızca hafif plan.');
  } else if ((sleep !== null && sleep < 6) || (mood !== null && mood <= 2) || (stress !== null && stress >= 4)) {
    mode = 'recover'; minutes = Math.max(30, round5(target * 0.75));
    reasons.push('Toparlanma göstergelerinden en az biri düşük; bugünkü yük azaltıldı.');
  } else if (average !== null && average < target * 0.75) {
    mode = 'reentry'; minutes = Math.max(45, round5(target * 0.9));
    reasons.push('Son yedi günlük uygulama hedefin altında; sürdürülebilir yeniden giriş planı seçildi.');
  } else if (average !== null && average >= target * 0.95 && (sleep === null || sleep >= 7) && (mood === null || mood >= 3) && (stress === null || stress <= 3)) {
    mode = 'build'; minutes = Math.min(120, round5(target * 1.1));
    reasons.push('Yakın dönem uyumu ve toparlanma uygun; yük küçük bir adımla artırıldı.');
  } else {
    reasons.push(average === null ? 'Yedi günlük geçmiş henüz oluşmadı; görev temel hedefi korunuyor.' : 'Yakın dönem yükü dengeli; görev temel hedefi korunuyor.');
  }

  const previous = [...localLogs].filter((x) => dayOf(x.day) < today).sort((a, b) => dayOf(a.day).localeCompare(dayOf(b.day))).at(-1);
  if (!['hold', 'verify', 'recover'].includes(mode) && previous && Number.isFinite(Number(previous.planned_minutes))) {
    const cap = Number(previous.planned_minutes) + 5;
    if (minutes > cap) { minutes = cap; reasons.push('Günlük artış güvenlik sınırı nedeniyle 5 dakika ile sınırlandı.'); }
  }
  minutes = round5(minutes);
  const gentle = ['hold', 'verify', 'recover'].includes(mode);
  return {
    mode, minutes, base_target: target, recent, average: average === null ? null : Math.round(average * 10) / 10,
    sleep, mood, stress, reasons, controller: { ...controller, output: minutes },
    segments: segmentPlan(minutes, status.mission && status.mission.id, gentle, gravity?.current_g != null && Number.isFinite(Number(gravity.current_g)) ? Number(gravity.current_g) : null),
    recommendations: buildRecommendations({ status, gravity, environment, radiation, bone, points }).sort((a,b) => ({watch:0,advisory:1,normal:2}[a.priority] - {watch:0,advisory:1,normal:2}[b.priority])),
    context: { gravity, environmentFreshness: environment?.freshness || null },
    stop_rules: ['Göğüs ağrısı, baygınlık hissi veya olağandışı nefes darlığında hemen dur.', 'Yeni ağrı veya belirgin baş dönmesinde sağlık protokolünü uygula.', 'Egzersiz sonrası ölçümü ve tamamlanan süreyi kaydet; yarının planı bunu kullanır.'],
    disclaimer: 'Prototip karar desteğidir; uçuş cerrahı veya görev egzersiz protokolünün yerini almaz.',
  };
}
