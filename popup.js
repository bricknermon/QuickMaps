
let currentFilter = 'both';
let currentUnits = 'imperial';
const chipFilterAddresses = document.getElementById('chipFilterAddresses');
const chipFilterCities = document.getElementById('chipFilterCities');
const chipFilterBoth = document.getElementById('chipFilterBoth');
const chipUnitsMi = document.getElementById('chipUnitsMi');
const chipUnitsKm = document.getElementById('chipUnitsKm');

function syncChipsFromStorage(){
  chrome.storage.local.get({filter:'both', units:'imperial'}, s => {
    currentFilter = s.filter; currentUnits = s.units;
    if (chipFilterAddresses) chipFilterAddresses.checked = (currentFilter==='addresses');
    if (chipFilterCities) chipFilterCities.checked = (currentFilter==='cities');
    if (chipFilterBoth) chipFilterBoth.checked = (currentFilter==='both');
    if (chipUnitsMi) chipUnitsMi.checked = (currentUnits==='imperial');
    if (chipUnitsKm) chipUnitsKm.checked = (currentUnits==='metric');
  });
}
syncChipsFromStorage();

[chipFilterAddresses, chipFilterCities, chipFilterBoth].forEach(el=>{
  if(!el) return;
  el.addEventListener('change', ()=>{
    currentFilter = el.value;
    chrome.storage.local.set({filter: currentFilter});
  });
});
[chipUnitsMi, chipUnitsKm].forEach(el=>{
  if(!el) return;
  el.addEventListener('change', ()=>{
    currentUnits = el.value === 'metric' ? 'metric' : 'imperial';
    chrome.storage.local.set({units: currentUnits});
  });
});

const form = document.getElementById("form");
const homeInput = document.getElementById("home-address");
const homeSave  = document.getElementById("home-address-save");
const destInput = document.getElementById("destination-address");
const destSave  = document.getElementById("destination-address-save");
const submitBtn = document.getElementById("submit-button");
const travelEl  = document.getElementById("travel-time");
const milesEl   = document.getElementById("mile-count");
const linkEl    = document.getElementById("directions-link");
const homeList  = document.getElementById("home-suggestions");
const destList  = document.getElementById("dest-suggestions");
const stopsWrap = document.getElementById("stops");
const addStopBtn= document.getElementById("add-stop");
const saveTripBtn = document.getElementById("saveTrip");
const clearBtn = document.getElementById('clear-button');

const sidebarToggle = document.getElementById("sidebarToggle");
const sidebar = document.getElementById("sidebar");
const tabTrips = document.getElementById("tabTrips");
const tabHistory = document.getElementById("tabHistory");
const panelTrips = document.getElementById("panelTrips");
const panelHistory = document.getElementById("panelHistory");
const tripList = document.getElementById("tripList");
const tripSort = document.getElementById("tripSort");
const historyList = document.getElementById("historyList");
const historyClearRange = document.getElementById("historyClearRange");

let acSessionToken=(globalThis.crypto&&crypto.randomUUID)?crypto.randomUUID():String(Date.now());
const HISTORY_CAP=50;
function fmtTime(ts){ try{ return new Date(ts).toLocaleString(); }catch{ return ''; } }

// Save address toggles
try {
  const h=localStorage.getItem("homeAddress"), d=localStorage.getItem("destinationAddress");
  if(h){homeInput.value=h; homeSave.checked=true;}
  if(d){destInput.value=d; destSave.checked=true;}
} catch {}
homeSave.addEventListener("click",()=>{try{homeSave.checked?localStorage.setItem("homeAddress",homeInput.value):localStorage.removeItem("homeAddress")}catch{}});
destSave.addEventListener("click",()=>{try{destSave.checked?localStorage.setItem("destinationAddress",destInput.value):localStorage.removeItem("destinationAddress")}catch{}});

function hideDirections(){ linkEl.hidden=true; linkEl.removeAttribute("href"); }
function clearForm(){
  // Clear inputs
  homeInput.value='';
  destInput.value='';
  // Remove stops
  stopsWrap.innerHTML='';
  // Clear results
  travelEl.textContent='';
  milesEl.textContent='';
  hideDirections();
  // Clear datalists
  homeList.innerHTML='';
  destList.innerHTML='';
  // Focus home for new search
  setTimeout(()=>homeInput.focus(), 50);
}

hideDirections();
homeInput.addEventListener("input", hideDirections);
destInput.addEventListener("input", hideDirections);

// ---- Autocomplete ----
function wireAutocomplete(inputEl, listEl){ inputEl.setAttribute('autocomplete','new-password'); inputEl.setAttribute('name','addr'); inputEl.setAttribute('data-lpignore','true');
  let timer = null;
  let ignoreNext = false;

  function fetchPredictions(q){
    chrome.runtime.sendMessage({type:'AUTOCOMPLETE',input:q,sessiontoken:acSessionToken,filter: currentFilter}, (resp)=>{
      listEl.innerHTML='';
      if(!resp||!resp.ok) return;
      const arr = resp.predictions || [];
      for(let i=0;i<Math.min(arr.length,5);i++){
        const opt=document.createElement('option'); opt.value=arr[i]; listEl.appendChild(opt);
      }
    });
  }

  inputEl.addEventListener('input', ()=>{
    if (ignoreNext){ ignoreNext=false; return; }
    if (timer) clearTimeout(timer);
    const q=inputEl.value.trim();
    if(!q){ listEl.innerHTML=''; return; }
    timer=setTimeout(()=>fetchPredictions(q), 160);
  });

  inputEl.addEventListener('change', ()=>{ listEl.innerHTML=''; ignoreNext=true; });
  inputEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ listEl.innerHTML=''; }});
  inputEl.addEventListener('blur', ()=>{ setTimeout(()=>{ listEl.innerHTML=''; }, 80); });
}
wireAutocomplete(homeInput, homeList);
/* dest uses custom dropdown */
wireCustomDest(destInput, document.getElementById('dest-custom-suggest'));

// ---- Stops ----
function renumberStops(){
  const rows=Array.from(stopsWrap.children);
  rows.forEach((row,i)=>{
    const n=i+1;
    const label=row.querySelector('.stop-label');
    if(label) label.textContent='Stop '+n;
  });
}
function makeStopRow(value=''){
  const row=document.createElement('div');
  row.className='field stop-row';
  const label=document.createElement('label'); label.className='stop-label'; label.textContent='Stop';
  const input=document.createElement('input'); input.type='text'; input.placeholder='Add a stop…'; input.value=value;
  input.setAttribute('list', ''); input.autocomplete='off'; input.autocorrect='off'; input.autocapitalize='off'; input.spellcheck=false;
  const list=document.createElement('datalist'); const dlid='stop-'+Date.now()+Math.random(); list.id=dlid; input.setAttribute('list', dlid);
  const actions=document.createElement('div'); actions.className='actions';
  const up=document.createElement('button'); up.type='button'; up.className='btn small'; up.title='Move up'; up.textContent='↑';
  const down=document.createElement('button'); down.type='button'; down.className='btn small'; down.title='Move down'; down.textContent='↓';
  const del=document.createElement('button'); del.type='button'; del.className='btn small'; del.title='Remove'; del.textContent='🗑';
  actions.append(up,down,del);
  row.append(label,input,list,actions);
  wireAutocomplete(input,list);
  up.addEventListener('click',()=>{ const prev=row.previousElementSibling; if(prev){ stopsWrap.insertBefore(row,prev); renumberStops(); }});
  down.addEventListener('click',()=>{ const next=row.nextElementSibling; if(next){ stopsWrap.insertBefore(next,row); renumberStops(); }});
  del.addEventListener('click',(e)=>{ e.preventDefault(); e.stopPropagation(); row.remove(); renumberStops(); hideDirections(); });
  return row;
}
addStopBtn.addEventListener('click',()=>{ stopsWrap.appendChild(makeStopRow()); renumberStops(); });

// ---- Sidebar toggle + tabs ----
if (sidebarToggle && sidebar) sidebarToggle.addEventListener('click', ()=>{
  sidebar.classList.toggle('open');
  document.body.classList.toggle('sidebar-open', sidebar.classList.contains('open'));
});
if (tabTrips && tabHistory && panelTrips && panelHistory){
  tabTrips.addEventListener('click', ()=>{ tabTrips.classList.add('active'); tabHistory.classList.remove('active'); panelTrips.classList.remove('hidden'); panelHistory.classList.add('hidden'); });
  tabHistory.addEventListener('click', ()=>{ tabHistory.classList.add('active'); tabTrips.classList.remove('active'); panelHistory.classList.remove('hidden'); panelTrips.classList.add('hidden'); });
}

// ---- Trips storage ----
function getTrips(cb){ chrome.storage.local.get({trips:[]}, d=>cb(d.trips)); }
function setTrips(arr, cb){ chrome.storage.local.set({trips:arr}, ()=>cb&&cb()); }

function collectCurrentTrip(){
  const stops = Array.from(stopsWrap.querySelectorAll('input')).map(x=>x.value.trim()).filter(Boolean);
  return { name:'', created: Date.now(), home: homeInput.value.trim(), destination: destInput.value.trim(), stops };
}



function refreshTripList(){
  getTrips(trips=>{
    const v=tripSort ? tripSort.value : 'newest';
    const sorted=[...trips];
    if(v==='newest') sorted.sort((a,b)=>b.created-a.created);
    if(v==='oldest') sorted.sort((a,b)=>a.created-b.created);
    if(v==='az') sorted.sort((a,b)=>a.name.localeCompare(b.name));
    if(v==='za') sorted.sort((a,b)=>b.name.localeCompare(a.name));

    tripList.innerHTML='';
    sorted.forEach(t=>{
      const li=document.createElement('li');
      const left=document.createElement('div'); left.style.flex='1';

      const nameBtn=document.createElement('button'); nameBtn.className='name btn small'; nameBtn.textContent=t.name; nameBtn.title=fmtTime(t.created);
      nameBtn.addEventListener('click',()=>loadTrip(t)); // single click loads

      const meta=document.createElement('div'); meta.className='meta'; meta.textContent='Saved ' + fmtTime(t.created) + (t.lastModified ? ' • Edited ' + fmtTime(t.lastModified) : '');
      left.append(nameBtn, meta);

      const actions=document.createElement('div'); actions.className='actions';
      const edit=document.createElement('button'); edit.type='button'; edit.className='btn small'; edit.title='Rename'; edit.textContent='✏';
      const up=document.createElement('button'); up.type='button'; up.className='btn small'; up.title='Move up'; up.textContent='↑';
      const down=document.createElement('button'); down.type='button'; down.className='btn small'; down.title='Move down'; down.textContent='↓';
      const del=document.createElement('button'); del.type='button'; del.className='btn small'; del.title='Delete'; del.textContent='🗑';
      actions.append(edit,up,down,del);

      li.append(left,actions); tripList.appendChild(li);

      edit.addEventListener('click',()=>{
        const nn=prompt('Rename trip', t.name);
        if(!nn) return;
        getTrips(arr=>{ const i=arr.findIndex(x=>x.created===t.created&&x.name===t.name); if(i>=0){ arr[i].name=nn; arr[i].lastModified=Date.now(); setTrips(arr, refreshTripList);} });
      });
      up.addEventListener('click',(e)=>{ e.preventDefault(); getTrips(arr=>{ const i=arr.findIndex(x=>x.created===t.created&&x.name===t.name); if(i>0){ [arr[i-1],arr[i]]=[arr[i],arr[i-1]]; setTrips(arr, refreshTripList);} }); });
      down.addEventListener('click',(e)=>{ e.preventDefault(); getTrips(arr=>{ const i=arr.findIndex(x=>x.created===t.created&&x.name===t.name); if(i>=0 && i<arr.length-1){ [arr[i+1],arr[i]]=[arr[i],arr[i+1]]; setTrips(arr, refreshTripList);} }); });
      del.addEventListener('click',(e)=>{ e.preventDefault(); if(confirm('Delete this trip?')) getTrips(arr=>{ const i=arr.findIndex(x=>x.created===t.created&&x.name===t.name); if(i>=0){ arr.splice(i,1); setTrips(arr, refreshTripList);} }); });
    });
  });
}
if (tripSort) tripSort.addEventListener('change', refreshTripList);

function loadTrip(t){
  window.scrollTo({top:0,behavior:'smooth'});
  homeInput.value=t.home||'';
  destInput.value=t.destination||'';
  stopsWrap.innerHTML='';
  (t.stops||[]).forEach(v=>{ stopsWrap.appendChild(makeStopRow(v)); });
  renumberStops();
  hideDirections();
  setTimeout(()=>homeInput.focus(), 120);
}

if (saveTripBtn) saveTripBtn.addEventListener('click', ()=>{
  const trip=collectCurrentTrip();
  trip.lastModified = trip.created;
  const def=`Trip - ${new Date(trip.created).toLocaleString()}`;
  const name=prompt('Trip name:', def) || def;
  trip.name=name;
  getTrips(arr=>{ arr.unshift(trip); setTrips(arr, refreshTripList); });
});

// ---- History ----
function getHistory(cb){ chrome.storage.local.get({history:[]}, d=>cb(d.history)); }
function setHistory(arr, cb){ chrome.storage.local.set({history:arr}, ()=>cb&&cb()); }
function addHistoryEntry(trip){ getHistory(arr=>{ arr.unshift(trip); if(arr.length>50) arr=arr.slice(0,50); setHistory(arr, refreshHistory); }); }
function refreshHistory(){
  getHistory(arr=>{
    historyList.innerHTML='';
    arr.forEach((t,idx)=>{
      const li=document.createElement('li');
      const btn=document.createElement('button'); btn.className='name btn small'; btn.textContent=`${t.home} → ${t.destination}`; btn.title=new Date(t.created).toLocaleString();
      btn.addEventListener('click',()=>loadTrip(t));
      const del=document.createElement('button'); del.className='btn small'; del.title='Delete'; del.textContent='🗑';
      del.addEventListener('click',()=>{ getHistory(list=>{ list.splice(idx,1); setHistory(list, refreshHistory); }); });
      li.append(btn,del); historyList.appendChild(li);
    });
  });
}
if (historyClearRange) historyClearRange.addEventListener('change', ()=>{
  const v=historyClearRange.value; if(!v) return;
  getHistory(arr=>{
    const now=Date.now();
    if (v==='all'){ setHistory([], refreshHistory); historyClearRange.value=''; return; }
    let cutoff=0;
    if (v==='hour') cutoff=now-3600000;
    if (v==='day') cutoff=now-86400000;
    if (v==='week') cutoff=now-604800000;
    const filtered=arr.filter(h=>h.created<cutoff);
    setHistory(filtered, refreshHistory);
    historyClearRange.value='';
  });
});

// ---- Calculate ----
form.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); submitBtn.click(); }});
submitBtn.addEventListener('click', ()=>{
  const h=homeInput.value.trim(), d=destInput.value.trim();
  if(!h||!d) return;
  const original=submitBtn.textContent; submitBtn.textContent='Calculating…'; submitBtn.disabled=true;
  const stops=[h, ...Array.from(stopsWrap.querySelectorAll('input')).map(x=>x.value.trim()).filter(Boolean), d];
  chrome.runtime.sendMessage({type:'ROUTE_DISTANCE',stops, units: currentUnits}, (resp)=>{
    submitBtn.textContent=original; submitBtn.disabled=false;
    if(!resp||!resp.ok){ travelEl.textContent=resp?.error||resp?.message||'Error fetching distance/time'; milesEl.textContent=''; hideDirections(); return; }
    travelEl.textContent='≈ '+resp.travelTime; milesEl.textContent=resp.mileCount; linkEl.href=resp.directionsLink||'#'; linkEl.hidden=false;
    addHistoryEntry(collectCurrentTrip());
  });
});

// ---- Init lists ----
refreshTripList();
refreshHistory();

if (clearBtn) clearBtn.addEventListener('click', (e)=>{ e.preventDefault(); clearForm(); });

// Keyboard shortcut: Ctrl/Cmd+K clears
document.addEventListener('keydown', (e)=>{
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    clearForm();
  }
});

const swapBtn = document.getElementById('swap-btn');
if (swapBtn) swapBtn.addEventListener('click', ()=>{
  const h = homeInput.value;
  homeInput.value = destInput.value;
  destInput.value = h;
  hideDirections();
});

function setSaved(key, val){ try{ chrome.storage.local.set({[key]: val}); }catch{} }
function getSaved(key, cb){ try{ chrome.storage.local.get({[key]: ''}, r => cb(r[key]||'')); }catch{ cb(''); } }

document.addEventListener('keydown', (e)=>{
  if (e.altKey && !e.shiftKey && (e.key==='h' || e.key==='H')) { setSaved('savedHome', homeInput.value.trim()); }
  if (e.altKey && e.shiftKey && (e.key==='h' || e.key==='H')) { getSaved('savedHome', v=>{ if(v) homeInput.value=v; }); }
  if (e.altKey && !e.shiftKey && (e.key==='w' || e.key==='W')) { setSaved('savedWork', destInput.value.trim()); }
  if (e.altKey && e.shiftKey && (e.key==='w' || e.key==='W')) { getSaved('savedWork', v=>{ if(v) destInput.value=v; }); }
});

const optionsToggle=document.getElementById('optionsToggle'); const optionsPanel=document.getElementById('optionsPanel'); if(optionsToggle&&optionsPanel){ optionsToggle.addEventListener('click', ()=> optionsPanel.classList.toggle('open')); }


/** Custom controlled autocomplete for Destination (ALWAYS below) */
function wireCustomDest(inputEl, boxEl){
  if(!inputEl || !boxEl) return;
  let timer=null, items=[], index=-1, suppressUntil=0;
  function render(list){
    boxEl.innerHTML='';
    items = (list||[]).slice(0,8);
    if(!items.length){ boxEl.classList.remove('show'); return; }
    for(let i=0;i<items.length;i++){
      const row=document.createElement('div');
      row.className='item';
      row.textContent=items[i];
      row.addEventListener('mousedown', (e)=>{ e.preventDefault(); apply(items[i]); });
      boxEl.appendChild(row);
    }
    index=-1; boxEl.classList.add('show');
  }
  function apply(text){
    inputEl.value=text;
    boxEl.classList.remove('show'); boxEl.innerHTML='';
    suppressUntil = Date.now()+300;
    inputEl.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function fetchPredictions(q){
    chrome.runtime.sendMessage({type:'AUTOCOMPLETE', input:q, sessiontoken:acSessionToken, filter: currentFilter}, (resp)=>{
      if(!resp||!resp.ok) return;
      render(resp.predictions||[]);
    });
  }
  inputEl.setAttribute('autocomplete','new-password');
  inputEl.setAttribute('name','addr'); inputEl.setAttribute('data-lpignore','true');
  inputEl.addEventListener('input', ()=>{
    const now=Date.now(); if(now<suppressUntil) return;
    if(timer) clearTimeout(timer);
    const q=inputEl.value.trim();
    if(!q){ boxEl.classList.remove('show'); boxEl.innerHTML=''; return; }
    timer=setTimeout(()=>fetchPredictions(q), 140);
  });
  inputEl.addEventListener('keydown', (e)=>{
    if(!boxEl.classList.contains('show')) return;
    if(e.key==='ArrowDown'){ e.preventDefault(); index=Math.min(index+1, items.length-1); highlight(); }
    if(e.key==='ArrowUp'){ e.preventDefault(); index=Math.max(index-1, 0); highlight(); }
    if(e.key==='Enter'){ e.preventDefault(); if(index>=0) apply(items[index]); else boxEl.classList.remove('show'); }
    if(e.key==='Escape'){ boxEl.classList.remove('show'); }
  });
  function highlight(){ [...boxEl.children].forEach((el,i)=> el.classList.toggle('active', i===index)); }
  inputEl.addEventListener('blur', ()=> setTimeout(()=> boxEl.classList.remove('show'), 120));
}

// ----- Custom autocomplete helpers (shared) -----
function ensureCustomBox(inputEl, boxId){
  if (!inputEl) return null;
  // Remove native datalist, if any
  if (inputEl.hasAttribute('list')) inputEl.removeAttribute('list');
  // Wrap if needed
  let wrap = inputEl.closest('.ac-wrap');
  if (!wrap){
    wrap = document.createElement('div');
    wrap.className = 'ac-wrap';
    inputEl.parentNode.insertBefore(wrap, inputEl);
    wrap.appendChild(inputEl);
  }
  // Create/find box
  let box = document.getElementById(boxId);
  if (!box){
    box = document.createElement('div');
    box.id = boxId;
    box.className = 'suggest';
    box.setAttribute('role','listbox');
    wrap.appendChild(box);
  }
  return box;
}

function wireCustomAutocomplete(inputEl, boxEl){
  if (!inputEl || !boxEl) return;
  let timer=null, items=[], index=-1, suppressUntil=0;
  function render(list){
    boxEl.innerHTML='';
    items = list.slice(0,8);
    if (!items.length){ boxEl.classList.remove('show'); return; }
    for (let i=0;i<items.length;i++){
      const row=document.createElement('div');
      row.className='item';
      row.textContent=items[i];
      row.addEventListener('mousedown', (e)=>{ e.preventDefault(); apply(items[i]); });
      boxEl.appendChild(row);
    }
    index=-1; boxEl.classList.add('show');
  }
  function apply(text){
    inputEl.value = text;
    boxEl.classList.remove('show'); boxEl.innerHTML='';
    suppressUntil = Date.now()+320;
    inputEl.dispatchEvent(new Event('input', {bubbles:true}));
  }
  function fetchPredictions(q){
    chrome.runtime.sendMessage({type:'AUTOCOMPLETE', input:q, sessiontoken: acSessionToken, filter: currentFilter}, (resp)=>{
      if (!resp || !resp.ok) return;
      render(resp.predictions || []);
    });
  }
  inputEl.setAttribute('autocomplete','new-password');
  inputEl.setAttribute('name','addr'); inputEl.setAttribute('data-lpignore','true');
  inputEl.addEventListener('input', ()=>{
    const now=Date.now(); if (now < suppressUntil) return;
    clearTimeout(timer);
    const q=inputEl.value.trim();
    if (!q){ boxEl.classList.remove('show'); boxEl.innerHTML=''; return; }
    timer = setTimeout(()=>fetchPredictions(q), 140);
  });
  inputEl.addEventListener('keydown', (e)=>{
    if (!boxEl.classList.contains('show')) return;
    if (e.key==='ArrowDown'){ e.preventDefault(); index=Math.min(index+1, items.length-1); highlight(); }
    if (e.key==='ArrowUp'){ e.preventDefault(); index=Math.max(index-1, 0); highlight(); }
    if (e.key==='Enter'){ e.preventDefault(); if (index>=0) apply(items[index]); else boxEl.classList.remove('show'); }
    if (e.key==='Escape'){ boxEl.classList.remove('show'); }
  });
  inputEl.addEventListener('blur', ()=> setTimeout(()=> boxEl.classList.remove('show'), 120));
  function highlight(){ [...boxEl.children].forEach((el,i)=> el.classList.toggle('active', i===index)); }
}

// Convert existing home/dest to custom dropdowns
try{
  const _home = document.getElementById('home-address');
  if (_home){
    const hb = ensureCustomBox(_home, 'home-suggest');
    wireCustomAutocomplete(_home, hb);
  }
  const _dest = document.getElementById('destination-address');
  if (_dest){
    const db = ensureCustomBox(_dest, 'dest-suggest');
    wireCustomAutocomplete(_dest, db);
  }
}catch{}

// Watch for new Stop inputs and convert them automatically
try{
  const stopsWrap = document.getElementById('stopsWrap') || document.querySelector('.stopsWrap') || document.body;
  const mo = new MutationObserver((muts)=>{
    muts.forEach(m=>{
      m.addedNodes && m.addedNodes.forEach(node=>{
        if (node.nodeType===1){
          const inputs = node.matches('input[type="text"]') ? [node] : node.querySelectorAll && node.querySelectorAll('input[type="text"]');
          inputs && inputs.forEach(inp=>{
            const id = inp.id || ('stop-' + Math.random().toString(36).slice(2,7));
            if (id.startsWith('stop-') || (inp.getAttribute('placeholder')||'').toLowerCase().includes('stop')){
              const box = ensureCustomBox(inp, id + '-suggest');
              wireCustomAutocomplete(inp, box);
            }
          });
        }
      });
    });
  });
  mo.observe(stopsWrap, {childList:true, subtree:true});
}catch{}
