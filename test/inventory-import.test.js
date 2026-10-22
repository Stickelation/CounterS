import {test} from 'node:test';
import assert from 'node:assert/strict';
import {importSteamFloats} from '../lib/inventory-import.js';
const catalog=[{id:'revolver',name:'R8 Revolver | Monarch',min:0,max:1,stattrak:true}];
const item={assetId:'12345678901234567',market_hash_name:'R8 Revolver | Monarch (Well-Worn)',float:0.43572545051575,floatSource:'csfloat-extension'};
const data=inventory=>({format:'counters-steam-floats-v1',inventory});
test('CSFloat exports map market names to skin IDs without rounding floats or asset IDs',()=>{
 const result=importSteamFloats(data([item]),catalog);
 assert.equal(result.inventory[0].float,0.43572545051575);assert.equal(result.inventory[0].assetId,item.assetId);
 assert.equal(result.inventory[0].skinId,'revolver');assert.equal(result.inventory[0].floatSource,'csfloat-extension');assert.equal(result.report.imported,1);
});
test('StatTrak and Souvenir variants are preserved and zero is a valid float',()=>{
 const r=importSteamFloats(data([{...item,market_hash_name:'StatTrak™ '+item.market_hash_name,float:0}]),catalog);
 assert.equal(r.inventory[0].stattrak,true);assert.equal(r.inventory[0].float,0);
 assert.equal(importSteamFloats(data([{...item,market_hash_name:'Souvenir '+item.market_hash_name}]),catalog).inventory[0].souvenir,true);
});
test('missing, malformed, and unsupported values are reported separately',()=>{
 const r=importSteamFloats(data([item,{...item,assetId:'2',float:null},{...item,assetId:'3',float:'0.43'},{...item,assetId:'4',market_hash_name:'Sticker | Example'}]),catalog);
 assert.equal(r.report.imported,1);assert.equal(r.report.missingFloat,1);assert.equal(r.report.invalidFloat,1);assert.equal(r.report.unsupported,1);
});
test('empty captures and duplicate assets cannot replace a usable workspace',()=>{
 assert.throws(()=>importSteamFloats(data([{...item,float:null}]),catalog),/No supported/);
 assert.throws(()=>importSteamFloats(data([item,item]),catalog),/duplicate/);
 assert.throws(()=>importSteamFloats(data([{...item,assetId:123}]),catalog),/asset ID/);
});
