import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStandaloneApi} from '../lib/standalone-api.js';
import {analyze,marketName,validateInventory} from '../lib/tradeup.js';
const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
const api=createStandaloneApi(catalog);

const input=catalog.find(s=>s.name==='AK-47 | Uncharted');
const outputs=catalog.filter(s=>s.collection===input.collection&&s.rarity===input.rarity+1);
const float=skin=>skin.min+.137*(skin.max-skin.min);
const fixture={
 inventory:Array.from({length:12},(_,n)=>({assetId:String(100+n),skinId:input.id,float:float(input)})),
 prices:Object.fromEntries([input,...outputs].map((s,n)=>[marketName(s,float(s)),{price:n?20:2,currency:'USD',source:'steam-last-sale',timestamp:'2026-10-21T12:00:00Z'}])),
};

test('standalone imported inventory runs the same complete analysis as the server engine',async()=>{
 const result=await api('/api/analyze',{method:'POST',body:JSON.stringify({...fixture,floatRule:'normalized'})});
 assert.equal(result.checked,66);assert.equal(result.best.length,10);assert.equal(result.truncated,false);
 assert.deepEqual(result,analyze(validateInventory(fixture.inventory,catalog),catalog,fixture.prices,{floatRule:'normalized',fee:0}));
});
test('standalone rejects live Steam operations explicitly and does not invent quotes',async()=>{
 await assert.rejects(api('/api/demo'),e=>e.status===404);
 for(const path of ['/api/price?name=test','/api/inventory?steamId=test'])await assert.rejects(api(path),e=>e.status===503&&/server/.test(e.message));
 await assert.rejects(api('/api/steam/sign-in',{method:'POST',body:'{}'}),e=>e.status===503&&/server/.test(e.message));
});
test('standalone validates imported floats and preserves duplicate-asset protection',async()=>{
 const original=fixture.inventory[0];
 const data={format:'counters-steam-floats-v1',inventory:[{assetId:'12345',market_hash_name:marketName(input,original.float),float:original.float,floatSource:'csfloat-extension'}]};
 const imported=await api('/api/import-steam-floats',{method:'POST',body:JSON.stringify(data)});
 assert.equal(imported.inventory[0].float,original.float);assert.equal(imported.report.imported,1);
 await assert.rejects(api('/api/analyze',{method:'POST',body:JSON.stringify({...fixture,inventory:[original,original],floatRule:'normalized'})}),/Duplicate/);
});
