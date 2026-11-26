const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const pct=n=>`${n>=0?'+':''}${(n*100).toFixed(2)}%`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const standalone=typeof globalThis.CounterSOfflineApi==='function';
const steamReturn=!standalone&&new URLSearchParams(location.search).get('steam-return')==='1';
const capturePrefix='#steam-capture=';
const reusablePriceAge=60*60_000;
let capturePayload=!standalone&&location.hash.startsWith(capturePrefix)?location.hash.slice(capturePrefix.length):null;
if(steamReturn||capturePayload!==null)history.replaceState(null,'',location.pathname);
let catalog=[],state={inventory:[],prices:{}},result=null,priceRefresh=null;
let inventoryBusy=true,analyzing=false,linkedSteamId=null,pendingCapture=null;
if(standalone){
 $('#refresh-prices').textContent='Steam prices (server required)';
 $('#refresh-prices').title='Open the running CounterS app to fetch Steam prices. Import price quotes to calculate ROI in this preview.';
 $('#steam-actions').hidden=true;
 $('#steam-help').textContent='Open the running CounterS app to sign in or load an inventory from Steam.';
 $('#steam-id-setup').hidden=true;
 $('#capture-instructions').textContent='Download the capture file and import it with Import inventory file.';
}else{
 const badge=$('#steam-badge');
 badge.onload=()=>{badge.hidden=false;$('#steam-sign-in-label').hidden=true;};
 badge.src='https://shared.akamai.steamstatic.com/community_assets/images/steamworks_docs/english/sits_large_noborder.png';
}
function updateControls(){
 const busy=inventoryBusy||analyzing||Boolean(priceRefresh);
 for(const selector of ['#analyze','#import','#float-rule','#clear','#steam-accept'])$(selector).disabled=busy;
 for(const selector of ['#steam-sign-in','#steam-reload','#steam-id','#connect'])$(selector).disabled=standalone||busy;
 $('#refresh-prices').disabled=standalone||inventoryBusy||analyzing;
}
updateControls();
function notice(message,error=false){$('#notice').textContent=message;$('#notice').hidden=!message;$('#notice').classList.toggle('error',error);}
async function api(path,options){if(standalone)return globalThis.CounterSOfflineApi(path,options);const r=await fetch(path,options);const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Request failed.'),{status:r.status});return d;}
function post(path,data){return api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function persist(){try{localStorage.setItem('counters-workspace',JSON.stringify(state));}catch{notice('Session only. Export inventory to save.');}}
function removeLegacyDemo(workspace){
 if(!Array.isArray(workspace?.inventory))throw Error('Import needs an inventory array.');
 const inventory=workspace.inventory.filter(item=>!/^demo-(?:[0-9]|1[01])$/.test(item?.assetId??''));
 const removedItems=inventory.length!==workspace.inventory.length;
 const entries=Object.entries(workspace.prices??{});
 const quotes=entries.filter(([,quote])=>quote?.source!=='demo');
 if(!removedItems&&quotes.length===entries.length)return workspace;
 return {...workspace,inventory,prices:removedItems&&!inventory.length?{}:Object.fromEntries(quotes)};
}
function skin(i){return catalog.find(s=>s.id===i.skinId);}
function wear(f){return f<.07?'Factory New':f<.15?'Minimal Wear':f<.38?'Field-Tested':f<.45?'Well-Worn':'Battle-Scarred';}
function name(i){const s=skin(i);return s?`${i.souvenir?'Souvenir ':i.stattrak?'StatTrak™ ':''}${s.name} (${wear(i.float)})`:i.name||'Unknown skin';}
function missingPriceNames(){
 return [...new Set([...state.inventory.map(name),...(result?.missing??[])])].filter(marketName=>!Object.hasOwn(state.prices,marketName));
}
function drawInventory(){
 const q=$('#filter').value.toLowerCase();
 const items=state.inventory.filter(i=>(name(i)+' '+(skin(i)?.collectionName||'')).toLowerCase().includes(q));
 $('#inventory-grid').innerHTML=items.length?`<div class="table-wrap"><table><thead><tr><th>Skin</th><th>Float</th><th>Price</th><th>Asset ID</th></tr></thead><tbody>${items.map(i=>{const quote=state.prices[name(i)];return `<tr><td>${esc(name(i))}${i.souvenir?'<small>Souvenir</small>':''}</td><td title="${Number.isFinite(i.float)?esc(i.float):''}">${Number.isFinite(i.float)?i.float.toFixed(6):'Missing'}${i.floatSource?`<small>${esc(i.floatSource)}</small>`:''}</td><td>${quote?money(quote.price):'Missing'}</td><td>${esc(i.assetId)}</td></tr>`;}).join('')}</tbody></table></div>`:`<p class="empty">${state.inventory.length?'No matching items.':'No inventory loaded.'}</p>`;
}
function refresh(){
 const sources=new Set(Object.values(state.prices).map(q=>q.source));
 $('#price-label').textContent=sources.size===1&&sources.has('steam-lowest-listing')?'USD · Steam lowest listings':sources.size?'USD · Imported / mixed quotes':'USD';
 $('#count').textContent=state.inventory.length;
 const valid=state.inventory.filter(i=>skin(i)&&Number.isFinite(i.float));let value=0,priced=0;
 valid.forEach(i=>{const p=state.prices[name(i)];if(p){value+=p.price;priced++;}});
 $('#value').textContent=priced?money(value):'—';$('#eligible').textContent=`${valid.length} floats · ${priced} priced`;
 const missing=missingPriceNames();
 $('#roi').textContent=!priceRefresh&&!missing.length&&result?.best.length?pct(result.best[0].grossRoi):'—';
 $('#checked').textContent=result?result.checked.toLocaleString():'—';
 $('#search-label').textContent=result?(result.truncated?'Partial search':'Exhaustive search'):'10 items per contract';
 drawInventory();drawResults(missing);
}
function drawResults(missing){
 $('#details').innerHTML='';
 if(priceRefresh){$('#results').innerHTML='<p class="empty">Rankings appear once pricing is complete.</p>';return;}
 if(!result){$('#results').innerHTML='<p class="empty">Load an inventory to calculate ROI.</p>';return;}
 if(result.checked&&missing.length){
  $('#results').innerHTML=`<p class="warning">Waiting for ${missing.length} ${missing.length===1?'price':'prices'} before ranking contracts. Refresh Steam prices or export the missing price names.</p>`;
  return;
 }
 const warning=result.truncated?`<p class="warning">Checked ${result.checked.toLocaleString()} sampled combinations across eligible groups. Some combinations were skipped.</p>`:'';
 $('#results').innerHTML=warning+(result.best.length?result.best.map((c,n)=>{const names=[...new Set(c.inputs.map(i=>skin(i).collectionName.replace(/^The /,'')))];return `<article class="contract-card"><span class="rank">${String(n+1).padStart(2,'0')}</span><div class="contract-info"><strong>${esc(names.join(' + '))}</strong><p>${esc(['Consumer Grade','Industrial Grade','Mil-Spec','Restricted','Classified'][skin(c.inputs[0]).rarity])} → next tier · ${c.inputs[0].stattrak?'StatTrak':'Standard'} · ${c.outcomes.length} possible outputs</p></div><div class="contract-metrics"><div class="contract-metric"><small>INPUT VALUE</small><strong>${money(c.cost)}</strong></div><div class="contract-metric"><small>EXPECTED OUTPUT</small><strong>${money(c.expected)}</strong></div><div class="contract-metric roi"><small>GROSS ROI</small><strong class="${c.grossRoi<0?'negative':''}">${pct(c.grossRoi)}</strong></div></div><button class="secondary inspect" data-index="${n}">View contract</button></article>`;}).join(''):`<div class="empty"><p>${result.checked?'Missing prices. Refresh Steam prices to calculate ROI.':'Requires 10 skins of the same rarity and StatTrak status, with floats.'}</p></div>`);
 document.querySelectorAll('.inspect').forEach(b=>b.onclick=()=>details(result.best[Number(b.dataset.index)]));
}
function provenance(q){return q?`${esc(q.source)} · ${esc(new Date(q.timestamp).toLocaleString())}${Date.now()-Date.parse(q.timestamp)>86400000?' · STALE (>24h)':''}`:'Missing quote';}
function details(c){$('#details').innerHTML=`<div class="detail-panel"><p>Gross expected profit: <span class="green">${money(c.expected-c.cost)}</span> · Profit probability: ${(c.winChance*100).toFixed(1)}%.</p><div class="table-label">Inputs</div><div class="table-wrap"><table><thead><tr><th>Skin / asset</th><th>Float</th><th>Price / source</th></tr></thead><tbody>${c.inputs.map(i=>`<tr><td>${esc(i.name)}<small>${esc(i.assetId)}</small></td><td>${i.float.toFixed(6)}</td><td>${money(i.quote.price)}<small>${provenance(i.quote)}</small></td></tr>`).join('')}</tbody></table></div><div class="table-label">Outputs</div><div class="table-wrap"><table><thead><tr><th>Output skin</th><th>Float</th><th>Probability</th><th>Price / source</th><th>EV contribution</th></tr></thead><tbody>${c.outcomes.map(o=>`<tr><td>${esc(o.name)}</td><td>${o.float.toFixed(6)}</td><td class="prob">${(o.probability*100).toFixed(2)}%</td><td>${money(o.quote.price)}<small>${provenance(o.quote)}</small></td><td>${money(o.quote.price*o.probability)}</td></tr>`).join('')}</tbody></table></div></div>`;$('#details').scrollIntoView({behavior:'smooth',block:'start'});}
function analyzeWorkspace(workspace,signal){
 return api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...workspace,floatRule:$('#float-rule').value}),signal});
}
function announceResults(){
 const sources=new Set(Object.values(state.prices).map(q=>q.source));
 const missing=missingPriceNames().length;
 const status=result.checked&&missing?`${missing} missing ${missing===1?'price':'prices'}`:`${result.best.length} ranked`;
 notice(`${result.checked.toLocaleString()} contracts checked · ${status}. ${sources.has('steam-lowest-listing')?'Steam lowest listings · gross ROI. ':''}${sources.has('steam-history')?'Aggregated Steam history. ':''}${[...sources].some(s=>s!=='steam-lowest-listing')?'Imported prices unverified.':''}`);
}
async function run({announce=true}={}){
 const b=$('#analyze');analyzing=true;b.textContent='Calculating…';updateControls();
 try{
  result=await analyzeWorkspace(state);refresh();
  if(announce)announceResults();
 }catch(e){notice(e.message,true);}finally{analyzing=false;b.textContent='Calculate ROI';updateControls();}
}
$('#refresh-prices').onclick=async()=>{
 if(priceRefresh){priceRefresh.abort();return;}
 if(!state.inventory.length){notice('Import inventory with floats first.',true);return;}
 const controller=new AbortController();priceRefresh=controller;
 updateControls();refresh();
 const b=$('#refresh-prices');b.textContent='Stop price refresh';
 let fetched=0,missing=0,reused=0,inventoryRemaining=0,outputRemaining=0,problem='',applied=false,truncated=false;
 const remainingText=()=>{
  const inventory=inventoryRemaining===1?'inventory skin quote':'inventory skin quotes';
  const outputs=outputRemaining===1?'trade-up output quote':'trade-up output quotes';
  return `${inventoryRemaining} ${inventory} left · ${outputRemaining} ${outputs} left`;
 };
 try{
  notice('Finding input and output prices…');
  // Empty quotes reveal every needed output name, including already priced ones.
  const plan=await analyzeWorkspace({inventory:state.inventory,prices:{}},controller.signal);
  truncated=plan.truncated;
  // Price the names needed for the first evaluated contracts before other holdings.
  const inventoryNames=new Set(state.inventory.map(name));
  const names=[...new Set([...plan.missing,...inventoryNames])];
  const time=Date.now();
  const recent=names.filter(marketName=>{
   const quote=state.prices[marketName];
   const age=time-Date.parse(quote?.timestamp);
   return quote?.source==='steam-lowest-listing'&&age>=0&&age<reusablePriceAge;
  });
  state.prices=Object.fromEntries(recent.map(marketName=>[marketName,state.prices[marketName]]));
  const pending=names.filter(marketName=>!Object.hasOwn(state.prices,marketName));
  reused=recent.length;
  inventoryRemaining=pending.filter(marketName=>inventoryNames.has(marketName)).length;
  outputRemaining=pending.length-inventoryRemaining;
  result=null;applied=true;persist();refresh();
  for(const marketName of pending){
   notice(`Steam prices · ${fetched} new · ${reused} reused · ${remainingText()}.`);
   try{state.prices[marketName]=await api('/api/price?name='+encodeURIComponent(marketName),{signal:controller.signal});fetched++;persist();}
   catch(e){if(controller.signal.aborted||e.status!==404)throw e;missing++;}
   if(inventoryNames.has(marketName))inventoryRemaining--;else outputRemaining--;
  }
 }catch(e){problem=controller.signal.aborted?'Price refresh stopped.':e.message;}
 finally{
  if(applied){persist();await run({announce:false});}
  const remaining=inventoryRemaining||outputRemaining;
  const summary=applied?`${fetched} new · ${reused} reused${missing?` · ${missing} unavailable`:''}${remaining?` · ${remainingText()}`:''}.`:'Previous prices retained.';
  notice([summary,problem,truncated?'Partial contract search.':''].filter(Boolean).join(' '),!!problem);
  priceRefresh=null;b.textContent='Refresh Steam prices';updateControls();refresh();
 }
};
async function changeInventory(work){
 inventoryBusy=true;updateControls();
 try{await work();}catch(e){notice(e.message,true);}finally{inventoryBusy=false;updateControls();}
}
async function applyWorkspace(next){
 next=removeLegacyDemo(next);
 const workspace={inventory:next.inventory,prices:next.prices??{}};
 const analysis=await analyzeWorkspace(workspace);
 state=workspace;result=analysis;$('#filter').value='';persist();refresh();
 if(next.report){
  const {imported,unsupported,missingFloat,invalidFloat}=next.report;
  const skipped=[unsupported&&`${unsupported} outside the weapon catalog`,missingFloat&&`${missingFloat} without floats`,invalidFloat&&`${invalidFloat} with invalid floats`].filter(Boolean);
  notice(`Imported ${imported} weapon ${imported===1?'skin':'skins'}.${skipped.length?` Skipped ${skipped.join(', ')}.`:''} Refresh Steam prices next.`);
 }else announceResults();
}
$('#analyze').onclick=run;
$('#filter').oninput=drawInventory;
$('#float-rule').onchange=()=>{result=null;refresh();notice('Float rule changed. Calculate ROI again.');};
$('#import').onchange=e=>{
 const f=e.target.files[0];e.target.value='';if(!f)return;
 return changeInventory(async()=>{
  if(f.size>2_000_000)throw Error('Import is limited to 2 MB.');
  const data=JSON.parse(await f.text());
  await applyWorkspace(data?.format==='counters-steam-floats-v1'?await post('/api/import-steam-floats',data):data);
 });
};
function showBookmarkAddress(){const field=$('#exporter-code-text');field.hidden=false;field.focus();field.select();}
$('#exporter-code').onclick=()=>{showBookmarkAddress();$('#exporter-status').textContent="Copy the selected address into a bookmark's URL field.";};
$('#copy-bookmark').onclick=async()=>{
 const address=$('#exporter-code-text').value;
 if(!address){$('#exporter-status').textContent='Exporter address is not loaded. Reload this page and try again.';return;}
 try{await navigator.clipboard.writeText(address);$('#exporter-status').textContent="Copied. Paste into a bookmark’s URL field, then click the saved bookmark on your Steam inventory.";}
 catch{showBookmarkAddress();$('#exporter-status').textContent="Clipboard access is unavailable. Copy the selected address with Ctrl+C (Cmd+C on Mac), then paste into the bookmark's URL field.";}
};
async function prepareExporter(){
 try{
  let source=globalThis.CounterSExporterSource;
  if(typeof source!=='string'){
   const response=await fetch('/steam-export.js');if(!response.ok)throw Error('Could not load the capture bookmark.');source=await response.text();
  }
  const destination=standalone?null:location.origin+'/';
  const bookmark='javascript:'+encodeURIComponent(`${source.trim()}(${JSON.stringify(destination)});`);
  $('#csfloat-bookmark').href=bookmark;$('#exporter-code-text').value=bookmark;$('#copy-bookmark').disabled=false;
  $('#csfloat-bookmark').onclick=e=>{e.preventDefault();$('#exporter-status').textContent='Save this link on your bookmarks bar first, then click the saved bookmark from your Steam inventory.';};
 }
 catch(e){$('#exporter-status').textContent=e.message;}
}
prepareExporter();
$('#export').onclick=()=>{const data={...state,requiredPriceNames:missingPriceNames()};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='counters-workspace.json';a.click();URL.revokeObjectURL(url);};
async function loadPublicInventory(steamId){
 notice('Loading weapon skins from your public Steam inventory…');
 try{
  const next=await api('/api/inventory?'+new URLSearchParams({steamId,format:'workspace'}));
  await applyWorkspace(next);
  if(next.report.missingFloat||next.report.invalidFloat)$('#csfloat-setup').open=true;
 }catch(e){
  if(e.status===403||e.status===400)$('#csfloat-setup').open=true;
  throw e;
 }
}
$('#steam-sign-in').onclick=()=>changeInventory(async()=>{
 const signIn=await post('/api/steam/sign-in',{});
 const url=new URL(signIn.url);
 if(url.origin!=='https://steamcommunity.com'||url.pathname!=='/openid/login')throw Error('Invalid Steam sign-in address.');
 sessionStorage.setItem('counters-steam-flow',signIn.state);
 location.assign(url.href);
});
$('#steam-reload').onclick=()=>changeInventory(()=>loadPublicInventory(linkedSteamId));
$('#steam-id-form').onsubmit=e=>{
 e.preventDefault();return changeInventory(()=>loadPublicInventory($('#steam-id').value.trim()));
};
function dismissCapture(){pendingCapture=null;$('#steam-review').hidden=true;}
$('#steam-cancel').onclick=dismissCapture;
$('#steam-accept').onclick=()=>changeInventory(async()=>{
 if(!pendingCapture)return;
 await applyWorkspace(pendingCapture);
 dismissCapture();
});
async function reviewCapture(payload){
 if(payload.length>500_000)throw Error('Steam capture is too large. Capture fewer pages or import the capture file.');
 let data;
 try{data=JSON.parse(decodeURIComponent(payload));}catch{throw Error('Steam capture could not be read. Run the capture bookmark again.');}
 pendingCapture=await post('/api/import-steam-floats',data);
 const {imported,unsupported,missingFloat,invalidFloat}=pendingCapture.report;
 $('#steam-review-summary').textContent=`${imported} ${imported===1?'skin':'skins'} ready. Skipped ${unsupported} unsupported, ${missingFloat} without floats, and ${invalidFloat} with invalid floats. Replacing the inventory also clears its prices.`;
 $('#steam-review').hidden=false;
}
$('#clear').onclick=()=>{state={inventory:[],prices:{}};result=null;$('#filter').value='';persist();refresh();notice('Inventory cleared.');};
try{
 catalog=await api('/api/catalog');
 let saved=null;
 try{saved=localStorage.getItem('counters-workspace');}catch{notice('Session only. Export inventory to save.');}
 if(saved){
  try{
   const parsed=JSON.parse(saved);
   const cleaned=removeLegacyDemo(parsed);
   const workspace={inventory:cleaned.inventory,prices:cleaned.prices??{}};
   const analysis=await analyzeWorkspace(workspace);
   state=workspace;result=workspace.inventory.length?analysis:null;
   if(cleaned!==parsed)persist();
  }
  catch{notice('Saved data could not be restored. Import a JSON file.',true);}
 }
 refresh();if(result)announceResults();
 if(!standalone){
  try{linkedSteamId=sessionStorage.getItem('counters-steam-id');}catch{}
  $('#steam-reload').hidden=!/^\d{17}$/.test(linkedSteamId??'');
  if(steamReturn){
   try{
    const state=sessionStorage.getItem('counters-steam-flow');
    sessionStorage.removeItem('counters-steam-flow');
    const {steamId}=await post('/api/steam/result',{state});
    linkedSteamId=steamId;
    sessionStorage.setItem('counters-steam-id',steamId);
    $('#steam-reload').hidden=false;
    await loadPublicInventory(steamId);
   }catch(e){notice(e.message,true);}
  }
  if(capturePayload!==null){
   try{await reviewCapture(capturePayload);}catch(e){notice(e.message,true);}
   finally{capturePayload=null;}
  }
 }
}catch(e){notice('Could not load skin catalog: '+e.message,true);}
finally{inventoryBusy=false;updateControls();}
