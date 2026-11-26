// Runs only when the user invokes the exporter in their Steam inventory tab.
// Reads item data from the page without accessing Steam session data.
(function installCounterSExporter(destination) {
  if (location.origin !== 'https://steamcommunity.com' || !/^\/(?:id|profiles)\/[^/]+\/inventory\/?$/.test(location.pathname)) {
    alert('Open your Steam Community CS2 inventory, then run this bookmark.');
    return;
  }
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d{1,5})?\/$/.test(destination??'')) destination=null;
  if (document.getElementById('counters-float-export')) return;
  const captured=new Map();
  const wearTier=/ \((?:Factory New|Minimal Wear|Field-Tested|Well-Worn|Battle-Scarred)\)$/;
  let timer;
  const panel=document.createElement('section');
  panel.id='counters-float-export';
  Object.assign(panel.style,{position:'fixed',bottom:'20px',right:'20px',zIndex:'2147483647',background:'#171d16',color:'#e6e9ed',border:'1px solid #b6f36a',borderRadius:'8px',padding:'18px',width:'340px',font:'13px/1.6 system-ui',boxShadow:'0 8px 32px #0008'});
  const title=document.createElement('strong');title.textContent='CounterS · Capture inventory floats';
  const status=document.createElement('p');status.setAttribute('role','status');
  const help=document.createElement('p');help.textContent=destination?'Browse the CS2 inventory pages you want to capture, then send the items to CounterS.':'Browse your CS2 inventory pages, download the file, then import it in CounterS.';
  const send=document.createElement('button');send.textContent='Send to CounterS';send.hidden=!destination;
  const download=document.createElement('button');download.textContent='Download CounterS inventory';
  if(destination)download.style.marginLeft='8px';
  const close=document.createElement('button');close.textContent='Close';close.style.marginLeft='8px';
  panel.append(title,status,help,send,download,close);document.body.append(panel);
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
      if(inv.contextid!=null&&String(inv.contextid)!=='2')continue;
      for(const [key,asset] of Object.entries(inv.m_rgAssets||inv.rgInventory||{})) {
        if(asset.appid!=null&&Number(asset.appid)!==730)continue;
        if(asset.contextid!=null&&String(asset.contextid)!=='2')continue;
        const assetId=String(asset.assetid||asset.id||key);
        const description=asset.description||asset;
        const name=description.market_hash_name;
        if(!/^\d+$/.test(assetId)||typeof name!=='string'||name.startsWith('★')||!wearTier.test(name))continue;
        const inventoryProperties=inv.m_rgAssetProperties?.[assetId];
        const lists=[asset.asset_properties,inventoryProperties?.asset_properties??inventoryProperties];
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
    status.textContent=`${captured.size} weapon skins captured · ${ready} exact floats · ${captured.size-ready} without floats. Scope: loaded primary inventory only.`;
    send.disabled=ready===0;
    download.disabled=captured.size===0;
  }
  function getCapture(){
    capture();
    return {format:'counters-steam-floats-v1',exportedAt:new Date().toISOString(),scope:'loaded-primary-inventory-only',inventory:[...captured.values()]};
  }
  send.onclick=()=>{
    const data=getCapture();
    if(!data.inventory.some(item=>item.float!==null)){
      help.textContent='No exact floats are available yet. Browse your CS2 inventory and wait for item details to load.';
      return;
    }
    const payload=encodeURIComponent(JSON.stringify(data));
    if(payload.length>500_000){
      help.textContent='This capture is too large to send in one step. Download it or reopen the panel and capture fewer pages.';
      return;
    }
    const link=document.createElement('a');
    link.href=`${destination}#steam-capture=${payload}`;
    link.target='_blank';
    link.rel='noopener noreferrer';
    link.click();
  };
  download.onclick=()=>{
    const data=getCapture();
    if(!data.inventory.length)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='counters-steam-floats.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  close.onclick=()=>{clearInterval(timer);panel.remove();};
  capture();timer=setInterval(capture,1000);
})
