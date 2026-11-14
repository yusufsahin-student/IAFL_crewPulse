import {api} from './api.js';
import {initShell,el,formatDate} from './shell.js';
import {buildAdaptivePlan,localDay} from './activity-core.js';

const root=document.getElementById('activity-root');
const notice=document.getElementById('activity-status');
const today=localDay();
const modeLabel={steady:'TEMEL YÜK',build:'KONTROLLÜ ARTIŞ',reentry:'YENİDEN GİRİŞ',recover:'TOPARLANMA',verify:'ÖNCE ÖLÇÜM',hold:'GÜVENLİK DURAKLATMASI'};
const priorityLabel={watch:'ÖNCE KONTROL ET',advisory:'PLANA DAHİL ET',normal:'GÜNLÜK TAKİP'};
let ctx,status,history,gravity,environment,logs,plan,key,legacyKey;

function loadLogs(){try{return JSON.parse(localStorage.getItem(key)||localStorage.getItem(legacyKey)||'[]');}catch{return [];}}
function saveLogs(){localStorage.setItem(key,JSON.stringify(logs.slice(-90)));}

function contextCard(){
  const g=plan.context.gravity;
  const envState=environment?.freshness?.status||'missing';
  const envText=envState==='current'?'Güncel':envState==='stale'?'Eski':'Eksik';
  return el('section',{class:'orbit-card'},
    el('div',{class:'eyebrow'},'BÜTÜNLEŞİK GÖREV BAĞLAMI'),el('h2',{},'Planı etkileyen katmanlar'),
    el('div',{class:'activity-context-grid'},
      el('div',{},el('small',{},'Yerel yerçekimi'),el('strong',{},g?`${Number(g.current_g).toFixed(3)} g`:'—'),el('span',{},g?`Yük açığı %${Number(g.load_deficit_pct||0).toFixed(1)}`:'Veri yok')),
      el('div',{},el('small',{},'Alan geçişleri'),el('strong',{},g?String(g.transition_count||0):'—'),el('span',{},'Seçili zaman aralığı')),
      el('div',{},el('small',{},'Kabin ortamı'),el('strong',{},envText),el('span',{},environment?.freshness?.observed_at?formatDate(environment.freshness.observed_at):'Son ölçüm yok')),
      el('div',{},el('small',{},'Sağlık kontrolü'),el('strong',{},status.freshness?.state==='current'?'Güncel':'Yenile'),el('span',{},Number.isFinite(Number(status.freshness?.age_hours))?`${Number(status.freshness.age_hours).toFixed(1)} saat önce`:'Son ölçüm yok'))),
    el('p',{class:'muted'},'Bu katmanlar önerinin bağlamını ve güvenlik seviyesini değiştirir; tek başına tanı veya kesin neden üretmez.'));
}

function render(){
  const todayLog=logs.find(x=>x.day===today)||{};
  const checked=new Set(todayLog.completed_segments||[]);
  const recommendationChecks=new Set(todayLog.completed_recommendations||[]);
  const planList=el('div',{class:'activity-plan'});
  for(const segment of plan.segments){
    const box=el('input',{type:'checkbox','aria-label':`${segment.label} tamamlandı`});box.checked=checked.has(segment.id);
    box.addEventListener('change',()=>{box.checked?checked.add(segment.id):checked.delete(segment.id);});
    planList.append(el('label',{class:'activity-block'},box,
      el('span',{class:'activity-block__body'},el('strong',{},segment.label),el('small',{},segment.detail),el('ol',{},segment.steps.map(step=>el('li',{},step)))),
      el('span',{class:'activity-dose'},el('strong',{},`${segment.minutes} dk`),el('small',{},segment.intensity))));
  }
  const recommendationList=el('div',{class:'recommendation-list'});
  for(const item of plan.recommendations){
    const box=el('input',{type:'checkbox','aria-label':`${item.title} tamamlandı`});box.checked=recommendationChecks.has(item.id);
    box.addEventListener('change',()=>{box.checked?recommendationChecks.add(item.id):recommendationChecks.delete(item.id);});
    recommendationList.append(el('label',{class:`recommendation-card recommendation-card--${item.priority}`},box,
      el('span',{class:'recommendation-card__body'},el('span',{class:'recommendation-meta'},el('span',{class:'eyebrow'},item.category),el('span',{class:`recommendation-priority recommendation-priority--${item.priority}`},priorityLabel[item.priority])),
        el('strong',{},item.title),el('span',{},item.detail),el('small',{class:'recommendation-basis'},`Dayanak: ${item.basis}`))));
  }
  const actual=el('input',{class:'input',type:'number',min:0,max:300,step:5,value:todayLog.actual_minutes??plan.minutes,'aria-label':'Bugün tamamlanan toplam dakika'});
  const saved=el('p',{role:'status',class:'muted'},todayLog.saved_at?'Bugünkü yerel kayıt güncellendi.':'Henüz bugünkü yerel kayıt yok.');
  const save=el('button',{class:'btn btn--primary',type:'button',onclick:()=>{
    if(!actual.checkValidity()){saved.textContent='Dakikayı 0–300 arasında gir.';actual.focus();return;}
    const entry={day:today,planned_minutes:plan.minutes,actual_minutes:Number(actual.value),mode:plan.mode,completed_segments:[...checked],completed_recommendations:[...recommendationChecks],saved_at:new Date().toISOString()};
    logs=[...logs.filter(x=>x.day!==today),entry].sort((a,b)=>a.day.localeCompare(b.day));
    try{saveLogs();saved.textContent='Bugünkü aktivite ve öneriler bu cihazda kaydedildi. Yarınki plan bu geri bildirimi kullanacak.';}catch{saved.textContent='Tarayıcı depolaması kullanılamıyor; kayıt tutulamadı.';}
  }},'Aktivite ve önerileri kaydet');
  const control=plan.controller;
  const evidence=el('section',{class:'orbit-card'},el('div',{class:'eyebrow'},'GERİ BESLEME DENETLEYİCİSİ'),el('h2',{},'Hedef → ölçüm → düzeltme'),el('p',{class:'muted'},'Sınırlı denetleyici son yedi günü izler. Güvenlik, toparlanma ve görev bağlamı denetleyici çıktısının her zaman üzerindedir.'),
    el('div',{class:'controller-grid'},
      el('div',{},el('small',{},'Görev hedefi'),el('strong',{},`${plan.base_target} dk`)),
      el('div',{},el('small',{},'7 günlük ortalama'),el('strong',{},plan.average===null?'—':`${plan.average} dk`)),
      el('div',{},el('small',{},'Son gün hatası'),el('strong',{},control.error===null?'—':`${control.error>0?'+':''}${control.error} dk`)),
      el('div',{},el('small',{},'Sınırlı düzeltme'),el('strong',{},`${control.correction>0?'+':''}${control.correction} dk`))),
    el('p',{class:'controller-formula'},`P ${control.proportional} · I ${control.integral} · D ${control.derivative} → güvenlik sonrası ${control.output} dk`),
    el('ul',{class:'activity-reasons'},plan.reasons.map(x=>el('li',{},x))),
    el('dl',{class:'facts'},el('dt',{},'Uyku'),el('dd',{},plan.sleep===null?'—':`${plan.sleep} saat`),el('dt',{},'Ruh hâli'),el('dd',{},plan.mood??'—'),el('dt',{},'Stres'),el('dd',{},plan.stress??'—')));
  const log=el('section',{class:'orbit-card activity-log'},el('div',{class:'eyebrow'},'GÜNLÜK GERİ BİLDİRİM'),el('label',{},'Tamamlanan toplam dakika',actual),save,saved,el('a',{class:'btn',href:'checkin.html'},'Resmî günlük kontrole ekle →'));
  root.replaceChildren(
    contextCard(),
    el('section',{class:'orbit-card'},el('span',{class:'activity-mode'},modeLabel[plan.mode]),el('h2',{},`Bugün: ${plan.minutes} dakikalık aktivite planı`),el('p',{},plan.mode==='hold'?'Yoğun egzersize başlama; yalnızca protokol izin veriyorsa hafif hareket uygula.':'Blokları sırasıyla uygula veya gün içine böl. Her bloktan önce ekipmanın görev onayını kontrol et.'),planList,
      el('section',{class:'activity-stop','aria-labelledby':'stop-title'},el('h3',{id:'stop-title'},'Her zaman dur ve değerlendir'),el('ul',{},plan.stop_rules.map(rule=>el('li',{},rule))))),
    el('section',{class:'orbit-card'},el('div',{class:'eyebrow'},'ACTIVITY & RECOMMENDATIONS'),el('h2',{},'Bugünün izlenebilir önerileri'),el('p',{class:'muted'},'Her öneri hangi veri katmanına dayandığını gösterir. Tamamladıklarını işaretleyip günlük geri bildirime kaydet.'),recommendationList),
    el('div',{class:'activity-layout'},evidence,log));
  if(plan.mode==='hold')notice.replaceChildren(el('p',{class:'orbit-notice orbit-notice--alert'},'Tehlike: Sağlık uyarısı nedeniyle yoğun yük durduruldu. Mürettebat sağlık protokolünü izle.'));
  else if(status.freshness?.state!=='current')notice.replaceChildren(el('p',{class:'orbit-notice orbit-notice--watch'},'Dikkat: Plan güncel olmayan ölçümlere göre konservatif tutuldu. Önce günlük kontrolü yenile.'));
}

try{
  ctx=await initShell({page:'activity'});key=`astro-activity-v2:${ctx.astronautId}`;legacyKey=`astro-activity-v1:${ctx.astronautId}`;logs=loadLogs();
  [status,history,gravity,environment]=await Promise.all([api.status(ctx.astronautId),api.history(ctx.astronautId,14),api.gravity(ctx.astronautId,null,60).catch(()=>null),api.environment(ctx.astronautId,null,60).catch(()=>null)]);
  const baseTarget=Number(ctx.config.params?.['bone.exercise_target_min'])||120;
  plan=buildAdaptivePlan({status,points:history.points,localLogs:logs,baseTarget,today,gravity:gravity?.assessment||null,environment});render();
}catch(error){root.replaceChildren(el('p',{class:'orbit-error'},error.message||'Aktivite ve öneriler yüklenemedi.'));}
