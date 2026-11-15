import {api} from './api.js';
import {initShell,el,statusBadge,formatDateTime} from './shell.js';
import {routineSummary,badgeMedalSvg} from './routine.js';
let status, ctx;
let mind = null;
const root=document.getElementById('companion');
try {
 ctx=await initShell({page:'home'});
 const health=await api.health();
 status=await api.status(ctx.astronautId);
 const [environment, history] = await Promise.all([
  api.environment(ctx.astronautId),
  api.history(ctx.astronautId, 90).catch(() => null),
 ]);
 document.getElementById('connection').textContent=health.model==='mock'?'DEMO MODE · SIMULATED DATA · RECORDS ARE PREVIEWS':health.data==='simulated'?'HEALTH SERVER · CONNECTED · SIMULATED CREW DATA':'HEALTH SERVER · CONNECTED';
 document.getElementById('crew-line').textContent=`${status.astronaut.name} · Mission day ${status.astronaut.mission_day} · ${status.mission.name}`;
 const taken=status.checkin?.taken_at;
 const stale=status.freshness?.state!=='current';
 document.getElementById('updated').textContent=taken?`${formatDateTime(taken)} · ${stale?'NEW MEASUREMENT REQUIRED':'LAST RECORD'}`:'NO MEASUREMENTS YET';
 document.getElementById('metrics').replaceChildren(...['heart_rate','sleep_hours','mood','reaction_ms'].map(id=>{
  const i=status.indicators.find(x=>x.indicator_id===id);
  return el('article',{class:'metric-tile'},el('small',{},i?.name||id),el('strong',{},i?.value??'—'),el('small',{},i?.unit||''),el('div',{},statusBadge(stale?'missing':i?.status,stale?'Old measurement':undefined)));
 }));
 const cabin=environment.reading;
 if(cabin){
   const source=cabin.source==='device'?'DEVICE':'SIMULATION';
   const card=el('section',{class:'orbit-card orbit-section'},
     el('div',{class:'eyebrow'},`CABIN CONTEXT · ${source}`),
     el('h2',{},'Your environment'),
     el('div',{class:'metric-grid'},
       el('div',{class:'metric-tile'},el('small',{},'CO₂'),el('strong',{},Math.round(cabin.co2_ppm)),el('small',{},'ppm')),
       el('div',{class:'metric-tile'},el('small',{},'Temperature'),el('strong',{},Number(cabin.temperature_c).toFixed(1)),el('small',{},'°C')),
       el('div',{class:'metric-tile'},el('small',{},'Relative humidity'),el('strong',{},Number(cabin.humidity_pct).toFixed(1)),el('small',{},'%'))),
     el('p',{class:'trust-note'},'This is environmental context; it does not change the health score. A simulation value must not be interpreted as a measurement.'));
   document.getElementById('metrics').parentElement.after(card);
 }
 // A solar particle event needs its own shelter instruction; it always raises triage, so show it first.
 if(status.radiation?.active_event){
   document.getElementById('urgent').append(el('p',{class:'orbit-notice orbit-notice--alert'},'Radiation: Solar particle event in progress. Go to the storm shelter now.'));
 }
 if(stale || status.triage.level>0){
   const severity=!stale && status.triage.level>=2?'alert':'watch';
   const cleanMessage=status.triage.headline.replace(/^(Watch|Warning|Caution|Dikkat|Uyar\u0131|Tehlike):\s*/i,'');
   const noticeText=stale?'Caution: Take a new measurement for a current assessment. The values below are the last known record.':`${severity==='alert'?'Danger':'Caution'}: ${cleanMessage}`;
   document.getElementById('urgent').append(el('p',{class:`orbit-notice orbit-notice--${severity}`},noticeText));
 }
 const banner = document.getElementById('streak-banner');
 if(banner){
  const rs = routineSummary({ status, points: history ? history.points || [] : [], config: ctx.config });
  const nextLabel = rs.nextBadgeDays
   ? el('span',{class:'streak-banner__chip'},`Next badge: ${rs.nextBadgeDays} days`)
   : el('span',{class:'streak-banner__chip streak-banner__chip--good'},'All streak badges earned');
  const medals = el('div',{class:'streak-banner__medals'}, rs.badges.map((b)=>
   el('span',{class:`streak-banner__medal${b.earned?' is-earned':''}`, title:`${b.label} · ${b.earned?'Earned':'Locked'}`},
    badgeMedalSvg(b.days, b.earned, 34),
   ),
  ));
  banner.hidden = false;
  banner.replaceChildren(
   el('div',{class:'streak-banner__main'},
    el('div',{class:'eyebrow'},'DAILY ROUTINE & STREAK'),
    el('div',{class:'streak-banner__stats'},
     el('strong',{class:'streak-banner__fire'},'🔥 ', el('span',{},`${rs.currentDays}-day streak`), ' ', el('span',{class:'muted'},`Best: ${rs.bestDays}d`)),
     nextLabel,
     el('span',{class:'streak-banner__chip'},`Daily tasks: ${rs.doneCount}/${rs.totalTasks} completed`),
    ),
   ),
   el('div',{class:'streak-banner__side'},
    medals,
    el('a',{class:'btn', href:'details.html#routine-panel'},'Daily routine →'),
   ),
  );
 }
 const steps=stale?['Record a new daily measurement.','Check the warnings and measurement quality in the new result.']:status.triage.instructions;
 try { mind = JSON.parse(localStorage.getItem(`astro-mind-v1:${ctx.astronautId}`)||'[]').at(-1)||null; } catch {}
 if(mind){
   const recent=Date.now()-Date.parse(mind.at)<24*3600000;
   const section=el('section',{class:'orbit-card orbit-section'},el('div',{class:'eyebrow'},'MIND LOG · LAST SESSION ON THIS DEVICE'),el('h2',{},mind.pvt?`${Math.round(mind.pvt.median_ms)} ms`:'Attention test skipped'),el('p',{},formatDateTime(mind.at)),el('p',{},recent?mind.assessment.message:'This mind check is old. Update it with a new session.'),el('a',{class:'btn',href:'mind.html'},'Open mind check →'));
   document.getElementById('metrics').parentElement.after(section);
   if(recent && ['watch','review'].includes(mind.assessment.state))steps.push(mind.assessment.message);
 }
 const key=`orbit-actions:${ctx.astronautId}:${status.checkin?.id||'none'}:${mind?.at||'none'}`;
 let done=[]; try{done=JSON.parse(localStorage.getItem(key)||'[]');}catch{}
 root.append(el('h3',{},stale?'Update the data first':status.triage.headline),el('p',{class:'muted'},`Ground signal round trip: ${status.triage.reply_minutes} minutes. Response time is additional.`));
 for(const [index,text] of steps.entries()){
  const box=el('input',{type:'checkbox','aria-label':text});box.checked=done.includes(index);
  box.addEventListener('change',()=>{done=box.checked?[...done,index]:done.filter(n=>n!==index);try{localStorage.setItem(key,JSON.stringify(done));}catch{box.checked=false;}});
  root.append(el('label',{},box,el('span',{},text)));
 }
 root.append(el('a',{class:'btn',href:'checkin.html'},'Re-measure and assess →'));
 document.getElementById('export').onclick=()=>{
  const payload={created_at:new Date().toISOString(),kind:'crew-health-handoff',demo:health.model==='mock'||health.data==='simulated',data_source:health.data||health.model,status,mind_checkin:mind,completed_steps:done.map(i=>steps[i]),limitations:'Prototype; estimates are not measurements. No causal inference or diagnosis.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
  const a=el('a',{href:url,download:'crewpulse-handoff.json'});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
}catch(e){root.textContent=(e&&e.message)||'Cannot reach the health server. Check that it is running.';document.getElementById('connection').textContent='SERVER UNREACHABLE';document.getElementById('updated').textContent='SERVER UNREACHABLE';document.getElementById('export').disabled=true;}
