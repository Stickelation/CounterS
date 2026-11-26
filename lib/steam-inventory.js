import {createWeaponSkinLookup} from './inventory-import.js';
import {steamCooldown,steamRateLimitError} from './steam-cooldown.js';

const origin = 'https://steamcommunity.com';
const numericId = /^\d{1,30}$/;

function readWear(properties) {
  if (!Array.isArray(properties)) return null;
  const value = properties.find(property => Number(property?.propertyid) === 2)?.float_value;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(value.trim())) return Number(value);
  return value == null ? null : NaN;
}

export function createSteamInventoryProvider(catalog,{fetchImpl=fetch,now=Date.now,interval=2000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const skinForName=createWeaponSkinLookup(catalog);
  const pending=new Map();
  let queue=Promise.resolve(),nextRequest=0,cooldown=0;
  const rateLimited=()=>steamRateLimitError('Steam inventory',cooldown,now());

  async function load(steamId) {
    const url=new URL('/inventory/'+steamId+'/730/2',origin);
    url.search=new URLSearchParams({l:'english',count:'2000',get_asset_properties:'1'});
    const inventory=[];
    const descriptions=new Map();
    const cursors=new Set();

    for(let page=0;;page++){
      if(page===20)throw Error('Steam inventory exceeds the supported number of pages.');
      if(now()<cooldown)throw rateLimited();
      const delay=nextRequest-now();
      if(delay>0)await sleep(delay);
      nextRequest=now()+interval;

      let response;
      try{
        response=await fetchImpl(url.href,{
          headers:{'User-Agent':'CounterS/0.1',Accept:'application/json'},
          redirect:'error',
          signal:AbortSignal.timeout(15_000),
        });
      }catch{
        throw Object.assign(Error('CounterS could not reach the Steam inventory. Try again later.'),{status:502});
      }
      if(response.status===429){
        cooldown=steamCooldown(response.headers?.get('Retry-After'),now());
        throw rateLimited();
      }
      if(response.status===401||response.status===403){
        throw Object.assign(Error('Steam inventory is private or unavailable. Use Send to CounterS from your Steam inventory tab.'),{status:403});
      }
      if(!response.ok)throw Object.assign(Error('Steam could not return the inventory. Try again later.'),{status:502});

      let data;
      try{data=await response.json();}
      catch{throw Object.assign(Error('Steam returned an unreadable inventory response.'),{status:502});}
      if(data?.success!==1){
        throw Object.assign(Error('Steam inventory is unavailable. Check its visibility or use Send to CounterS.'),{status:403});
      }
      if(data.assets!==undefined&&!Array.isArray(data.assets))throw Error('Steam returned invalid inventory items.');

      for(const description of Array.isArray(data.descriptions)?data.descriptions:[]){
        const name=description?.market_hash_name;
        if(skinForName(name))descriptions.set(description.classid+'-'+description.instanceid,name);
      }
      const pageSkins=new Map();
      for(const asset of data.assets??[]){
        const name=descriptions.get(asset?.classid+'-'+asset?.instanceid);
        if(!name||Number(asset.appid)!==730||String(asset.contextid)!=='2'||typeof asset.assetid!=='string'||!numericId.test(asset.assetid))continue;
        pageSkins.set(asset.assetid,{
          assetId:asset.assetid,
          market_hash_name:name,
          float:readWear(asset.asset_properties),
          floatSource:'steam-asset-property',
        });
      }
      for(const entry of Array.isArray(data.asset_properties)?data.asset_properties:[]){
        const item=pageSkins.get(entry?.assetid);
        if(!item||(entry.contextid!=null&&String(entry.contextid)!=='2')||(entry.appid!=null&&Number(entry.appid)!==730))continue;
        item.float=readWear(entry.asset_properties)??item.float;
      }
      inventory.push(...pageSkins.values());
      if(inventory.length>10_000)throw Error('Steam weapon inventory is too large. Use Send to CounterS with a smaller selection.');
      if(!data.more_items)break;
      const cursor=data.last_assetid;
      if(typeof cursor!=='string'||!numericId.test(cursor)||cursors.has(cursor))throw Error('Steam returned an invalid inventory page cursor. Try again.');
      cursors.add(cursor);
      url.searchParams.set('start_assetid',cursor);
    }
    return {format:'counters-steam-floats-v1',inventory};
  }

  return async function getInventory(steamId) {
    if(typeof steamId!=='string'||!/^\d{17}$/.test(steamId))throw Error('Enter a 17-digit SteamID64.');
    if(now()<cooldown)throw rateLimited();
    if(pending.has(steamId))return pending.get(steamId);
    const request=queue.then(()=>load(steamId));
    pending.set(steamId,request);
    queue=request.catch(()=>{});
    try{return await request;}finally{pending.delete(steamId);}
  };
}
