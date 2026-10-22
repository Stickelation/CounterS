// Runs only when the user invokes the exporter in their Steam inventory tab.
// Reads local page data; makes no network requests and never reads credentials.
function installCounterSExporter() {
  if (location.hostname !== 'steamcommunity.com' || !/^\/(?:id|profiles)\/[^/]+\/inventory\/?/.test(location.pathname)) {
    alert('Open your Steam Community CS2 inventory, wait for CSFloat to show floats, then run this bookmark.');
    return;
  }
  if (document.getElementById('counters-float-export')) return;
  const captured=new Map();
  let timer;
  const panel=document.createElement('section');
  panel.id='counters-float-export';
  Object.assign(panel.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',background:'#171d16',color:'#e6e9ed',border:'1px solid #b6f36a',borderRadius:'8px',padding:'18px',width:'340px',font:'13px/1.6 system-ui',boxShadow:'0 8px 32px #0008'});
  const title=document.createElement('strong');title.textContent='CounterS · Capture inventory floats';
  const status=document.createElement('p');status.setAttribute('role','status');
  const help=document.createElement('p');help.textContent='1. Browse your CS2 inventory pages. 2. Download the file. 3. Import it in CounterS.';
  const download=document.createElement('button');download.textContent='Download CounterS inventory';
  const close=document.createElement('button');close.textContent='Close';close.style.marginLeft='8px';
  panel.append(title,status,help,download,close);document.body.append(panel);
  function floatValue(value) {
    if(typeof value!=='number' && typeof value!=='string')return null;
    if(typeof value==='string'&&!value.trim())return null;
    const number=Number(value);return Number.isFinite(number)&&number>=0&&number<=1?number:null;
  }
  function capture() {
    const active=typeof g_ActiveInventory!=='undefined'?g_ActiveInventory:null;
    if(!active){status.textContent='Select your CS2 inventory and wait for it to load.';return;}
    if(active.appid!=null&&Number(active.appid)!==730){status.textContent='Select Counter-Strike 2. Other games are not captured.';return;}
    // Trade-protected context 16 is intentionally excluded from available inputs.
    const inventories=active.m_rgChildInventories?[active.m_rgChildInventories['2']].filter(Boolean):[active];
    for(const inv of inventories) {
      for(const [key,asset] of Object.entries(inv.m_rgAssets||inv.rgInventory||{})) {
        if(asset.appid!=null&&Number(asset.appid)!==730)continue;
        if(asset.contextid!=null&&String(asset.contextid)!=='2')continue;
        const assetId=String(asset.assetid||asset.id||key);
        const description=asset.description||asset;
        const name=description.market_hash_name;
        if(!/^\d+$/.test(assetId)||typeof name!=='string')continue;
        const lists=[asset.asset_properties,inv.m_rgAssetProperties?.[assetId],description.asset_properties];
        let value=null;
        for(const list of lists){const property=Array.isArray(list)?list.find(p=>Number(p.propertyid)===2):null;value=floatValue(property?.float_value);if(value!==null)break;}
        const previous=captured.get(assetId);
        captured.set(assetId,{assetId,market_hash_name:name,float:value??previous?.float??null,floatSource:value!==null?'steam-asset-property':previous?.floatSource||null});
      }
    }
    // CSFloat 5.x uses Lit elements in the page's main world. itemInfo retains
    // the full precision value; the visible overlay is rounded and is not read.
    for(const element of document.querySelectorAll('csfloat-inventory-item-holder-metadata')) {
      if(element.isTradeProtected)continue;
      const assetId=String(element.assetId||element.parentElement?.id?.split('_')[2]||'');
      const value=floatValue(element.itemInfo?.floatvalue);
      if(value===null||!captured.has(assetId))continue;
      const previous=captured.get(assetId);
      captured.set(assetId,{...previous,float:value,floatSource:'csfloat-extension'});
    }
    const ready=[...captured.values()].filter(i=>i.float!==null).length;
    status.textContent=`${captured.size} loaded items captured · ${ready} exact floats · ${captured.size-ready} without floats (includes non-skins). Scope: loaded primary inventory only.`;
    download.disabled=captured.size===0;
  }
  download.onclick=()=>{
    capture();
    if(!captured.size)return;
    const inventory=[...captured.values()];
    const data={format:'counters-steam-floats-v1',exportedAt:new Date().toISOString(),scope:'loaded-primary-inventory-only',inventory};
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='counters-steam-floats.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  close.onclick=()=>{clearInterval(timer);panel.remove();};
  capture();timer=setInterval(capture,1000);
}
installCounterSExporter();
