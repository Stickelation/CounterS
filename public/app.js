const $=s=>document.querySelector(s);
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n);
const pct=n=>`${n>=0?'+':''}${(n*100).toFixed(2)}%`;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let catalog=[],state={inventory:[],prices:{}},result=null,priceRefresh=null;
if(typeof globalThis.CounterSOfflineApi==='function'){
 $('#refresh-prices').disabled=true;
 $('#refresh-prices').textContent='3. Steam prices (server required)';
 $('#refresh-prices').title='Open the running CounterS app to fetch Steam prices. Import price quotes to calculate ROI in this preview.';
 $('#connect').disabled=true;
 $('#connect').title='Steam inventory requests require the running CounterS app.';
}
function notice(message,error=false){$('#notice').textContent=message;$('#notice').hidden=!message;$('#notice').classList.toggle('error',error);}
async function api(path,options){if(typeof globalThis.CounterSOfflineApi==='function')return globalThis.CounterSOfflineApi(path,options);const r=await fetch(path,options);const d=await r.json();if(!r.ok)throw Object.assign(Error(d.error||'Request failed.'),{status:r.status});return d;}
function persist(){try{localStorage.setItem('counters-workspace',JSON.stringify(state));}catch{notice('Session only. Export inventory to save.');}}
function skin(i){return catalog.find(s=>s.id===i.skinId);}
function wear(f){return f<.07?'Factory New':f<.15?'Minimal Wear':f<.38?'Field-Tested':f<.45?'Well-Worn':'Battle-Scarred';}
function name(i){const s=skin(i);return s?`${i.stattrak?'StatTrak™ ':''}${s.name} (${wear(i.float)})`:i.name||'Unknown skin';}
function drawInventory(){
 const q=$('#filter').value.toLowerCase();
 const items=state.inventory.filter(i=>(name(i)+' '+(skin(i)?.collectionName||'')).toLowerCase().includes(q));
 $('#inventory-grid').innerHTML=items.length?`<div class="table-wrap"><table><thead><tr><th>Skin</th><th>Float</th><th>Price</th><th>Asset ID</th></tr></thead><tbody>${items.map(i=>{const quote=state.prices[name(i)];return `<tr><td>${esc(name(i))}${i.souvenir?'<small>Souvenir</small>':''}</td><td title="${Number.isFinite(i.float)?esc(i.float):''}">${Number.isFinite(i.float)?i.float.toFixed(6):'Missing'}${i.floatSource?`<small>${esc(i.floatSource)}</small>`:''}</td><td>${quote?money(quote.price):'Missing'}</td><td>${esc(i.assetId)}</td></tr>`;}).join('')}</tbody></table></div>`:'<p class="empty">No items.</p>';
}
function refresh(){
 const sources=new Set(Object.values(state.prices).map(q=>q.source));
 $('#price-label').textContent=sources.size===1&&sources.has('steam-lowest-listing')?'USD · Steam lowest listings':sources.has('demo')?'USD · Demo prices':sources.size?'USD · Imported / mixed quotes':'USD';
 $('#count').textContent=state.inventory.length;
 const valid=state.inventory.filter(i=>skin(i)&&Number.isFinite(i.float));let value=0,priced=0;
 valid.forEach(i=>{const p=state.prices[name(i)];if(p){value+=p.price;priced++;}});
 $('#value').textContent=priced?money(value):'—';$('#eligible').textContent=`${valid.length} floats · ${priced} priced`;
 $('#roi').textContent=result?.best.length?pct(result.best[0].grossRoi):'—';
 $('#checked').textContent=result?result.checked.toLocaleString():'—';
 $('#search-label').textContent=result?(result.truncated?'Partial search · 100,000 limit':'Exhaustive search'):'10 items per contract';
 drawInventory();drawResults();
}
function drawResults(){
 $('#details').innerHTML='';if(!result){$('#results').innerHTML='<p class="empty">Import inventory, refresh prices, then calculate ROI.</p>';return;}
 const warning=`${result.truncated?'<p class="warning">Partial search: first 100,000 combinations only. Highest ROI is not guaranteed.</p>':''}${result.incomplete?`<p class="warning">${result.incomplete.toLocaleString()} contracts excluded: ${result.missing.length} missing prices. Refresh Steam prices or export the missing price names.</p>`:''}`;
 $('#results').innerHTML=warning+(result.best.length?result.best.map((c,n)=>{const names=[...new Set(c.inputs.map(i=>skin(i).collectionName.replace(/^The /,'')))];return `<article class="contract-card"><span class="rank">${String(n+1).padStart(2,'0')}</span><div class="contract-info"><strong>${esc(names.join(' + '))}</strong><p>${esc(['Consumer Grade','Industrial Grade','Mil-Spec','Restricted','Classified'][skin(c.inputs[0]).rarity])} → next tier · ${c.inputs[0].stattrak?'StatTrak':'Standard'} · ${c.outcomes.length} possible outputs</p></div><div class="contract-metric"><small>INPUT VALUE</small><strong>${money(c.cost)}</strong></div><div class="contract-metric"><small>EXPECTED OUTPUT</small><strong>${money(c.expected)}</strong></div><div class="contract-metric roi"><small>GROSS ROI</small><strong class="${c.grossRoi<0?'negative':''}">${pct(c.grossRoi)}</strong></div><button class="secondary inspect" data-index="${n}">View contract</button></article>`;}).join(''):`<div class="empty"><p>${result.checked?'Missing prices. Refresh Steam prices to calculate ROI.':'Requires 10 skins of the same rarity and StatTrak status, with floats.'}</p></div>`);
 document.querySelectorAll('.inspect').forEach(b=>b.onclick=()=>details(result.best[Number(b.dataset.index)]));
}
function provenance(q){return q?`${esc(q.source)} · ${esc(new Date(q.timestamp).toLocaleString())}${Date.now()-Date.parse(q.timestamp)>86400000?' · STALE (>24h)':''}`:'Missing quote';}
function details(c){$('#details').innerHTML=`<div class="detail-panel"><p>Gross expected profit: <span class="green">${money(c.expected-c.cost)}</span> · Profit probability: ${(c.winChance*100).toFixed(1)}%.</p><div class="table-label">Inputs</div><div class="table-wrap"><table><thead><tr><th>Skin / asset</th><th>Float</th><th>Price / source</th></tr></thead><tbody>${c.inputs.map(i=>`<tr><td>${esc(i.name)}<small>${esc(i.assetId)}</small></td><td>${i.float.toFixed(6)}</td><td>${money(i.quote.price)}<small>${provenance(i.quote)}</small></td></tr>`).join('')}</tbody></table></div><div class="table-label">Outputs</div><div class="table-wrap"><table><thead><tr><th>Output skin</th><th>Float</th><th>Probability</th><th>Price / source</th><th>EV contribution</th></tr></thead><tbody>${c.outcomes.map(o=>`<tr><td>${esc(o.name)}</td><td>${o.float.toFixed(6)}</td><td class="prob">${(o.probability*100).toFixed(2)}%</td><td>${money(o.quote.price)}<small>${provenance(o.quote)}</small></td><td>${money(o.quote.price*o.probability)}</td></tr>`).join('')}</tbody></table></div></div>`;$('#details').scrollIntoView({behavior:'smooth',block:'start'});}
async function run({announce=true}={}){
 const b=$('#analyze');b.disabled=true;b.textContent='Calculating…';
 try{
  result=await api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...state,floatRule:$('#float-rule').value})});refresh();
  const sources=new Set(Object.values(state.prices).map(q=>q.source));
  if(announce)notice(`${sources.has('demo')?'Demo prices. ':''}${result.checked.toLocaleString()} contracts checked · ${result.best.length} ranked. ${sources.has('steam-lowest-listing')?'Steam lowest listings · cache ≤5 min · gross ROI. ':''}${sources.has('steam-history')?'Aggregated Steam history. ':''}${[...sources].some(s=>s!=='steam-lowest-listing'&&s!=='demo')?'Imported prices unverified.':''}`);
 }catch(e){notice(e.message,true);}finally{b.disabled=false;b.textContent='4. Calculate ROI';}
}
$('#refresh-prices').onclick=async()=>{
 if(priceRefresh){priceRefresh.abort();return;}
 if(!state.inventory.length){notice('Import inventory with floats first.',true);return;}
 const controller=new AbortController();priceRefresh=controller;
 const controls=['#analyze','#import','#demo','#float-rule','#clear'];controls.forEach(s=>$(s).disabled=true);
 const b=$('#refresh-prices');b.textContent='Stop price refresh';let fetched=0,missing=0,problem='',replaced=false;
 try{
  notice('Finding input and output prices…');
  // Empty quotes reveal every needed output name, including already priced ones.
  const plan=await api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inventory:state.inventory,prices:{},floatRule:$('#float-rule').value}),signal:controller.signal});
  const names=[...new Set([...state.inventory.map(name),...plan.missing])];
  // Replace the pricing set so a failed refresh never silently reuses demo or imported quotes.
  state.prices={};result=null;replaced=true;persist();refresh();
  $('#results').innerHTML='<div class="empty"><p>Refreshing Steam prices…</p></div>';
  for(const [n,marketName] of names.entries()){
   notice(`Steam prices: ${n+1}/${names.length} · ${fetched} loaded · ${missing} unavailable.`);
   try{state.prices[marketName]=await api('/api/price?name='+encodeURIComponent(marketName),{signal:controller.signal});fetched++;persist();}
   catch(e){if(controller.signal.aborted)throw e;if(e.status===404){missing++;continue;}throw e;}
  }
  if(plan.truncated)problem='Partial search: prices for evaluated combinations only.';
 }catch(e){problem=controller.signal.aborted?'Price refresh stopped.':e.message;}
 finally{
  if(replaced){persist();await run({announce:false});}
  notice(`${fetched} prices loaded${missing?` · ${missing} unavailable`:''}. ${problem} ${replaced?'Missing prices exclude affected contracts.':'Previous prices retained.'}`,!!problem);
  controls.forEach(s=>$(s).disabled=false);priceRefresh=null;b.textContent='3. Refresh Steam prices';
 }
};
async function demo(){try{state=await api('/api/demo');result=null;persist();refresh();await run();}catch(e){notice(e.message,true);}}
$('#demo').onclick=demo;$('#analyze').onclick=run;
$('#filter').oninput=drawInventory;
$('#float-rule').onchange=()=>{result=null;refresh();notice('Float rule changed. Calculate ROI again.');};
$('#import').onchange=async e=>{
 try{
  const f=e.target.files[0];if(!f)return;if(f.size>2_000_000)throw Error('Import is limited to 2 MB.');
  let next=JSON.parse(await f.text()),report=null;
  if(next.format==='counters-steam-floats-v1'){
   next=await api('/api/import-steam-floats',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});report=next.report;
  }
  if(!Array.isArray(next.inventory))throw Error('File needs an inventory array.');next.prices??={};
  await api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...next,floatRule:$('#float-rule').value})});
  state={inventory:next.inventory,prices:next.prices};result=null;persist();refresh();await run({announce:!report});
  if(report)notice(`Imported ${report.imported} skins. Skipped: ${report.unsupported} unsupported · ${report.missingFloat} missing floats · ${report.invalidFloat} invalid floats. Loaded inventory pages only. Refresh Steam prices next.`);
 }catch(err){notice('Import failed: '+err.message,true);}finally{e.target.value='';}
};
function showBookmarkAddress(){const field=$('#exporter-code-text');field.hidden=false;field.focus();field.select();}
$('#exporter-code').onclick=()=>{showBookmarkAddress();$('#exporter-status').textContent="Copy the selected address into a bookmark's URL field. Name the bookmark Export to CounterS.";};
$('#copy-bookmark').onclick=async()=>{
 const address=$('#exporter-code-text').value;
 if(!address){$('#exporter-status').textContent='Exporter address is not loaded. Reload this page and try again.';return;}
 try{await navigator.clipboard.writeText(address);$('#exporter-status').textContent="Copied. Paste into the URL field of a bookmark named Export to CounterS, then click that saved bookmark on your Steam inventory.";}
 catch{showBookmarkAddress();$('#exporter-status').textContent="Clipboard access is unavailable. Copy the selected address with Ctrl+C (Cmd+C on Mac), then paste into the bookmark's URL field.";}
};
async function prepareExporter(){
 try{let source=globalThis.CounterSExporterSource;if(typeof source!=='string'){const response=await fetch('/steam-export.js');if(!response.ok)throw Error('Could not load exporter.');source=await response.text();}const bookmark='javascript:'+encodeURIComponent(source);$('#csfloat-bookmark').href=bookmark;$('#exporter-code-text').value=bookmark;$('#copy-bookmark').disabled=false;$('#csfloat-bookmark').onclick=e=>{e.preventDefault();$('#exporter-status').textContent='Save this link on your bookmarks bar first. Then open your Steam inventory and click the saved bookmark there.';};}
 catch(e){$('#exporter-status').textContent=e.message;}
}
prepareExporter();
$('#export').onclick=()=>{const data={...state,requiredPriceNames:result?.missing||[]};const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='counters-workspace.json';a.click();URL.revokeObjectURL(url);};
$('#connect').onclick=async()=>{const b=$('#connect');b.disabled=true;try{const data=await api('/api/inventory?steamId='+encodeURIComponent($('#steam-id').value.trim()));const url=URL.createObjectURL(new Blob([JSON.stringify({inventory:data.items,prices:{}},null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='steam-inventory-add-floats.json';a.click();URL.revokeObjectURL(url);notice(data.note);}catch(e){notice(e.message,true);}finally{b.disabled=false;}};
$('#clear').onclick=()=>{state={inventory:[],prices:{}};result=null;$('#filter').value='';persist();refresh();notice('Inventory cleared.');};
try{
 catalog=await api('/api/catalog');
 let saved=null;
 try{saved=localStorage.getItem('counters-workspace');}catch{notice('Session only. Export inventory to save.');}
 if(saved){
  try{const parsed=JSON.parse(saved);await api('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...parsed,floatRule:'normalized'})});state=parsed;}
  catch{notice('Saved data could not be restored. Import a JSON file.',true);}
 }
 refresh();if(state.inventory.length)await run();
}catch(e){notice('Could not load skin catalog: '+e.message,true);}
