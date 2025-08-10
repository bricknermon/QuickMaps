import config from './config.js';

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

chrome.runtime.onMessage.addListener((req, sender, sendResponse) => {
  try {
    if (!req || !req.type) { sendResponse({ok:false,error:"Bad request"}); return; }

    // ---- Places Autocomplete ----
    

if (req.type === 'AUTOCOMPLETE') {
  const input = String(req.input || '');
  const country = req.country ? String(req.country) : '';
  const token = req.sessiontoken ? String(req.sessiontoken) : '';
  const filter = (req.filter || 'both'); // 'addresses' | 'cities' | 'both'

  const mkUrl = (types) => {
    const url = new URL(`${config.proxyBase}/maps/place/autocomplete/json`);
    url.searchParams.set('input', input);
    url.searchParams.set('types', types);
    if (country) url.searchParams.set('components', 'country:' + country);
    if (token) url.searchParams.set('sessiontoken', token);
    return url.toString();
  };

  const calls = [];
  if (filter === 'addresses' || filter === 'both') calls.push(fetch(mkUrl('address')).then(r=>r.json()).catch(()=>({predictions:[]})));
  if (filter === 'cities'    || filter === 'both') calls.push(fetch(mkUrl('(cities)')).then(r=>r.json()).catch(()=>({predictions:[]})));

  Promise.all(calls.length?calls:[Promise.resolve({predictions:[]})]).then(responses => {
    const all = [];
    responses.forEach(r => (r.predictions||[]).forEach(p => all.push(p)));
    const seen=new Set(); const merged=[];
    for(const p of all){ if(!p||!p.description) continue; const k=p.description.toLowerCase(); if(seen.has(k)) continue; seen.add(k); merged.push(p.description); }
    sendResponse({ok:true, predictions: merged.slice(0, 8)});
  }).catch(e=>sendResponse({ok:false,error:String(e)}));
  return true;
}



    // ---- Multi-leg Distance ----
    
if (req.type === 'ROUTE_DISTANCE') {
  const stops = Array.isArray(req.stops) ? req.stops.filter(Boolean) : [];
  const units = req.units === 'metric' ? 'metric' : 'imperial';
  if (stops.length < 2) { sendResponse({ok:false,error:"Need origin and destination"}); return; }
  (async () => {
    try {
      let totalS=0,totalM=0;
      for (let i=0;i<stops.length-1;i++) {
        const url = new URL(`${config.proxyBase}/maps/distancematrix/json`);
        url.searchParams.set('units', units);
        url.searchParams.set('origins', stops[i]);
        url.searchParams.set('destinations', stops[i+1]);
        const data = await (await fetch(url.toString())).json();
        const el = data?.rows?.[0]?.elements?.[0];
        if (!(data?.status==='OK' && el?.status==='OK')) throw new Error(el?.status || data?.status || 'DM error');
        totalS += Number(el.duration.value||0);
        totalM += Number(el.distance.value||0); // meters
      }
      const hours=Math.floor(totalS/3600), mins=Math.round((totalS%3600)/60);
      const travelTime = hours?`${hours} hr ${mins} min`:`${mins} min`;
      const mileCount = units==='metric' ? (totalM/1000).toFixed(1) + ' km' : (totalM/1609.344).toFixed(1) + ' mi';
      const origin = stops[0], destination = stops[stops.length-1];
      const waypoints = stops.slice(1,-1);
      const link = new URL('https://www.google.com/maps/dir/');
      link.searchParams.set('api','1');
      link.searchParams.set('origin',origin);
      link.searchParams.set('destination',destination);
      if (waypoints.length) link.searchParams.set('waypoints', waypoints.join('|'));
      sendResponse({ok:true,travelTime,mileCount,directionsLink:link.toString()});
    } catch(e){ sendResponse({ok:false,error:String(e)}); }
  })();
  return true;
}


    // ---- Single-leg (compat) ----
    
if (req.type === 'DISTANCE') {
  const home = String(req.homeAddress||'');
  const dest = String(req.destinationAddress||'');
  const units = req.units === 'metric' ? 'metric' : 'imperial';
  const url = new URL(`${config.proxyBase}/maps/distancematrix/json`);
  url.searchParams.set('units', units);
  url.searchParams.set('origins', home);
  url.searchParams.set('destinations', dest);
  fetch(url.toString()).then(r=>r.json()).then(data=>{
    const el = data?.rows?.[0]?.elements?.[0];
    if (!(data?.status==='OK' && el?.status==='OK')) { sendResponse({ok:false,error: el?.status || data?.status || 'DM error'}); return; }
    const meters = Number(el.distance.value||0);
    const dist = units==='metric' ? (meters/1000).toFixed(1)+' km' : (meters/1609.344).toFixed(1)+' mi';
    const directionsLink = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(home)}&destination=${encodeURIComponent(dest)}`;
    sendResponse({ok:true, travelTime: el.duration.text, mileCount: dist, directionsLink});
  }).catch(e=>sendResponse({ok:false,error:String(e)}));
  return true;
}


    sendResponse({ok:false,error:'Unknown type'});
  } catch(e){ try{sendResponse({ok:false,error:String(e)})}catch{} }
});
