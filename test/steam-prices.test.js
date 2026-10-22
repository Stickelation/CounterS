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
 await assert.rejects(get('A'),e=>e.status===429);await assert.rejects(get('B'),e=>e.status===429);assert.equal(calls,1);
 time+=60001;await assert.rejects(get('A'),e=>e.status===429);assert.equal(calls,2);
});
test('network, HTTP, and malformed responses give explicit errors without prices',async()=>{
 for(const fetchImpl of [async()=>{throw Error('blocked');},async()=>({ok:false,status:403}),async()=>({ok:true,json:async()=>{throw Error('invalid');}})]){
  const get=createLowestListingProvider({interval:0,fetchImpl});await assert.rejects(get('A'),e=>e.status===502);
 }
 const get=createLowestListingProvider({interval:0,fetchImpl:async()=>({ok:true,json:async()=>({success:true,median_price:'$1.00'})})});
 await assert.rejects(get('A'),e=>e.status===404);
});
