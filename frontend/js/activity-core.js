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

function latestValue(status, id) {
  const row = (status.indicators || []).find((item) => item.indicator_id === id);
  if (!row || row.value == null || !Number.isFinite(Number(row.value))) return null;
  const value = Number(row.value);
  if (['mood', 'stress'].includes(id) && (value < 1 || value > 5)) return null;
  return value;
}

function segmentPlan(total, missionId, gentle = false) {
  if (gentle) return [{ id: 'mobility', label: 'Hafif hareket ve mobilite', minutes: total, intensity: 'RPE 1–2 / 10', detail: 'Ağrısız eklem hareketi, nefes ve çok hafif esneme.', steps: ['5 dk kontrollü nefes ve eklem taraması', `${Math.max(10,total-10)} dk ağrısız mobilite`, '5 dk çok hafif soğuma'] }];
  const surface = ['moon', 'mars', 'rover'].includes(missionId);
  const ratios = surface ? [0.35, 0.40, 0.25] : [0.35, 0.45, 0.20];
  const aerobic = round5(total * ratios[0]);
  const resistance = round5(total * ratios[1]);
  const mobility = Math.max(0, total - aerobic - resistance);
  return [
    { id: 'aerobic', label: 'Aerobik karşı önlem', minutes: aerobic, intensity: 'RPE 3–5 / 10', detail: 'Koşu bandı veya bisiklet; konuşmayı sürdürebildiğin kontrollü tempo.', steps: ['5 dk kolay ısınma', `${Math.max(5,aerobic-10)} dk sabit kontrollü tempo`, '5 dk kolay soğuma'] },
    { id: 'resistance', label: 'Direnç ve yükleme', minutes: resistance, intensity: 'RPE 5–7 / 10', detail: 'Alt ve üst vücut büyük kas grupları; yalnızca görev ekipmanının onaylı programı.', steps: ['Onaylı 4–6 temel hareket seç', 'Her hareket 2–3 set × 8–12 tekrar', 'Setler arasında 60–90 sn dinlen'] },
    { id: 'mobility', label: surface ? 'Denge ve mobilite' : 'Mobilite ve soğuma', minutes: mobility, intensity: 'RPE 1–3 / 10', detail: surface ? 'Denge, koordinasyon ve eklem hareket açıklığı.' : 'Eklem hareket açıklığı, gövde kontrolü ve soğuma.', steps: [surface ? 'Destek yakınında denge ve koordinasyon' : 'Omuz, kalça ve omurga mobilitesi', 'Ağrısız aralıkta yavaş tekrarlar', 'Nefes normale dönene kadar soğuma'] },
  ];
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

export function buildAdaptivePlan({ status, points = [], localLogs = [], baseTarget = 60, today = localDay() }) {
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
    sleep, mood, stress, reasons, controller: { ...controller, output: minutes }, segments: segmentPlan(minutes, status.mission && status.mission.id, gentle),
    stop_rules: ['Göğüs ağrısı, baygınlık hissi veya olağandışı nefes darlığında hemen dur.', 'Yeni ağrı veya belirgin baş dönmesinde sağlık protokolünü uygula.', 'Egzersiz sonrası ölçümü ve tamamlanan süreyi kaydet; yarının planı bunu kullanır.'],
    disclaimer: 'Prototip karar desteğidir; uçuş cerrahı veya görev egzersiz protokolünün yerini almaz.',
  };
}
