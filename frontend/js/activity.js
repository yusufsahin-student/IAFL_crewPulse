import {api} from './api.js';
import {initShell,el,statusBadge} from './shell.js';
import {buildAdaptivePlan,localDay} from './activity-core.js';

const root=document.getElementById('activity-root');
const notice=document.getElementById('activity-status');
const today=localDay();
const modeLabel={steady:'TEMEL YÜK',build:'KONTROLLÜ ARTIŞ',reentry:'YENİDEN GİRİŞ',recover:'TOPARLANMA',verify:'ÖNCE ÖLÇÜM',hold:'GÜVENLİK DURAKLATMASI'};
let ctx,status,history,logs,plan,key;

function loadLogs(){try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}}
function saveLogs(){localStorage.setItem(key,JSON.stringify(logs.slice(-90)));}

function render(){
  const todayLog=logs.find(x=>x.day===today)||{};
  const checked=new Set(todayLog.completed_segments||[]);
  const planList=el('div',{class:'activity-plan'});
  for(const segment of plan.segments){
    const box=el('input',{type:'checkbox','aria-label':`${segment.label} tamamlandı`});box.checked=checked.has(segment.id);
    box.addEventListener('change',()=>{box.checked?checked.add(segment.id):checked.delete(segment.id);});
    planList.append(el('label',{class:'activity-block'},box,
      el('span',{class:'activity-block__body'},el('strong',{},segment.label),el('small',{},segment.detail),el('ol',{},segment.steps.map(step=>el('li',{},step)))),
      el('span',{class:'activity-dose'},el('strong',{},`${segment.minutes} dk`),el('small',{},segment.intensity))));
  }
  const actual=el('input',{class:'input',type:'number',min:0,max:300,step:5,value:todayLog.actual_minutes??plan.minutes,'aria-label':'Bugün tamamlanan toplam dakika'});
  const saved=el('p',{role:'status',class:'muted'},todayLog.saved_at?'Bugünkü yerel kayıt güncellendi.':'Henüz bugünkü yerel kayıt yok.');
  const save=el('button',{class:'btn btn--primary',type:'button',onclick:()=>{
    if(!actual.checkValidity()){saved.textContent='Dakikayı 0–300 arasında gir.';actual.focus();return;}
    const entry={day:today,planned_minutes:plan.minutes,actual_minutes:Number(actual.value),mode:plan.mode,completed_segments:[...checked],saved_at:new Date().toISOString()};
    logs=[...logs.filter(x=>x.day!==today),entry].sort((a,b)=>a.day.localeCompare(b.day));
    try{saveLogs();saved.textContent='Bugünkü aktivite bu cihazda kaydedildi. Yarınki plan bu veriyi kullanacak.';}catch{saved.textContent='Tarayıcı depolaması kullanılamıyor; kayıt tutulamadı.';}
  }},'Bugünü kaydet');
  const control=plan.controller;
  const evidence=el('section',{class:'orbit-card'},el('div',{class:'eyebrow'},'GERİ BESLEME DENETLEYİCİSİ'),el('h2',{},'Hedef → ölçüm → düzeltme'),el('p',{class:'muted'},'PID benzeri sınırlı denetleyici son yedi günü izler. Güvenlik ve toparlanma kuralları denetleyici çıktısının her zaman üzerindedir.'),
    el('div',{class:'controller-grid'},
      el('div',{},el('small',{},'Görev hedefi'),el('strong',{},`${plan.base_target} dk`)),
      el('div',{},el('small',{},'7 günlük ortalama'),el('strong',{},plan.average===null?'—':`${plan.average} dk`)),
      el('div',{},el('small',{},'Son gün hatası'),el('strong',{},control.error===null?'—':`${control.error>0?'+':''}${control.error} dk`)),
      el('div',{},el('small',{},'Sınırlı düzeltme'),el('strong',{},`${control.correction>0?'+':''}${control.correction} dk`))),
    el('p',{class:'controller-formula'},`P ${control.proportional} · I ${control.integral} · D ${control.derivative} → güvenlik sonrası ${control.output} dk`),
    el('ul',{class:'activity-reasons'},plan.reasons.map(x=>el('li',{},x))),
    el('dl',{class:'facts'},el('dt',{},'Uyku'),el('dd',{},plan.sleep===null?'—':`${plan.sleep} saat`),el('dt',{},'Ruh hâli'),el('dd',{},plan.mood??'—'),el('dt',{},'Stres'),el('dd',{},plan.stress??'—')));
  const log=el('section',{class:'orbit-card activity-log'},el('div',{class:'eyebrow'},'GÜNLÜK KAYIT'),el('label',{},'Tamamlanan toplam dakika',actual),save,saved,el('a',{class:'btn',href:'checkin.html'},'Resmî günlük kontrole ekle →'));
  root.replaceChildren(
    el('section',{class:'orbit-card'},el('span',{class:'activity-mode'},modeLabel[plan.mode]),el('h2',{},`Bugün: ${plan.minutes} dakikalık plan`),el('p',{},plan.mode==='hold'?'Yoğun egzersize başlama; yalnızca protokol izin veriyorsa hafif hareket uygula.':'Blokları sırasıyla uygula veya gün içine böl. Her bloktan önce ekipmanın görev onayını kontrol et.'),planList,
      el('section',{class:'activity-stop','aria-labelledby':'stop-title'},el('h3',{id:'stop-title'},'Her zaman dur ve değerlendir'),el('ul',{},plan.stop_rules.map(rule=>el('li',{},rule))))),
    el('div',{class:'activity-layout'},evidence,log));
  if(plan.mode==='hold')notice.replaceChildren(el('p',{class:'orbit-notice orbit-notice--alert'},'Tehlike: Sağlık uyarısı nedeniyle yoğun yük durduruldu. Mürettebat sağlık protokolünü izle.'));
  else if(status.freshness?.state!=='current')notice.replaceChildren(el('p',{class:'orbit-notice orbit-notice--watch'},'Dikkat: Plan güncel olmayan ölçümlere göre konservatif tutuldu. Önce günlük kontrolü yenile.'));
}

try{
  ctx=await initShell({page:'activity'});key=`astro-activity-v1:${ctx.astronautId}`;logs=loadLogs();
  [status,history]=await Promise.all([api.status(ctx.astronautId),api.history(ctx.astronautId,14)]);
  const baseTarget=Number(ctx.config.params?.['bone.exercise_target_min'])||120;
  plan=buildAdaptivePlan({status,points:history.points,localLogs:logs,baseTarget,today});render();
}catch(error){root.replaceChildren(el('p',{class:'orbit-error'},error.message||'Fitness planı yüklenemedi.'));}
