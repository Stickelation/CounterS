import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import http from 'node:http';
import {Readable} from 'node:stream';
import {runInNewContext} from 'node:vm';

const origin = 'http://127.0.0.1:3000';
const provider = 'https://steamcommunity.com/openid/login';
const namespace = 'http://specs.openid.net/auth/2.0';
const steamId = '76561198000000000';
const fixtureAsset = {appid: 730, contextid: '2', assetid: '250', classid: '81', instanceid: '5'};
const fixtureName = 'AK-47 | Uncharted (Factory New)';
const badgeUrl = 'https://shared.akamai.steamstatic.com/community_assets/images/steamworks_docs/english/sits_large_noborder.png';
const [app, exporter] = await Promise.all(['app.js', 'steam-export.js'].map(name => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8')));

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
}

test('the server and browser import a signed-in inventory, then review a Steam-tab capture before replacing it', async t => {
  let handle;
  let privateInventory = false;
  t.mock.method(http, 'createServer', listener => {
    handle = listener;
    return {listen: (port, host) => assert.equal(host, '127.0.0.1')};
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === provider) {
      assert.equal(options.body.get('openid.mode'), 'check_authentication');
      return new Response(`ns:${namespace}\nis_valid:true\n`);
    }
    const target = new URL(url);
    assert.equal(target.origin, 'https://steamcommunity.com');
    assert.equal(target.pathname, `/inventory/${steamId}/730/2`);
    if (privateInventory) return new Response(null, {status: 403});
    return Response.json({
      success: 1,
      assets: [fixtureAsset],
      descriptions: [{classid: '81', instanceid: '5', market_hash_name: fixtureName}],
      asset_properties: [{assetid: '250', asset_properties: [{propertyid: 2, float_value: '0.032511178404092789'}]}],
    });
  });
  await import('../server.js');

  async function request(path, options = {}, headers = {}) {
    const url = new URL(path, origin);
    const method = options.method ?? 'GET';
    const req = Object.assign(Readable.from(options.body ? [options.body] : []), {
      method, url: url.pathname + url.search, socket: {localPort: 3000},
      headers: {host: url.host, ...(method === 'POST' ? {origin} : {}), ...headers},
    });
    let status;
    const outputHeaders = new Headers();
    const res = {
      setHeader(name, value) {outputHeaders.set(name, value);},
      writeHead(code, values) {status = code;Object.entries(values).forEach(([name, value]) => outputHeaders.set(name, value));},
      end(body) {this.response = new Response(body, {status, headers: outputHeaders});},
    };
    await handle(req, res);
    return res.response;
  }

  const rejected = await request('/api/steam/sign-in', {method: 'POST'}, {origin: 'https://example.invalid'});
  assert.equal(rejected.status, 403);
  assert.equal((await request('/api/health', {}, {host: 'example.invalid:3000'})).status, 403);
  assert.equal((await request('/api/demo')).status, 404);
  assert.equal((await request('/api/price?name=Kilowatt%20Case')).status,400);
  const page = await request('/');
  assert.equal(page.headers.get('cache-control'), 'no-cache');
  assert.equal((await request('/app.js')).headers.get('cache-control'), 'no-cache');
  assert.ok(page.headers.get('content-security-policy').includes(badgeUrl));
  assert.match(await page.text(), /aria-label="Sign in with Steam"/);
  const localStorage = storage();
  const workspace = () => JSON.parse(localStorage.getItem('counters-workspace'));
  const sessionStorage = storage();
  async function openApp(url, tabStorage = sessionStorage) {
    const elements = new Map();
    const location = new URL(url);
    let navigation;
    location.assign = target => {navigation = target;};
    function element(selector) {
      if (!elements.has(selector)) elements.set(selector, {value: selector === '#float-rule' ? 'normalized' : '', classList: {toggle() {}}});
      return elements.get(selector);
    }
    await runInNewContext(`(async()=>{\n${app}\n})()`, {
      document: {querySelector: element, querySelectorAll: () => []}, location,
      history: {replaceState(state, title, path) {location.href = new URL(path, location).href;}},
      URL, URLSearchParams, localStorage, sessionStorage: tabStorage, fetch: request,
    });
    return {element, location, get navigation() {return navigation;}};
  }
  const catalog = await (await request('/api/catalog')).json();
  const realAsset = {assetId: '249', skinId: catalog.find(s => s.name === 'AK-47 | Uncharted').id, float: .04};
  const demoAsset = {...realAsset, assetId: 'demo-0'};
  const realPrice = {price: 1, source: 'steam-lowest-listing', currency: 'USD', timestamp: '2026-10-21T12:00:00Z'};
  const prices = {[fixtureName]: realPrice, 'Old sample': {...realPrice, source: 'demo'}};
  localStorage.setItem('counters-workspace', JSON.stringify({inventory: [demoAsset, realAsset], prices}));
  await openApp(origin);
  assert.deepEqual(workspace(), {inventory: [realAsset], prices: {[fixtureName]: realPrice}});

  localStorage.setItem('counters-workspace', JSON.stringify({inventory: [demoAsset], prices}));
  const firstApp = await openApp(origin);
  assert.deepEqual(workspace(), {inventory: [], prices: {}});
  assert.match(firstApp.element('#inventory-grid').innerHTML, /No inventory loaded/);
  assert.equal(firstApp.element('#steam-badge').src, badgeUrl);
  firstApp.element('#steam-badge').onload();
  assert.equal(firstApp.element('#steam-badge').hidden, false);
  await firstApp.element('#steam-sign-in').onclick();
  const outbound = new URL(firstApp.navigation);
  const callback = new URL(outbound.searchParams.get('openid.return_to'));
  const identity = `https://steamcommunity.com/openid/id/${steamId}`;
  for (const [key, value] of Object.entries({
    ns: namespace, mode: 'id_res', op_endpoint: provider, claimed_id: identity, identity,
    return_to: callback.href, response_nonce: `${new Date().toISOString().slice(0, 19)}Zfixture`,
    assoc_handle: 'fixture-handle', signed: 'op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle', sig: 'fixture-signature',
  })) callback.searchParams.set(`openid.${key}`, value);
  const redirect = await request(callback.href);
  assert.equal(redirect.status, 303);
  assert.equal(redirect.headers.get('location'), '/?steam-return=1');
  assert.equal(redirect.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(redirect.headers.has('set-cookie'), false);
  const linkedApp = await openApp(origin + redirect.headers.get('location'));
  assert.equal(linkedApp.location.href, `${origin}/`);
  assert.equal(linkedApp.element('#steam-reload').hidden, false);
  assert.match(linkedApp.element('#notice').textContent, /Imported 1 weapon skin\./);
  assert.equal(workspace().inventory[0].float, Number('0.032511178404092789'));
  privateInventory = true;
  await linkedApp.element('#steam-reload').onclick();
  assert.match(linkedApp.element('#notice').textContent, /private or unavailable/);
  assert.equal(linkedApp.element('#csfloat-setup').open, true);
  assert.equal(workspace().inventory[0].assetId, '250');

  let sendButton;
  let handoff;
  const pageAsset = {...fixtureAsset, assetid: '251', description: {market_hash_name: fixtureName}, asset_properties: [{propertyid: 2, float_value: '0.02115572988986969'}]};
  runInNewContext(`${exporter.trim()}(${JSON.stringify(origin + '/')});`, {
    location: new URL(`https://steamcommunity.com/profiles/${steamId}/inventory/`),
    g_ActiveInventory: {appid: 730, contextid: '2', m_rgAssets: {'251': pageAsset,'252': {...pageAsset,assetid:'252',description:{market_hash_name:'Kilowatt Case'}}}},
    document: {
      getElementById: () => null, querySelectorAll: () => [], body: {append() {}},
      createElement(tag) {
        return {
          style: {}, setAttribute() {}, remove() {},
          append(...nodes) {sendButton = nodes.find(node => node.textContent === 'Send to CounterS');},
          click() {if (tag === 'a') handoff = this;},
        };
      },
    },
    setInterval() {}, clearInterval() {},
  });
  assert.equal(sendButton.disabled, false);
  sendButton.onclick();
  assert.equal(handoff.rel, 'noopener noreferrer');
  assert.equal(new URL(handoff.href).origin, origin);
  const capture=JSON.parse(decodeURIComponent(new URL(handoff.href).hash.slice('#steam-capture='.length)));
  assert.deepEqual(capture.inventory.map(item=>item.assetId),['251']);
  const capturedApp = await openApp(handoff.href, storage());
  assert.equal(capturedApp.location.hash, '');
  assert.equal(capturedApp.element('#steam-review').hidden, false);
  assert.equal(workspace().inventory[0].assetId, '250');
  await capturedApp.element('#steam-accept').onclick();
  assert.equal(workspace().inventory[0].assetId, '251');
  assert.equal(workspace().inventory[0].float, Number('0.02115572988986969'));
  assert.equal(capturedApp.element('#steam-review').hidden, true);
});
