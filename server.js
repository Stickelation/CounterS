import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {analyze,validateInventory,validateQuotes} from './lib/tradeup.js';
import {createLowestListingProvider} from './lib/steam-prices.js';
import {createWeaponSkinLookup,importSteamFloats} from './lib/inventory-import.js';
import {createSteamInventoryProvider} from './lib/steam-inventory.js';
import {createSteamSignIn} from './lib/steam-sign-in.js';
const root=fileURLToPath(new URL('.',import.meta.url));
const catalog=JSON.parse(await readFile(root+'data/catalog.json','utf8'));
const port=Number(process.env.PORT||3000);
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw Error('Request exceeds 2 MB.');}return JSON.parse(raw);}
const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const lowestListing=createLowestListingProvider();
const steamSignIn=createSteamSignIn();
const getInventory=createSteamInventoryProvider(catalog);
const skinForName=createWeaponSkinLookup(catalog);
const server=http.createServer(async(req,res)=>{
 res.setHeader('Referrer-Policy','same-origin');
 try {
 const loopbackOrigins=['127.0.0.1','localhost'].map(host=>new URL(`http://${host}:${req.socket.localPort}`));
 const origin=loopbackOrigins.find(address=>address.host===req.headers.host)?.origin;
 if(!origin)return send(res,403,{error:'CounterS requires a local loopback address.'});
 const url=new URL(req.url,origin);
 if(url.origin!==origin)return send(res,403,{error:'CounterS requires a local loopback address.'});
 if(req.method==='GET'&&url.pathname==='/api/catalog')return send(res,200,catalog);
 if(req.method==='GET'&&url.pathname==='/api/health')return send(res,200,{ok:true,catalog:catalog.length});
 if(req.method==='POST'&&url.pathname==='/api/import-steam-floats')return send(res,200,importSteamFloats(await body(req),catalog));
 if(req.method==='POST'&&url.pathname==='/api/analyze'){
  const b=await body(req);const items=validateInventory(b.inventory,catalog);const quotes=validateQuotes(b.prices);
  if(!['normalized','legacy'].includes(b.floatRule))throw Error('Choose a supported float rule.');
  return send(res,200,analyze(items,catalog,quotes,{floatRule:b.floatRule,fee:0}));
 }
 if(req.method==='POST'&&['/api/steam/sign-in','/api/steam/result'].includes(url.pathname)){
  if(req.headers.origin!==origin)return send(res,403,{error:'Start Steam sign-in from the CounterS page.'});
  if(url.pathname==='/api/steam/sign-in')return send(res,200,steamSignIn.start(origin));
  const result=steamSignIn.finish((await body(req))?.state,origin);
  return send(res,result.error?400:200,result);
 }
 if(req.method==='GET'&&url.pathname==='/api/steam/callback'){
  await steamSignIn.callback(url,origin);
  res.writeHead(303,{'Location':'/?steam-return=1','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  return res.end();
 }
 if(req.method==='GET'&&url.pathname==='/api/inventory'){
  const snapshot=await getInventory(url.searchParams.get('steamId'));
  if(url.searchParams.get('format')==='workspace')return send(res,200,importSteamFloats(snapshot,catalog,{publicInventory:true}));
  const items=snapshot.inventory.map(({assetId,market_hash_name:name,float})=>{
   return {assetId,skinId:skinForName(name).id,name,float,stattrak:name.startsWith('StatTrak™ '),souvenir:name.startsWith('Souvenir ')};
  });
  return send(res,200,{items,note:'Supported weapon skins only. Use Send to CounterS for missing exact floats.'});
 }
 if(req.method==='GET'&&url.pathname==='/api/price'){
  const name=url.searchParams.get('name');
  if(!skinForName(name))return send(res,400,{error:'Enter the market name of a supported weapon skin.'});
  return send(res,200,await lowestListing(name));
 }
 if(req.method!=='GET')return send(res,405,{error:'Method not allowed.'});
 const files={'/':'index.template.html','/app.js':'app.js','/style.css':'style.css','/steam-export.js':'steam-export.js'};
 if(!files[url.pathname])return send(res,404,{error:'Not found.'});
 res.setHeader('Cache-Control','no-cache');
 const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' https://community.akamai.steamstatic.com https://shared.akamai.steamstatic.com/community_assets/images/steamworks_docs/english/sits_large_noborder.png; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(await readFile(root+'public/'+file));
 }catch(e){
  if(e.retryAfter)res.setHeader('Retry-After',String(e.retryAfter));
  send(res,e.status||400,{error:e.message});
 }
});
server.listen(port,'127.0.0.1',()=>{
 console.log(`CounterS listening at http://127.0.0.1:${server.address().port}/`);
 console.log(`Serving project: ${root}`);
});
