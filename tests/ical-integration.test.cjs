const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const script=fs.readFileSync('studytracker-ical.js','utf8');
const id=n=>n.repeat(32);
const appointment=(hex,date,name='Technische Mechanik')=>({
 id:id(hex),date,start:'08:00',end:'11:00',name,details:'Raum A'
});

function setup(){
 const els={},listeners={};
 for(const name of ['icalFeedUrl','icalFeedStatus','icalFeedSave',
                     'icalFeedRefresh','icalFeedRemove','icalHidePdf']){
  els[name]={value:'',checked:true,disabled:false,textContent:'',
    addEventListener:(type,fn)=>{listeners[name+':'+type]=fn;}};
 }
 const doc={hidden:false,activeElement:els.icalFeedUrl,
   body:{classList:{contains:()=>false}},
   getElementById:name=>els[name],
   addEventListener(){}};
 const app={db:{study:{events:[
  {id:'pdf',source:'Stundenplan WS26/27 Gruppe 5 (Plan)',date:'2026-11-02',start:'08:00',end:'10:00',name:'Altes PDF'},
  {id:'own',date:'2026-11-02',start:'14:00',end:'15:00',name:'Eigener Termin'}
 ],tasks:[{id:'task',kind:'study'}],termPlans:{}}},saved:0,feed:[],fail:false};
 const context={
  document:doc,window:{addEventListener(){}},
  navigator:{onLine:true},URL,confirm:()=>true,
  setInterval(){},setTimeout(){},console,
  SEMESTERS:[
   {id:'ws-2026',start:'2026-10-01',end:'2027-03-31'},
   {id:'ss-2027',start:'2027-04-01',end:'2027-09-30'}
  ],LEGACY_TERM:'ws-2026',
  get db(){return app.db;},cloudToken:'valid',cloudActive:true,cloudBusy:false,
  cloudConflict:false,cloudRevision:2,
  studyRoot:()=>app.db.study,
  snapshot:()=>JSON.stringify(app.db),
  persist:()=>{app.saved++;},
  cloudRequest:async (_path,_method,_body)=>{
   if(app.fail)throw Error('Server nicht erreichbar');
   return {events:app.feed};
  }
 };
 vm.runInNewContext(script,context);
 const fire=(name,type='click')=>listeners[name+':'+type]();
 const drain=()=>new Promise(resolve=>setImmediate(resolve));
 return {els,app,fire,drain};
}

test('feed updates and removes only iCal items, preserving the PDF and private study entries',async()=>{
 const {app,els,fire,drain}=setup();
 app.feed=[appointment('a','2026-11-02'),appointment('b','2027-05-03','CAD')];
 els.icalFeedUrl.value='webcal://example.edu/feed.ics?token=secret';
 fire('icalFeedSave');await drain();
 assert.equal(app.db.study.icalSubscription.url,'https://example.edu/feed.ics?token=secret');
 assert.equal(app.db.study.events.length,3);
 assert.equal(app.db.study.termPlans['ss-2027'].events.length,1);
 assert.equal(app.db.study.tasks[0].id,'task');
 assert.ok(!els.icalFeedStatus.textContent.includes('token=secret'));

 app.feed=[appointment('c','2026-11-09'),appointment('b','2027-05-03','CAD neu')];
 fire('icalFeedRefresh');await drain();
 assert.deepEqual(app.db.study.events.filter(e=>e.icalSubscriptionId==='main').map(e=>e.id),['ical-'+id('c')]);
 assert.equal(app.db.study.events.some(e=>e.id==='own'),true);
 assert.equal(app.db.study.events.some(e=>e.id==='pdf'),true);
 assert.equal(app.db.study.termPlans['ss-2027'].events[0].name,'CAD neu');

 app.feed=[];
 fire('icalFeedRefresh');await drain();
 assert.equal(app.db.study.events.some(e=>e.id==='ical-'+id('c')),true);
 app.fail=true;
 fire('icalFeedRefresh');await drain();
 assert.equal(app.db.study.events.some(e=>e.id==='ical-'+id('c')),true);

 fire('icalFeedRemove');
 assert.equal(app.db.study.events.length,2);
 assert.equal(app.db.study.termPlans['ss-2027'].events.length,0);
 assert.equal(app.db.study.tasks[0].id,'task');
 assert.equal(app.db.study.icalSubscription,undefined);
});
