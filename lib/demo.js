import {marketName} from './tradeup.js';

export function createDemo(catalog) {
 const collection=catalog.find(s=>s.rarity===2 && catalog.filter(o=>o.collection===s.collection && o.rarity===3).length>=2)?.collection;
 const skins=catalog.filter(s=>s.collection===collection&&s.rarity===2);
 const items=Array.from({length:12},(_,n)=>{const s=skins[n%skins.length];return {assetId:`demo-${n}`,skinId:s.id,float:Number((s.min+(s.max-s.min)*(.05+n*.013)).toFixed(6)),stattrak:false,souvenir:false};});
 const prices={}; const stamp=new Date().toISOString();
 for(const i of items){const s=catalog.find(s=>s.id===i.skinId);prices[marketName(s,i.float)]={price:1.2+skins.indexOf(s)*.35,currency:'USD',source:'demo',timestamp:stamp};}
 const outputs=catalog.filter(s=>s.collection===collection&&s.rarity===3);
 outputs.forEach((s,n)=>{for(const w of ['Factory New','Minimal Wear','Field-Tested','Well-Worn','Battle-Scarred'])prices[`${s.name} (${w})`]={price:[9,45,23,34][n%4],currency:'USD',source:'demo',timestamp:stamp};});
 return {inventory:items,prices};
}
