/* One-time opt-in transfer of owner test files. This module never runs automatically.
   Both APIs require owner login, credentials only held in transient browser memory. */
const TEST_API='https://studytracker-privatefiles-api-test.up.railway.app';
const LIVE_API='https://studytracker-api-production-7134.up.railway.app';
const el=id=>document.getElementById(id);
const status=msg=>{el('cloudImportStatus').textContent=msg};
async function apiCall(base,path,token,method='GET',body=null,contentType='application/json'){
 const response=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':contentType}:{})},...(body?{body:contentType==='application/json'?JSON.stringify(body):body}:{}),cache:'no-store'});
 if(!response.ok){let message='HTTP '+response.status;try{const j=await response.json();if(typeof j.detail==='string')message=j.detail}catch{}throw Error(message)}
 return response;
}
async function json(base,path,token,method='GET',body=null){return (await apiCall(base,path,token,method,body)).json()}
function query(filename,folder){const params=new URLSearchParams({filename});if(folder)params.set('folder_id',folder);return '?'+params}
async function runImport(){
 const normalToken=sessionStorage.getItem('studytracker_cloud_token');
 const password=el('cloudImportPassword').value;
 if(!normalToken){status('Bitte zuerst unter „Daten & Einstellungen“ anmelden.');return}
 if(password.length<12){status('Bitte das frühere Testpasswort eingeben (mindestens 12 Zeichen).');return}
 if(!confirm('Ordner, Dateien und PDF-Anmerkungen aus der Test-Cloud in dein normales Konto KOPIEREN? Vorhandene Dateien bleiben erhalten; Testdaten werden nicht gelöscht.'))return;
 const trigger=el('cloudImportStart');trigger.disabled=true;
 let transferred=0,skipped=0,notesTransferred=0,addedFolders=0;
 try{
  status('Testkonto wird geprüft …');
  const login=await fetch(TEST_API+'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'studytracker-test@example.com',password})});
  el('cloudImportPassword').value='';
  if(!login.ok)throw Error('Test-Anmeldung fehlgeschlagen (HTTP '+login.status+').');
  const testToken=(await login.json()).token;
  const testFolders=await json(TEST_API,'/private/folders',testToken);
  const allTargetFolders=await json(LIVE_API,'/private/folders',normalToken);
  if(!Array.isArray(testFolders)||!Array.isArray(allTargetFolders))throw Error('Ungültige Ordnerliste');
  async function folderNamed(name,parent){
   let existing=allTargetFolders.find(f=>f.name===name&&f.parent_id===parent);
   if(existing)return existing.id;
   const created=await json(LIVE_API,'/private/folders',normalToken,'POST',{name,parent_id:parent});
   allTargetFolders.push({...created,parent_id:parent,name});addedFolders++;return created.id;
  }
  const rootId=await folderNamed('Import aus Testversion',null);
  const idMap=new Map([[null,rootId]]);
  const pending=[...testFolders];
  while(pending.length){
   let progress=false;
   for(let i=pending.length-1;i>=0;i--){
    const f=pending[i];
    if(!idMap.has(f.parent_id))continue;
    idMap.set(f.id,await folderNamed(f.name,idMap.get(f.parent_id)));
    pending.splice(i,1);progress=true;
   }
   if(!progress)throw Error('Ungültige Ordnerstruktur der Testdaten');
  }
  for(const [sourceFolder,destFolder] of idMap.entries()){
   const params=sourceFolder?'?folder_id='+encodeURIComponent(sourceFolder):'';
   const sourceFiles=await json(TEST_API,'/private/documents'+params,testToken);
   const destFiles=await json(LIVE_API,'/private/documents?folder_id='+encodeURIComponent(destFolder),normalToken);
   for(const file of sourceFiles){
    status('Kopiere '+(transferred+skipped+1)+': '+file.filename+' …');
    let destination=destFiles.find(f=>f.filename===file.filename&&f.size===file.size);
    if(!destination){
     const raw=await apiCall(TEST_API,'/private/documents/'+encodeURIComponent(file.id),testToken);
     const blob=await raw.blob();
     destination=await json(LIVE_API,'/private/documents'+query(file.filename,destFolder),normalToken,'POST',blob,'application/octet-stream');
     destFiles.push(destination);
     transferred++;
    }else skipped++;
    if(/\.pdf$/i.test(file.filename)){
     const sourceNotes=await json(TEST_API,'/private/documents/'+encodeURIComponent(file.id)+'/notes',testToken);
     const targetNotes=await json(LIVE_API,'/private/documents/'+encodeURIComponent(destination.id)+'/notes',normalToken);
     const hasSource=(sourceNotes?.data?.bookmarks?.length||Object.values(sourceNotes?.data?.pages||{}).some(p=>p?.notes?.length||p?.links?.length||p?.strokes?.length));
     const hasTarget=(targetNotes?.revision>0);
     if(hasSource&&!hasTarget){
      await json(LIVE_API,'/private/documents/'+encodeURIComponent(destination.id)+'/notes',normalToken,'PUT',{data:sourceNotes.data,revision:0});
      notesTransferred++;
     }
    }
   }
  }
  status('Übernahme abgeschlossen: '+transferred+' Dateien, '+addedFolders+' Ordner und '+notesTransferred+' Anmerkungssätze kopiert. '+skipped+' bereits vorhandene Dateien übersprungen. Die Testdaten bleiben erhalten.');
  el('cloudFilesReload')?.click();
 }catch(e){status('Übernahme unterbrochen: '+e.message+'. Bereits übertragene Dateien bleiben bestehen. Du kannst die Übernahme erneut starten.')}
 finally{el('cloudImportPassword').value='';trigger.disabled=false}
}
el('cloudImportStart')?.addEventListener('click',()=>void runImport());
