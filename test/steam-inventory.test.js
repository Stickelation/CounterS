import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSteamInventoryProvider} from '../lib/steam-inventory.js';
import {importSteamFloats} from '../lib/inventory-import.js';

const steamId = '76561198000000000';
const catalog = [{id: 'revolver', name: 'R8 Revolver | Monarch', min: 0, max: 1, stattrak: true}];
const asset = (assetid, contextid = '2') => ({assetid, classid: '18', instanceid: '1', contextid, appid: 730});
const description = {classid: '18', instanceid: '1', market_hash_name: 'R8 Revolver | Monarch (Field-Tested)'};
const wear = (assetid, float_value) => ({assetid, contextid: '2', asset_properties: [{propertyid: 2, float_value}]});
const mixedNames = ['Kilowatt Case','Sticker | Example','Special Agent','★ Karambit | Doppler (Factory New)'];
const mixedDescriptions = mixedNames.map((market_hash_name,n)=>({market_hash_name,classid:String(90+n),instanceid:'1'}));
const mixedAssets = mixedDescriptions.map((d,n)=>({...asset(String(n+10)),classid:d.classid}));
const create = fetchImpl => createSteamInventoryProvider(catalog,{interval:0,fetchImpl});

test('public Steam inventory filters non-weapon items during pagination and keeps per-asset wear', async () => {
  const matchingId = '90071992547409999';
  const requests = [];
  const pages = [
    {success: 1, assets: [...mixedAssets,asset(matchingId),asset('2'),asset('3','16')], descriptions: [...mixedDescriptions,description],
      asset_properties: [wear(matchingId,'0.220103591680526733'),wear('3','0.25'),wear('13','0.01')], more_items: 1, last_assetid: '2'},
    {success: 1, assets: [asset('4'), asset('5')], asset_properties: [wear('4','0'),wear('5','0x0')], more_items: 0},
  ];
  const getInventory=create(async (address, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Cookie, undefined);
    requests.push(new URL(address));
    return Response.json(pages.shift());
  });
  const [raw,duplicate]=await Promise.all([getInventory(steamId),getInventory(steamId)]);
  assert.deepEqual(raw,duplicate);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].origin, 'https://steamcommunity.com');
  assert.equal(requests[0].pathname, `/inventory/${steamId}/730/2`);
  assert.equal(requests[0].searchParams.get('get_asset_properties'), '1');
  assert.equal(requests[1].searchParams.get('start_assetid'), '2');
  assert.deepEqual(raw.inventory.map(item=>item.assetId),[matchingId,'2','4','5']);
  const result = importSteamFloats(raw, catalog, {publicInventory: true});
  assert.deepEqual(result.inventory.map(({assetId, float, floatSource}) => ({assetId, float, floatSource})), [
    {assetId: matchingId, float: Number('0.220103591680526733'), floatSource: 'steam-asset-property'},
    {assetId: '4', float: 0, floatSource: 'steam-asset-property'},
  ]);
  assert.deepEqual(result.report, {loaded: 4, imported: 2, unsupported: 0, missingFloat: 1, invalidFloat: 1, scope: 'public-primary-inventory'});
});

test('public inventory returns actionable errors for denied access, rate limits, and incomplete pagination', async () => {
  for (const [status, message] of [[403, /private or unavailable/], [429, /rate limited/]]) {
    await assert.rejects(create(async () => new Response(null, {status}))(steamId), e => e.status === status && message.test(e.message));
  }
  const repeat = {success: 1, assets: [asset('2')], descriptions: [description], more_items: true, last_assetid: '2'};
  await assert.rejects(create(async () => Response.json(repeat))(steamId), /invalid inventory page cursor/);
  await assert.rejects(create(async () => {throw Error('unexpected network call');})('../other'), /17-digit/);
});

test('inventory paces pages and waits for Steam Retry-After before contacting it again', async () => {
  let time=0;
  const requests=[];
  const getInventory=createSteamInventoryProvider(catalog,{
    now:()=>time,sleep:async ms=>{time+=ms;},
    fetchImpl:async()=>{
      requests.push(time);
      if(requests.length===1)return Response.json({success:1,assets:mixedAssets,descriptions:mixedDescriptions,more_items:true,last_assetid:'13'});
      if(requests.length===2)return new Response(null,{status:429,headers:{'Retry-After':'180'}});
      return Response.json({success:1,assets:[asset('4')],descriptions:[description]});
    },
  });
  await assert.rejects(getInventory(steamId),e=>e.status===429&&e.retryAfter===180);
  time+=179_000;
  await assert.rejects(getInventory('76561198000000001'),e=>e.status===429&&e.retryAfter===1);
  assert.deepEqual(requests,[0,2000]);
  time+=1000;
  assert.equal((await getInventory(steamId)).inventory.length,1);
  assert.deepEqual(requests,[0,2000,182000]);
});
