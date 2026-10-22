import {analyze,validateInventory,validateQuotes} from './tradeup.js';
import {importSteamFloats} from './inventory-import.js';
import {createDemo} from './demo.js';

// Uses the same validation and calculations as the server, without network calls.
export function createStandaloneApi(catalog) {
 return async function standaloneApi(path,options={}) {
  const url=new URL(path,'https://counters.invalid');
  const method=options.method||'GET';
  if(options.signal?.aborted)throw new DOMException('Request aborted.','AbortError');
  if(method==='GET'&&url.pathname==='/api/catalog')return catalog;
  if(method==='GET'&&url.pathname==='/api/demo')return createDemo(catalog);
  if(method==='GET'&&url.pathname==='/api/health')return {ok:true,catalog:catalog.length,mode:'standalone'};
  if(method==='GET'&&['/api/price','/api/inventory'].includes(url.pathname))throw Object.assign(new Error('Live Steam requests require the running CounterS app server. This preview supports imported inventory and prices.'),{status:503});
  if(method==='POST') {
   if(typeof options.body!=='string'||options.body.length>2_000_000)throw Error('Request must be JSON, at most 2 MB.');
   const data=JSON.parse(options.body);
   if(url.pathname==='/api/import-steam-floats')return importSteamFloats(data,catalog);
   if(url.pathname==='/api/analyze') {
    const items=validateInventory(data.inventory,catalog),quotes=validateQuotes(data.prices);
    if(!['normalized','legacy'].includes(data.floatRule))throw Error('Choose a supported float rule.');
    return analyze(items,catalog,quotes,{floatRule:data.floatRule,fee:0});
   }
  }
  throw Object.assign(new Error('Unsupported preview operation.'),{status:404});
 };
}
