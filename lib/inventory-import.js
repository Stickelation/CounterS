import {validateInventory} from './tradeup.js';

export function importSteamFloats(data,catalog) {
  if(data?.format!=='counters-steam-floats-v1'||!Array.isArray(data.inventory)||data.inventory.length>10000)throw Error('Invalid CounterS Steam float export.');
  const inventory=[],seen=new Set();
  const report={loaded:data.inventory.length,imported:0,unsupported:0,missingFloat:0,invalidFloat:0,scope:'loaded-primary-inventory-only'};
  const byName=new Map(catalog.map(s=>[s.name,s]));
  for(const item of data.inventory) {
    if(!item||typeof item.assetId!=='string'||!/^\d{1,30}$/.test(item.assetId))throw Error('Export contains an invalid Steam asset ID.');
    if(seen.has(item.assetId))throw Error('Export contains duplicate asset IDs.');seen.add(item.assetId);
    if(typeof item.market_hash_name!=='string')throw Error('Export contains an invalid market name.');
    const name=item.market_hash_name;
    const base=name.replace(/^(?:StatTrak™ |Souvenir )/,'').replace(/ \((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/,'');
    const s=byName.get(base);
    if(!s){report.unsupported++;continue;}
    if(item.float===null||item.float===undefined){report.missingFloat++;continue;}
    if(typeof item.float!=='number'||!Number.isFinite(item.float)||item.float<s.min||item.float>s.max){report.invalidFloat++;continue;}
    inventory.push({assetId:item.assetId,skinId:s.id,float:item.float,stattrak:name.startsWith('StatTrak™ '),souvenir:name.startsWith('Souvenir '),floatSource:['csfloat-extension','steam-asset-property'].includes(item.floatSource)?item.floatSource:'imported'});
  }
  if(inventory.length>500)throw Error('More than 500 supported skins were captured. Export a smaller inventory selection.');
  if(!inventory.length)throw Error(`No supported skins with valid floats found (${report.unsupported} unsupported, ${report.missingFloat} missing floats, ${report.invalidFloat} invalid floats). Wait for CSFloat, browse inventory pages, and export again.`);
  report.imported=inventory.length;
  return {inventory:validateInventory(inventory,catalog),prices:{},report};
}
