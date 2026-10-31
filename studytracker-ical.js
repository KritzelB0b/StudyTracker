/* Private iCal timetable subscription. Uses the signed-in StudyTracker API, never a public CORS proxy. */
'use strict';
(()=>{
 const input=document.getElementById('icalFeedUrl');
 const status=document.getElementById('icalFeedStatus');
 const save=document.getElementById('icalFeedSave');
 const refreshButton=document.getElementById('icalFeedRefresh');
 const removeButton=document.getElementById('icalFeedRemove');
 const hideCheckbox=document.getElementById('icalHidePdf');
 if(!input||!status)return;
 const SUB_ID='main';
 const REFRESH_MS=30*60*1000;
 let working=false,lastChecked=0,requestSerial=0;
 const current=()=>db.study?.icalSubscription||null;
 const allowed=()=>!document.body.classList.contains('st-auth-locked')&&!!cloudToken&&cloudActive&&!cloudBusy&&!cloudConflict;
 const countImported=()=>SEMESTERS.reduce((n,t)=>{
  const plan=t.id===LEGACY_TERM?db.study:db.study?.termPlans?.[t.id];
  return n+(plan?.events||[]).filter(e=>e.icalSubscriptionId===SUB_ID).length;
 },0);
 function updateView(message){
  const sub=current(),has=!!sub?.url;
  if(document.activeElement!==input)input.value=has?sub.url:'';
  hideCheckbox.checked=sub?.hideLegacy!==false;
  refreshButton.disabled=working||!has||!allowed();
  save.disabled=working;
  removeButton.disabled=working||!has;
  if(message)status.textContent=message;
  else if(!has)status.textContent='Noch kein iCal-Abonnement hinterlegt.';
  else status.textContent=(sub.lastSuccess?'Abonnement aktiv · ':'Abonnement gespeichert, noch nicht geladen · ')+countImported()+' iCal-Termine. Automatischer Abgleich beim Öffnen und alle 30 Minuten, solange die App geöffnet ist.';
 }
 function normalize(raw){
  let value=String(raw||'').trim();
  if(/^webcal:\/\//i.test(value))value='https://'+value.slice(9);
  if(value.length>2048)throw Error('Der Kalenderlink ist zu lang.');
  let u;
  try{u=new URL(value)}catch(_){throw Error('Bitte einen vollständigen iCal-Link einfügen.')}
  if(u.protocol!=='https:'||!u.hostname||u.username||u.password||!['','443'].includes(u.port))
   throw Error('Erlaubt sind öffentliche HTTPS- oder webcal-Links ohne Benutzername/Passwort in der Adresse.');
  u.hash='';
  return u.toString();
 }
 function plans(){
  const root=studyRoot();
  if(!Array.isArray(root.events))root.events=[];
  if(!root.termPlans)root.termPlans={};
  return root;
 }
 function assignedPlan(root,term){
  if(term.id===LEGACY_TERM)return root;
  if(!root.termPlans[term.id])root.termPlans[term.id]={modules:[],events:[],tasks:[]};
  if(!Array.isArray(root.termPlans[term.id].events))root.termPlans[term.id].events=[];
  return root.termPlans[term.id];
 }
 function applyEvents(list){
  const root=plans(),byTerm=new Map(SEMESTERS.map(t=>[t.id,[]]));
  for(const e of list){
   if(!e||!(/^[a-f0-9]{32}$/).test(e.id)||!/^\d{4}-\d{2}-\d{2}$/.test(e.date)||
      !/^\d{2}:\d{2}$/.test(e.start)||!/^\d{2}:\d{2}$/.test(e.end))throw Error('Kalender enthält ungültige Termine.');
   const term=SEMESTERS.find(t=>e.date>=t.start&&e.date<=t.end);
   if(!term)continue;
   byTerm.get(term.id).push({
    id:'ical-'+e.id,date:e.date,start:e.start,end:e.end,
    name:String(e.name||'Veranstaltung').slice(0,130),
    details:String(e.details||'').slice(0,280),
    source:'iCal-Abonnement',icalSubscriptionId:SUB_ID
   });
  }
  for(const term of SEMESTERS){
   const existing=term.id===LEGACY_TERM?root:root.termPlans[term.id];
   const incoming=byTerm.get(term.id);
   if(!existing&&!incoming.length)continue;
   const target=assignedPlan(root,term);
   // Only own feed-origin records are replaced. Manual, PDF, task and exam data survive.
   target.events=(target.events||[]).filter(e=>e.icalSubscriptionId!==SUB_ID).concat(incoming);
  }
 }
 async function refresh(force=false){
  const sub=current();
  if(!sub?.url||working||!allowed()||!navigator.onLine||document.hidden)return;
  if(!force&&Date.now()-lastChecked<REFRESH_MS)return;
  working=true;
  const serial=++requestSerial,initial=snapshot(),revision=cloudRevision,url=sub.url;
  updateView('iCal-Stundenplan wird sicher abgerufen …');
  try{
   const response=await cloudRequest('/calendar/ical','POST',{url});
   if(serial!==requestSerial)return;
   if(!Array.isArray(response?.events)||response.events.length>2500)throw Error('Ungültige Kalenderantwort.');
   if(response.events.length===0||!response.events.some(e=>SEMESTERS.some(t=>e.date>=t.start&&e.date<=t.end)))throw Error('Der Feed enthält keine Termine für deine Studiensemester. Bisherige Einträge bleiben sicherheitshalber erhalten.');
   if(!allowed()||snapshot()!==initial||cloudRevision!==revision||current()?.url!==url){
    lastChecked=0;
    updateView('Während des Abrufs wurden Daten verändert. Der Abgleich wird erneut versucht.');
    return;
   }
   applyEvents(response.events);
   const next=current();
   next.lastSuccess=new Date().toISOString();
   next.lastCount=response.events.length;
   lastChecked=Date.now();
   persist();
   updateView('iCal-Abgleich erfolgreich: '+countImported()+' Termine aktualisiert · '+new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})+'.');
  }catch(err){
   // A failed feed must never remove previously synced appointments.
   updateView('iCal-Aktualisierung nicht möglich: '+String(err.message||'Netzwerkfehler')+'. Bisherige Termine bleiben erhalten.');
  }finally{
   working=false;
   refreshButton.disabled=!current()?.url||!allowed();
   removeButton.disabled=!current()?.url;
   save.disabled=false;
  }
 }
 save.addEventListener('click',()=>{
  if(!allowed()){updateView('Bitte zuerst mit deinem privaten StudyTracker-Konto anmelden und die Cloud-Synchronisierung abschließen.');return}
  let url;
  try{url=normalize(input.value)}catch(e){updateView(e.message);return}
  const root=studyRoot(),previous=root.icalSubscription;
  const changed=previous?.url!==url;
  root.icalSubscription={id:SUB_ID,url,hideLegacy:hideCheckbox.checked,
   ...(changed?{}:{lastSuccess:previous?.lastSuccess,lastCount:previous?.lastCount})};
  lastChecked=0;
  persist();
  updateView('Abonnement gespeichert. Der erste Abgleich wird gestartet …');
  refresh(true);
 });
 hideCheckbox.addEventListener('change',()=>{
  const sub=current();
  if(!sub||!allowed())return;
  sub.hideLegacy=hideCheckbox.checked;
  persist();
  updateView('Darstellung des alten PDF-Stundenplans geändert.');
 });
 refreshButton.addEventListener('click',()=>{lastChecked=0;refresh(true)});
 removeButton.addEventListener('click',()=>{
  if(!current()||!allowed())return;
  if(!confirm('iCal-Abonnement entfernen und nur dessen importierte Termine löschen? Eigene Termine, Aufgaben und PDF-Plan bleiben erhalten.'))return;
  ++requestSerial;
  const root=studyRoot();
  for(const term of SEMESTERS){
   const plan=term.id===LEGACY_TERM?root:root.termPlans?.[term.id];
   if(Array.isArray(plan?.events))plan.events=plan.events.filter(e=>e.icalSubscriptionId!==SUB_ID);
  }
  delete root.icalSubscription;
  input.value='';
  lastChecked=0;
  persist();
  updateView('Abonnement entfernt. Eigene und frühere PDF-Termine wurden nicht gelöscht.');
 });
 // Browser-only refresh: works on open, return to tab, reconnect, and while app is running.
 function tick(){updateView();refresh(false)}
 window.addEventListener('focus',tick);
 window.addEventListener('online',tick);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)tick()});
 document.addEventListener('st-cloud-credentials',()=>setTimeout(tick,2000));
 setInterval(tick,30*1000);
 updateView();
 setTimeout(tick,1000);
})();
