import {test} from 'node:test';
import assert from 'node:assert/strict';
import {contract,analyze,validateInventory,validateQuotes,wear} from '../lib/tradeup.js';
const skin=(id,collection,rarity,min=0,max=1)=>({id,name:id,collection,rarity,min,max,stattrak:true});
const catalog=[skin('a','A',2),skin('b','B',2),skin('a1','A',3),skin('a2','A',3),skin('b1','B',3)];
const items=Array.from({length:10},(_,n)=>({assetId:String(n),skinId:n<6?'a':'b',float:.1,stattrak:false}));
const quote=price=>({price,currency:'USD',source:'steam-last-sale',timestamp:'2026-10-21T12:00:00Z'});
const quotes={'a (Minimal Wear)':quote(1),'b (Minimal Wear)':quote(2),'a1 (Minimal Wear)':quote(10),'a2 (Minimal Wear)':quote(20),'b1 (Minimal Wear)':quote(30)};
test('collection-weighted probabilities, expected value, and gross ROI',()=>{
 const c=contract(items,catalog,quotes,{fee:0});assert.deepEqual(c.outcomes.map(o=>o.probability),[.3,.3,.4]);assert.equal(c.cost,14);assert.equal(c.expected,21);assert.equal(c.grossRoi,.5);assert.equal(c.winChance,.7);
});
test('normalized floats map individual input ranges to output ranges',()=>{
 const skins=[skin('a','A',2,.1,.5),skin('o','A',3,.2,.6)];
 const ins=items.map(i=>({...i,skinId:'a',float:.3}));
 assert.ok(Math.abs(contract(ins,skins,{}).outcomes[0].float-.4)<1e-12);
 assert.ok(Math.abs(contract(ins,skins,{}, {floatRule:'legacy'}).outcomes[0].float-.32)<1e-12);
});
test('missing one possible output quote excludes the entire contract',()=>{
 const q={...quotes};delete q['b1 (Minimal Wear)'];const r=analyze(items,catalog,q);assert.equal(r.best.length,0);assert.equal(r.incomplete,1);assert.deepEqual(r.missing,['b1 (Minimal Wear)']);
});
test('exhaustive search enumerates each physical combination once',()=>{
 const r=analyze([...items,{...items[0],assetId:'extra'}],catalog,quotes);assert.equal(r.checked,11);assert.equal(r.truncated,false);assert.equal(r.best.length,10);assert.ok(r.best.every((c,n,a)=>!n||a[n-1].grossRoi>=c.grossRoi));
});
test('StatTrak, rarity, and Souvenir cannot be mixed',()=>{
 assert.throws(()=>contract(items.map((i,n)=>({...i,stattrak:n===0})),catalog,quotes));
 assert.equal(analyze(items.map(i=>({...i,souvenir:true})),catalog,quotes).checked,0);
});
test('imports reject duplicate assets, invalid floats, and malformed quotes',()=>{
 assert.throws(()=>validateInventory([...items,items[0]],catalog),/Duplicate/);
 assert.throws(()=>validateInventory([{...items[0],float:NaN}],catalog),/float/);
 assert.throws(()=>validateInventory([{...items[0],float:'0.1'}],catalog),/float/);
 assert.throws(()=>validateQuotes({a:quote(-1)}));assert.throws(()=>validateQuotes({a:{...quote(1),currency:'EUR'}}));
});
test('wear boundaries use the correct market name bands',()=>{
 assert.deepEqual([0,.07,.15,.38,.45,1].map(wear),['Factory New','Minimal Wear','Field-Tested','Well-Worn','Battle-Scarred','Battle-Scarred']);
});
test('a group over the previous limit can be searched exhaustively',()=>{
 const pool=Array.from({length:21},(_,n)=>({...items[0],assetId:String(n)}));
 const r=analyze(pool,catalog,quotes);
 assert.equal(r.checked,352716);
 assert.equal(r.truncated,false);
 assert.equal(r.best.length,10);
});
test('a million-contract search samples late assets and covers smaller eligible groups',()=>{
 const large=Array.from({length:200},(_,n)=>({...items[0],assetId:String(n),float:n===199?.2:.1}));
 const small=items.map((item,n)=>({...item,skinId:'a',assetId:`stat-${n}`,stattrak:true}));
 const allQuotes={...quotes,'a (Field-Tested)':quote(.25),'StatTrak™ a (Minimal Wear)':quote(1),
  'StatTrak™ a1 (Minimal Wear)':quote(100),'StatTrak™ a2 (Minimal Wear)':quote(100)};
 const r=analyze([...large,...small],catalog,allQuotes);
 assert.equal(r.checked,1_000_000);
 assert.equal(r.truncated,true);
 assert.equal(r.incomplete,0);
 assert.equal(r.best.length,10);
 assert.ok(r.best[0].inputs.every(item=>item.stattrak));
 assert.ok(r.best[1].inputs.some(item=>item.assetId==='199'));
 assert.equal(new Set(r.best.map(c=>c.inputs.map(i=>i.assetId).join(','))).size,10);
});
