import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createStandaloneApi} from '../lib/standalone-api.js';
import {analyze,validateInventory} from '../lib/tradeup.js';
const catalog=JSON.parse(await readFile(new URL('../data/catalog.json',import.meta.url),'utf8'));
const api=createStandaloneApi(catalog);

test('standalone demo runs the same complete analysis as the server engine',async()=>{
 const demo=await api('/api/demo');
 const result=await api('/api/analyze',{method:'POST',body:JSON.stringify({...demo,floatRule:'normalized'})});
 assert.equal(result.checked,66);assert.equal(result.best.length,10);assert.equal(result.truncated,false);
 assert.deepEqual(result,analyze(validateInventory(demo.inventory,catalog),catalog,demo.prices,{floatRule:'normalized',fee:0}));
});
test('standalone rejects live Steam operations explicitly and does not invent quotes',async()=>{
 for(const path of ['/api/price?name=test','/api/inventory?steamId=test'])await assert.rejects(api(path),e=>e.status===503&&/server/.test(e.message));
});
test('standalone validates imported floats and preserves duplicate-asset protection',async()=>{
 const demo=await api('/api/demo');const original=demo.inventory[0];
 const s=catalog.find(s=>s.id===original.skinId);
 const data={format:'counters-steam-floats-v1',inventory:[{assetId:'12345',market_hash_name:s.name+' (Factory New)',float:original.float,floatSource:'csfloat-extension'}]};
 const imported=await api('/api/import-steam-floats',{method:'POST',body:JSON.stringify(data)});
 assert.equal(imported.inventory[0].float,original.float);assert.equal(imported.report.imported,1);
 await assert.rejects(api('/api/analyze',{method:'POST',body:JSON.stringify({...demo,inventory:[original,original],floatRule:'normalized'})}),/Duplicate/);
});
