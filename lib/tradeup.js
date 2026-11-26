export const rarities = ['Consumer Grade','Industrial Grade','Mil-Spec Grade','Restricted','Classified','Covert'];
const indexes=new WeakMap();
function index(catalog){
 if(indexes.has(catalog))return indexes.get(catalog);
 const byId=new Map(catalog.map(s=>[s.id,s])),pools=new Map();
 for(const s of catalog){const key=`${s.collection}:${s.rarity}`;if(!pools.has(key))pools.set(key,[]);pools.get(key).push(s);}
 const result={byId,pools};indexes.set(catalog,result);return result;
}
export function wear(f) { return f < .07 ? 'Factory New' : f < .15 ? 'Minimal Wear' : f < .38 ? 'Field-Tested' : f < .45 ? 'Well-Worn' : 'Battle-Scarred'; }
export function marketName(s, f, stattrak = false) { return `${stattrak ? 'StatTrak™ ' : ''}${s.name} (${wear(f)})`; }
export function validateInventory(items, catalog) {
  if (!Array.isArray(items) || items.length > 500) throw Error('Import an array of at most 500 inventory items.');
  const ids = new Set();
  return items.map((i, n) => {
    const skin = catalog.find(s => s.id === i.skinId);
    if (!skin) throw Error(`Item ${n+1}: unknown skinId.`);
    if (typeof i.float !== 'number' || !Number.isFinite(i.float) || i.float < skin.min || i.float > skin.max) throw Error(`Item ${n+1}: float must be between ${skin.min} and ${skin.max}.`);
    const assetId = String(i.assetId || `import-${n}`);
    if (ids.has(assetId)) throw Error('Duplicate asset ID: '+assetId);
    ids.add(assetId);
    if (i.stattrak && !skin.stattrak) throw Error(`Item ${n+1}: skin does not support StatTrak.`);
    return {assetId, skinId:skin.id, float:i.float, stattrak:!!i.stattrak, souvenir:!!i.souvenir, floatSource:['csfloat-extension','steam-asset-property'].includes(i.floatSource)?i.floatSource:'imported'};
  });
}
export function validateQuotes(quotes) {
  if (!quotes || typeof quotes !== 'object' || Array.isArray(quotes)) throw Error('Prices must be an object keyed by Steam market name.');
  for (const [name,q] of Object.entries(quotes)) {
    if (!q || !Number.isFinite(q.price) || q.price <= 0 || q.currency !== 'USD' || !['steam-lowest-listing','steam-last-sale','steam-history'].includes(q.source) || !Number.isFinite(Date.parse(q.timestamp))) throw Error(`Invalid USD price, source, or timestamp for ${name}.`);
  }
  return quotes;
}
export function contract(items, catalog, quotes, {fee=.15, floatRule='normalized'}={}) {
  if (items.length !== 10) throw Error('A standard contract requires 10 items.');
  const {byId,pools} = index(catalog);
  const skins = items.map(i=>byId.get(i.skinId));
  const rank = skins[0].rarity, st = items[0].stattrak;
  if (rank >= 5 || items.some((i,n)=>i.souvenir || i.stattrak !== st || skins[n].rarity !== rank)) throw Error('Incompatible contract inputs.');
  const avg = items.reduce((sum,i,n)=>sum+(floatRule==='normalized' ? (i.float-skins[n].min)/(skins[n].max-skins[n].min) : i.float),0)/10;
  const counts = new Map(); skins.forEach(s=>counts.set(s.collection,(counts.get(s.collection)||0)+1));
  const outcomes = [];
  for (const [collection,count] of counts) {
    const pool = (pools.get(`${collection}:${rank+1}`)||[]).filter(s=>!st || s.stattrak);
    if (!pool.length) throw Error('Collection has no eligible next-tier outputs.');
    for (const s of pool) {
      const float = Math.min(s.max,Math.max(s.min,s.min+avg*(s.max-s.min)));
      const name = marketName(s,float,st);
      outcomes.push({skinId:s.id,name,float,probability:count/10/pool.length,quote:quotes[name]||null});
    }
  }
  const inputs = items.map((i,n)=>({...i,name:marketName(skins[n],i.float,st),quote:quotes[marketName(skins[n],i.float,st)]||null}));
  const missing = [...new Set([...inputs,...outcomes].filter(x=>!x.quote).map(x=>x.name))];
  if (missing.length) return {inputs,outcomes,missing,complete:false};
  const cost=inputs.reduce((s,i)=>s+i.quote.price,0);
  const expected=outcomes.reduce((s,o)=>s+o.probability*o.quote.price,0);
  return {inputs,outcomes,missing,complete:true,cost,expected,netExpected:expected*(1-fee),grossRoi:(expected-cost)/cost,netRoi:(expected*(1-fee)-cost)/cost,profit:expected*(1-fee)-cost,winChance:outcomes.reduce((s,o)=>s+(o.quote.price*(1-fee)>cost?o.probability:0),0)};
}
export function analyze(items,catalog,quotes,options={}) {
  const limit=1_000_000;
  const groups=new Map();
  const {byId,pools}=index(catalog);
  for (const i of items) {
    const s=byId.get(i.skinId);
    const outputs=pools.get(`${s.collection}:${s.rarity+1}`);
    if(i.souvenir || s.rarity>=5 || !outputs?.length || (i.stattrak && !outputs.some(o=>o.stattrak))) continue;
    const key=`${s.rarity}-${i.stattrak}`;
    if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(i);
  }
  const eligible=[...groups.values()].reduce((n,g)=>n+g.length,0);
  const searchGroups=[...groups.values()].filter(pool=>pool.length>=10).map(pool=>({pool}));
  const choose=combinationCounts(Math.max(0,...searchGroups.map(({pool})=>pool.length)));
  let budget=limit;
  const smallestFirst=[...searchGroups].sort((a,b)=>a.pool.length-b.pool.length);
  for(const [index,group] of smallestFirst.entries()){
    const share=Math.floor(budget/(searchGroups.length-index));
    group.total=choose[group.pool.length][10];
    group.check=group.total>BigInt(share)?share:Number(group.total);
    budget-=group.check;
  }

  let checked=0, incomplete=0;
  const best=[], missing=new Set();
  function evaluate(picked){
    checked++;
    const c=contract(picked,catalog,quotes,options);
    if(!c.complete){incomplete++;c.missing.forEach(n=>missing.add(n));return;}
    if(best.length===10&&c.grossRoi<=best[9].grossRoi)return;
    best.push(c);best.sort((a,b)=>b.grossRoi-a.grossRoi);if(best.length>10)best.pop();
  }
  function visit(pool,start,picked) {
    if(picked.length===10){
      evaluate(picked);return;
    }
    for(let j=start;j<=pool.length-(10-picked.length);j++){
      picked.push(pool[j]);visit(pool,j+1,picked);picked.pop();
    }
  }

  let truncated=false;
  for(const {pool,total,check} of searchGroups){
    if(total===BigInt(check)){visit(pool,0,[]);continue;}
    truncated=true;
    // Evenly spaced combination ranks cover the whole group without repeats.
    const picked=new Array(10);
    const lastRank=total-1n;
    const steps=BigInt(check-1);
    for(let sample=0n;sample<=steps;sample++){
      const rank=sample*lastRank/steps;
      pickCombination(pool,choose,rank,picked);
      evaluate(picked);
    }
  }
  return {best,checked,incomplete,truncated,missing:[...missing],eligible};
}

function combinationCounts(size){
  const counts=Array.from({length:size+1},()=>[1n,...Array(10).fill(0n)]);
  for(let n=1;n<=size;n++)for(let k=1;k<=Math.min(n,10);k++)counts[n][k]=counts[n-1][k-1]+counts[n-1][k];
  return counts;
}

function pickCombination(pool,choose,rank,picked){
  let last=pool.length-1;
  for(let k=10;k>0;k--){
    let first=k-1;
    // C(index, k) counts combinations preceding this choice in colexicographic order.
    while(first<last){
      const middle=Math.ceil((first+last)/2);
      if(choose[middle][k]<=rank)first=middle;else last=middle-1;
    }
    picked[k-1]=pool[first];
    rank-=choose[first][k];
    last=first-1;
  }
}
