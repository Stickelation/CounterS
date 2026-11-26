import {steamCooldown,steamRateLimitError} from './steam-cooldown.js';

const unavailable = () => Object.assign(new Error('Steam returned no lowest listing for this item.'), {status:404});

export function parseLowestListing(data) {
  if (!data?.success || typeof data.lowest_price !== 'string') {
    throw unavailable();
  }
  // The request pins USD, US country and English. Reject ambiguous formats,
  // rather than accidentally treating a localized decimal separator as thousands.
  const match=data.lowest_price.trim().match(/^(?:US\$|\$)\s*((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?:\s*USD)?$/);
  const price=match?Number(match[1].replaceAll(',','')):NaN;
  if(!Number.isFinite(price)||price<=0) {
    throw Object.assign(new Error('Steam returned an unrecognized USD lowest-listing price.'),{status:502});
  }
  return price;
}

export function createLowestListingProvider({fetchImpl=fetch,now=Date.now,interval=4000,ttl=300000,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const cache=new Map(),pending=new Map();
  let queue=Promise.resolve(),nextRequest=0,cooldown=0,spacing=interval;
  const rateLimited=()=>steamRateLimitError('Steam Market pricing',cooldown,now());
  function remember(name, value) {
    if(cache.size>=5000)cache.delete(cache.keys().next().value);
    cache.set(name,value);
  }
  return function getPrice(name) {
    if(typeof name!=='string'||!name.trim()||name.length>200)throw Object.assign(new Error('A market name of at most 200 characters is required.'),{status:400});
    const cached=cache.get(name);
    if(cached&&now()-cached.cachedAt<ttl)return cached.unavailable?Promise.reject(unavailable()):Promise.resolve(cached);
    if(now()<cooldown)return Promise.reject(rateLimited());
    if(pending.has(name))return pending.get(name);
    const request=queue.then(async()=>{
      if(now()<cooldown)throw rateLimited();
      const delay=nextRequest-now();if(delay>0)await sleep(delay);
      nextRequest=now()+spacing;
      const url=new URL('https://steamcommunity.com/market/priceoverview/');
      url.search=new URLSearchParams({appid:'730',currency:'1',country:'US',l:'english',market_hash_name:name});
      let response;
      try{response=await fetchImpl(url,{headers:{'User-Agent':'CounterS/0.1','Accept':'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}
      catch{throw Object.assign(new Error('Cannot reach Steam Market. Allow steamcommunity.com in environment network settings and check connectivity.'),{status:502});}
      if(response.status===429){
        const time=now();
        cooldown=steamCooldown(response.headers?.get('Retry-After'),time);
        spacing=Math.max(spacing,Math.min(15_000,Math.max(5000,Math.ceil(spacing*1.5))));
        throw rateLimited();
      }
      if(!response.ok)throw Object.assign(new Error(`Steam Market returned HTTP ${response.status}. Check network access or try again later.`),{status:502});
      let data;try{data=await response.json();}catch{throw Object.assign(new Error('Steam Market returned an invalid JSON response.'),{status:502});}
      let price;
      try{price=parseLowestListing(data);}
      catch(error){if(error.status===404)remember(name,{unavailable:true,cachedAt:now()});throw error;}
      const cachedAt=now();
      const quote={price,currency:'USD',source:'steam-lowest-listing',timestamp:new Date(cachedAt).toISOString(),cachedAt,note:'Lowest advertised buyer price, including Steam fees; not a completed sale or seller proceeds.'};
      // Bound process memory even when many different market names are requested.
      remember(name,quote);return quote;
    });
    pending.set(name,request);queue=request.catch(()=>{});
    request.then(()=>pending.delete(name),()=>pending.delete(name));
    return request;
  };
}
