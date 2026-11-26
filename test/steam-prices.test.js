import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLowestListing,createLowestListingProvider} from '../lib/steam-prices.js';
import {validateQuotes} from '../lib/tradeup.js';

test('lowest listings parse USD without substituting median sales prices',()=>{
 assert.equal(parseLowestListing({success:true,lowest_price:'$1,234.56 USD',median_price:'$999.99'}),1234.56);
 assert.equal(parseLowestListing({success:true,lowest_price:'$0.03'}),.03);
 assert.equal(parseLowestListing({success:true,lowest_price:'US$ 12.34'}),12.34);
 assert.throws(()=>parseLowestListing({success:true,median_price:'$3.00'}),e=>e.status===404);
 for(const lowest_price of ['$0.00','€1.50','$1.234,56','garbage','-$1.00'])assert.throws(()=>parseLowestListing({success:true,lowest_price}),e=>e.status===502);
});
test('provider pins CS2 / USD and encodes names, deduplicates requests, and refreshes expired cache',async()=>{
 let time=Date.parse('2026-10-21T12:00:00Z'),calls=0;
 const name='StatTrak™ AK-47 | Redline (Field-Tested)';
 const get=createLowestListingProvider({interval:0,now:()=>time,fetchImpl:async url=>{
  calls++;assert.equal(url.origin,'https://steamcommunity.com');assert.equal(url.pathname,'/market/priceoverview/');
  assert.equal(url.searchParams.get('appid'),'730');assert.equal(url.searchParams.get('currency'),'1');assert.equal(url.searchParams.get('country'),'US');assert.equal(url.searchParams.get('l'),'english');assert.equal(url.searchParams.get('market_hash_name'),name);
  return {ok:true,status:200,json:async()=>({success:true,lowest_price:'$12.34',median_price:'$5.00'})};
 }});
 const [a,b]=await Promise.all([get(name),get(name)]);assert.equal(calls,1);assert.deepEqual(a,b);assert.equal(a.price,12.34);assert.equal(a.source,'steam-lowest-listing');validateQuotes({[name]:a});
 await get(name);assert.equal(calls,1);time+=300001;await get(name);assert.equal(calls,2);
});
test('rate limits apply a cooldown and failures never become cached quotes',async()=>{
 let calls=0,time=100000;
 const get=createLowestListingProvider({interval:0,now:()=>time,fetchImpl:async()=>{calls++;return {ok:false,status:429};}});
 await assert.rejects(get('A'),e=>e.status===429&&e.retryAfter===120);
 time+=119_000;await assert.rejects(get('B'),e=>e.status===429&&e.retryAfter===1);assert.equal(calls,1);
 time+=1_000;await assert.rejects(get('A'),e=>e.status===429);assert.equal(calls,2);
});
test('Steam Retry-After seconds and HTTP dates delay uncached requests while cached prices stay available',async()=>{
 const start=Date.parse('2026-10-21T12:00:00Z');
 for(const retryAfter of ['180',new Date(start+180_000).toUTCString()]){
  let time=start,calls=0;
  const ok=()=>Response.json({success:true,lowest_price:'$2.00'});
  const get=createLowestListingProvider({interval:0,now:()=>time,fetchImpl:async()=>{
   calls++;return calls===2?new Response(null,{status:429,headers:{'Retry-After':retryAfter}}):ok();
  }});
  const cached=await get('A');
  await assert.rejects(get('B'),e=>e.status===429&&e.retryAfter===180);
  assert.equal(await get('A'),cached);
  time+=179_000;await assert.rejects(get('B'),e=>e.status===429&&e.retryAfter===1);assert.equal(calls,2);
  time+=1_000;assert.equal((await get('B')).price,2);assert.equal(calls,3);
 }
});
test('uncached requests start four seconds apart and slow down after rate limits',async()=>{
 let time=0;
 const calls=[];
 const get=createLowestListingProvider({
  now:()=>time,
  sleep:async ms=>{time+=ms;},
  fetchImpl:async()=>{
   calls.push(time);
   return [3,6].includes(calls.length)?new Response(null,{status:429}):Response.json({success:true,lowest_price:'$2.00'});
  },
 });
 await get('A');await get('B');
 await assert.rejects(get('C'),e=>e.retryAfter===120);
 time+=120_000;
 await get('D');await get('E');
 await assert.rejects(get('F'),e=>e.retryAfter===120);
 time+=120_000;
 await get('G');await get('H');
 assert.deepEqual(calls,[0,4000,8000,128000,134000,140000,260000,269000]);
});
test('unavailable listings are remembered briefly without becoming prices',async()=>{
 let time=100000,calls=0;
 const get=createLowestListingProvider({interval:0,now:()=>time,fetchImpl:async()=>{
  calls++;return Response.json({success:true});
 }});
 await assert.rejects(get('A'),e=>e.status===404);
 await assert.rejects(get('A'),e=>e.status===404);assert.equal(calls,1);
 time+=300001;await assert.rejects(get('A'),e=>e.status===404);assert.equal(calls,2);
});
test('network, HTTP, and malformed responses give explicit errors without prices',async()=>{
 for(const fetchImpl of [async()=>{throw Error('blocked');},async()=>({ok:false,status:403}),async()=>({ok:true,json:async()=>{throw Error('invalid');}})]){
  const get=createLowestListingProvider({interval:0,fetchImpl});await assert.rejects(get('A'),e=>e.status===502);
 }
 const get=createLowestListingProvider({interval:0,fetchImpl:async()=>({ok:true,json:async()=>({success:true,median_price:'$1.00'})})});
 await assert.rejects(get('A'),e=>e.status===404);
});
