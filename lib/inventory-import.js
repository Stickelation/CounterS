import {validateInventory} from './tradeup.js';

export function createWeaponSkinLookup(catalog) {
  const byName=new Map(catalog.map(s=>[s.name,s]));
  return name=>typeof name==='string'?byName.get(name.replace(/^(?:StatTrak™ |Souvenir )/,'').replace(/ \((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/,'')):undefined;
}

export function importSteamFloats(data,catalog,{publicInventory=false}={}) {
  if(data?.format!=='counters-steam-floats-v1'||!Array.isArray(data.inventory)||data.inventory.length>10000)throw Error('Invalid CounterS Steam float export.');
  const inventory=[],seen=new Set();
  const report={loaded:data.inventory.length,imported:0,unsupported:0,missingFloat:0,invalidFloat:0,scope:publicInventory?'public-primary-inventory':'loaded-primary-inventory-only'};
  const skinForName=createWeaponSkinLookup(catalog);
  for(const item of data.inventory) {
    const name=item?.market_hash_name;
    if(typeof name!=='string')throw Error('Export contains an invalid market name.');
    const s=skinForName(name);
    if(!s){report.unsupported++;continue;}
    if(typeof item.assetId!=='string'||!/^\d{1,30}$/.test(item.assetId))throw Error('Export contains an invalid Steam asset ID.');
    if(seen.has(item.assetId))throw Error('Export contains duplicate asset IDs.');seen.add(item.assetId);
    if(item.float===null||item.float===undefined){report.missingFloat++;continue;}
    if(typeof item.float!=='number'||!Number.isFinite(item.float)||item.float<s.min||item.float>s.max){report.invalidFloat++;continue;}
    inventory.push({assetId:item.assetId,skinId:s.id,float:item.float,stattrak:name.startsWith('StatTrak™ '),souvenir:name.startsWith('Souvenir '),floatSource:['csfloat-extension','steam-asset-property'].includes(item.floatSource)?item.floatSource:'imported'});
  }
  if(inventory.length>500)throw Error('More than 500 supported skins were found. Capture a smaller inventory selection.');
  if(!inventory.length){
    const hint=publicInventory?'Open your Steam inventory and use Send to CounterS.':'Capture more CS2 inventory pages with exact floats, then try again.';
    throw Error(`No supported skins with valid floats found (${report.unsupported} unsupported, ${report.missingFloat} missing floats, ${report.invalidFloat} invalid floats). ${hint}`);
  }
  report.imported=inventory.length;
  return {inventory:validateInventory(inventory,catalog),prices:{},report};
}
