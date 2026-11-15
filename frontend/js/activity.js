import {api} from './api.js';
import {initShell,el,formatDate} from './shell.js';
import {buildAdaptivePlan,localDay} from './activity-core.js';

const root=document.getElementById('activity-root');
const notice=document.getElementById('activity-status');
const today=localDay();
const modeLabel={steady:'BASE LOAD',build:'CONTROLLED INCREASE',reentry:'RE-ENTRY',recover:'RECOVERY',verify:'MEASURE FIRST',hold:'SAFETY HOLD'};
const priorityLabel={watch:'CHECK FIRST',advisory:'ADD TO PLAN',normal:'DAILY TRACKING'};
let ctx,status,history,gravity,environment,radiation,bone,logs,plan,key,legacyKey;

function loadLogs(){try{return JSON.parse(localStorage.getItem(key)||localStorage.getItem(legacyKey)||'[]');}catch{return [];}}
function saveLogs(){localStorage.setItem(key,JSON.stringify(logs.slice(-90)));}

function contextCard(){
  const g=plan.context.gravity;
  const envState=environment?.freshness?.status||'missing';
  const envText=envState==='current'?'Current':envState==='stale'?'Stale':'Missing';
  return el('section',{class:'orbit-card'},
    el('div',{class:'eyebrow'},'INTEGRATED MISSION CONTEXT'),el('h2',{},'Layers that affect the plan'),
    el('div',{class:'activity-context-grid'},
      el('div',{},el('small',{},'Local gravity'),el('strong',{},g?`${Number(g.current_g).toFixed(3)} g`:'—'),el('span',{},g?`Load deficit ${Number(g.load_deficit_pct||0).toFixed(1)}%`:'No data')),
      el('div',{},el('small',{},'Field transitions'),el('strong',{},g?String(g.transition_count||0):'—'),el('span',{},'Selected time window')),
      el('div',{},el('small',{},'Cabin environment'),el('strong',{},envText),el('span',{},environment?.freshness?.observed_at?formatDate(environment.freshness.observed_at):'No reading yet')),
      el('div',{},el('small',{},'Health check-in'),el('strong',{},status.freshness?.state==='current'?'Current':'Refresh'),el('span',{},Number.isFinite(Number(status.freshness?.age_hours))?`${Number(status.freshness.age_hours).toFixed(1)} h ago`:'No reading yet'))),
    el('p',{class:'muted'},'These layers change the context and safety level of each recommendation; on their own they do not give a diagnosis or a definite cause.'));
}

function render(){
  const todayLog=logs.find(x=>x.day===today)||{};
  const checked=new Set(todayLog.completed_segments||[]);
  const recommendationChecks=new Set(todayLog.completed_recommendations||[]);
  const planList=el('div',{class:'activity-plan'});
  for(const segment of plan.segments){
    const box=el('input',{type:'checkbox','aria-label':`${segment.label} completed`});box.checked=checked.has(segment.id);
    box.addEventListener('change',()=>{box.checked?checked.add(segment.id):checked.delete(segment.id);});
    planList.append(el('label',{class:'activity-block'},box,
      el('span',{class:'activity-block__body'},el('strong',{},segment.label),el('small',{},segment.detail),el('ol',{},segment.steps.map(step=>el('li',{},step)))),
      el('span',{class:'activity-dose'},el('strong',{},`${segment.minutes} min`),el('small',{},segment.intensity))));
  }
  const recommendationList=el('div',{class:'recommendation-list'});
  for(const item of plan.recommendations){
    const box=el('input',{type:'checkbox','aria-label':`${item.title} completed`});box.checked=recommendationChecks.has(item.id);
    box.addEventListener('change',()=>{box.checked?recommendationChecks.add(item.id):recommendationChecks.delete(item.id);});
    recommendationList.append(el('div',{class:`recommendation-card recommendation-card--${item.priority}`},box,
      el('div',{class:'recommendation-card__body'},el('div',{class:'recommendation-meta'},el('span',{class:'eyebrow'},item.category),el('span',{class:`recommendation-priority recommendation-priority--${item.priority}`},priorityLabel[item.priority])),
        el('strong',{},item.title),el('details',{},el('summary',{},'Details and basis'),el('p',{},item.detail),el('small',{class:'recommendation-basis'},`Basis: ${item.basis}`)))));
  }
  const actual=el('input',{class:'input',type:'number',min:0,max:300,step:1,value:todayLog.actual_minutes??0,'aria-label':'Total minutes completed today'});
  const saved=el('p',{role:'status',class:'muted'},todayLog.saved_at?"Today's local record was updated.":'There is no local record for today yet.');
  const save=el('button',{class:'btn btn--primary',type:'button',onclick:()=>{
    if(!actual.checkValidity()){saved.textContent='Enter minutes between 0 and 300.';actual.focus();return;}
    const entry={day:today,planned_minutes:plan.minutes,actual_minutes:Number(actual.value),mode:plan.mode,completed_segments:[...checked],completed_recommendations:[...recommendationChecks],saved_at:new Date().toISOString()};
    logs=[...logs.filter(x=>x.day!==today),entry].sort((a,b)=>a.day.localeCompare(b.day));
    try{saveLogs();saved.textContent="Today's activity and recommendations were saved on this device. Tomorrow's plan will use this feedback.";}catch{saved.textContent='Browser storage is unavailable; the record could not be saved.';}
  }},'Save activity and recommendations');
  const control=plan.controller;
  const evidence=el('section',{class:'orbit-card'},el('div',{class:'eyebrow'},'FEEDBACK CONTROLLER'),el('h2',{},'Target → measurement → correction'),el('p',{class:'muted'},'The bounded controller tracks the last seven days. Safety, recovery and mission context always override its output.'),
    el('div',{class:'controller-grid'},
      el('div',{},el('small',{},'Mission target'),el('strong',{},`${plan.base_target} min`)),
      el('div',{},el('small',{},'7-day average'),el('strong',{},plan.average===null?'—':`${plan.average} min`)),
      el('div',{},el('small',{},'Last-day error'),el('strong',{},control.error===null?'—':`${control.error>0?'+':''}${control.error} min`)),
      el('div',{},el('small',{},'Bounded correction'),el('strong',{},`${control.correction>0?'+':''}${control.correction} min`))),
    el('p',{class:'controller-formula'},`P ${control.proportional} · I ${control.integral} · D ${control.derivative} → after safety ${control.output} min`),
    el('ul',{class:'activity-reasons'},plan.reasons.map(x=>el('li',{},x))),
    el('dl',{class:'facts'},el('dt',{},'Sleep'),el('dd',{},plan.sleep===null?'—':`${plan.sleep} h`),el('dt',{},'Mood'),el('dd',{},plan.mood??'—'),el('dt',{},'Stress'),el('dd',{},plan.stress??'—')));
  const log=el('section',{class:'orbit-card activity-log'},el('div',{class:'eyebrow'},'DAILY FEEDBACK'),el('label',{},'Total minutes completed',actual),save,saved,el('a',{class:'btn',href:'checkin.html'},'Add to official daily check-in →'));
  root.replaceChildren(
    contextCard(),
    el('section',{class:'orbit-card'},el('span',{class:'activity-mode'},modeLabel[plan.mode]),el('h2',{},`Today: ${plan.minutes}-minute activity plan`),el('p',{},plan.mode==='hold'?'Do not start intense exercise; use light movement only if the protocol permits it.':'Complete the blocks in order or split them across the day. Check mission approval for the equipment before each block.'),planList,
      el('section',{class:'activity-stop','aria-labelledby':'stop-title'},el('h3',{id:'stop-title'},'Always stop and assess'),el('ul',{},plan.stop_rules.map(rule=>el('li',{},rule))))),
    el('section',{class:'orbit-card'},el('div',{class:'eyebrow'},'ACTIVITY & RECOMMENDATIONS'),el('h2',{},"Today's traceable recommendations"),el('p',{class:'muted'},'Each recommendation shows the data layer it rests on. Tick what you completed and save it in the daily feedback.'),recommendationList),
    el('div',{class:'activity-layout'},evidence,log));
  if(plan.mode==='hold')notice.replaceChildren(el('p',{class:'orbit-notice orbit-notice--alert'},'Danger: A health warning has paused intense load. Follow the crew health protocol.'));
  else if(status.freshness?.state!=='current')notice.replaceChildren(el('p',{class:'orbit-notice orbit-notice--watch'},'Caution: The plan is conservative because the readings are out of date. Refresh the daily check-in first.'));
}

try{
  ctx=await initShell({page:'activity'});key=`astro-activity-v2:${ctx.astronautId}`;legacyKey=`astro-activity-v1:${ctx.astronautId}`;logs=loadLogs();
  [status,history,gravity,environment,radiation,bone]=await Promise.all([api.status(ctx.astronautId),api.history(ctx.astronautId,14),api.gravity(ctx.astronautId,null,60).catch(()=>null),api.environment(ctx.astronautId,null,60).catch(()=>null),api.radiation(ctx.astronautId).catch(()=>null),api.bone(ctx.astronautId).catch(()=>null)]);
  const baseTarget=Number(ctx.config.params?.['bone.exercise_target_min'])||120;
  plan=buildAdaptivePlan({status,points:history.points,localLogs:logs,baseTarget,today,gravity:gravity?.assessment||null,environment,radiation,bone});render();
}catch(error){root.replaceChildren(el('p',{class:'orbit-error'},error.message||'Activity and recommendations could not be loaded.'));}
