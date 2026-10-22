import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {analyze,validateInventory,validateQuotes} from './lib/tradeup.js';
import {createLowestListingProvider} from './lib/steam-prices.js';
import {importSteamFloats} from './lib/inventory-import.js';
import {createDemo} from './lib/demo.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const catalog=JSON.parse(await readFile(root+'data/catalog.json','utf8'));
const port=Number(process.env.PORT||3000);
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw Error('Request exceeds 2 MB.');}return JSON.parse(raw);}
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const lowestListing=createLowestListingProvider();
async function steam(url,headers={}) {
 const response=await fetch(url,{headers:{'User-Agent':'CounterS/0.1',...headers},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error(`Steam returned HTTP ${response.status}. Check public inventory visibility, network access, or rate limits.`);
 return response.json();
}
http.createServer(async(req,res)=>{
 try {
 const url=new URL(req.url,'http://localhost');
 if(req.method==='GET'&&url.pathname==='/api/catalog')return send(res,200,catalog);
 if(req.method==='GET'&&url.pathname==='/api/demo')return send(res,200,createDemo(catalog));
 if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,catalog:catalog.length});
 if(req.method==='POST'&&url.pathname==='/api/import-steam-floats')return send(res,200,importSteamFloats(await body(req),catalog));
 if(req.method==='POST'&&url.pathname==='/api/analyze'){
  const b=await body(req);const items=validateInventory(b.inventory,catalog);const quotes=validateQuotes(b.prices);
  if(!['normalized','legacy'].includes(b.floatRule))throw Error('Choose a supported float rule.');
  return send(res,200,analyze(items,catalog,quotes,{floatRule:b.floatRule,fee:0}));
 }
 if(req.method==='GET'&&url.pathname==='/api/inventory'){
  const id=url.searchParams.get('steamId');if(!/^7656119\d{10}$/.test(id||''))throw Error('Enter a 17-digit SteamID64.');
  const assets=[], descriptions=[];let start;let pages=0;
  do {
   const data=await steam(`https://steamcommunity.com/inventory/${id}/730/2?l=english&count=2000${start?'&start_assetid='+start:''}`);
   if(data.success!==1)throw Error('Steam inventory is unavailable or private.');
   assets.push(...(data.assets||[]));descriptions.push(...(data.descriptions||[]));
   start=data.more_items?data.last_assetid:null;if(++pages>20)throw Error('Inventory exceeds supported size.');
  }while(start);
  const byClass=new Map(descriptions.map(d=>[`${d.classid}-${d.instanceid}`,d]));
  return send(res,200,{items:assets.map(a=>{const d=byClass.get(`${a.classid}-${a.instanceid}`);const name=d?.market_hash_name||'';const base=name.replace(/^StatTrak™ |^Souvenir /,'').replace(/ \([^()]+\)$/,'');return {assetId:a.assetid,skinId:catalog.find(s=>s.name===base)?.id||null,name,float:null,stattrak:name.startsWith('StatTrak™'),souvenir:name.startsWith('Souvenir ')};}),note:'This public snapshot omits floats. Use Import floats from CSFloat Market Checker to capture exact values from your Steam inventory tab.'});
 }
 if(req.method==='GET'&&url.pathname==='/api/price'){
  return send(res,200,await lowestListing(url.searchParams.get('name')));
 }
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed.'});
 const files={'/':'index.template.html','/app.js':'app.js','/style.css':'style.css','/steam-export.js':'steam-export.js'};
 if(!files[url.pathname])return send(res,404,{error:'Not found.'});
 const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https://community.akamai.steamstatic.com; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(root+'public/'+file));
 }catch(e){send(res,e.status||400,{error:e.message});}
}).listen(port,'0.0.0.0',()=>console.log(`CounterS listening on port ${port}`));
