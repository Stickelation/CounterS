import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app=await readFile(new URL('../public/app.js',import.meta.url),'utf8');

test('price refresh resumes after a 429 and only ranks contracts after all prices are available',async()=>{
 const catalog=[{id:'a',name:'First skin',collectionName:'Test Collection',rarity:2},{id:'b',name:'Second skin'}];
 const a='First skin (Factory New)';
 const b='Second skin (Factory New)';
 const output='Contract output (Factory New)';
 const quote={price:2,source:'steam-lowest-listing',currency:'USD',timestamp:new Date().toISOString()};
 const inventory=[{assetId:'1',skinId:'a',float:.01},{assetId:'2',skinId:'b',float:.01},{assetId:'3',skinId:'b',float:.02}];
 let saved=JSON.stringify({
  inventory,
  prices:{[a]:quote,[b]:{...quote,source:'steam-last-sale'}},
 });
 let limited=true;
 const requests=[];
 const progress=[];
 const analyzed=[];
 async function open(){
  const elements=new Map();
  function element(selector){
   if(!elements.has(selector))elements.set(selector,{value:'',classList:{toggle(){}}});
   return elements.get(selector);
  }
  await runInNewContext(`(async()=>{${app}})()`,{
   document:{querySelector:element,querySelectorAll:()=>[]},
   location:new URL('http://127.0.0.1:3000/'),URL,URLSearchParams,AbortController,
   localStorage:{getItem:()=>saved,setItem:(_key,value)=>{saved=value;}},
   sessionStorage:{getItem:()=>null},
   async fetch(path,options){
    if(path==='/api/catalog')return Response.json(catalog);
    if(path==='/steam-export.js')return new Response('');
    if(path==='/api/analyze'){
     const prices=JSON.parse(options.body).prices;
     analyzed.push(prices);
     const missing=[a,output].filter(name=>!(name in prices));
     const best=missing.length?[]:[{inputs:[inventory[0]],outcomes:[],cost:2,expected:2.2,grossRoi:.1}];
     return Response.json({best,checked:1,incomplete:missing.length?1:0,missing,truncated:false});
    }
    const name=new URL(path,'http://127.0.0.1:3000').searchParams.get('name');
    requests.push(name);
    progress.push(element('#notice').textContent);
    if(name===b&&limited)return Response.json({error:'Steam rate limit reached. Try again in 2 minutes.'},{status:429});
    return Response.json(quote);
   },
  });
  return element;
 }
 const first=await open();
 await first('#refresh-prices').onclick();
 assert.deepEqual(requests,[output,b]);
 assert.match(progress[0],/1 inventory skin quote left · 1 trade-up output quote left/);
 assert.match(progress[1],/1 inventory skin quote left · 0 trade-up output quotes left/);
 assert.deepEqual(JSON.parse(saved).prices,{[a]:quote,[output]:quote});
 assert.deepEqual(analyzed.at(-1),{[a]:quote,[output]:quote});
 assert.match(first('#notice').textContent,/1 new · 1 reused · 1 inventory skin quote left · 0 trade-up output quotes left.*2 minutes/);
 assert.equal(first('#roi').textContent,'—');
 assert.match(first('#results').innerHTML,/Waiting for 1 price/);
 assert.doesNotMatch(first('#results').innerHTML,/View contract/);

 limited=false;
 const resumed=await open();
 const refresh=resumed('#refresh-prices').onclick();
 assert.match(resumed('#results').innerHTML,/Rankings appear once pricing is complete/);
 await refresh;
 assert.deepEqual(requests,[output,b,b]);
 assert.deepEqual(JSON.parse(saved).prices,{[a]:quote,[output]:quote,[b]:quote});
 assert.match(resumed('#notice').textContent,/1 new · 2 reused/);
 assert.equal(resumed('#roi').textContent,'+10.00%');
 assert.match(resumed('#results').innerHTML,/View contract/);
});
