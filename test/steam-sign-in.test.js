import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSteamSignIn} from '../lib/steam-sign-in.js';

const origin = 'http://127.0.0.1:3000';
const provider = 'https://steamcommunity.com/openid/login';
const namespace = 'http://specs.openid.net/auth/2.0';
const steamId = '76561198000000000';
const startTime = Date.parse('2026-10-21T12:00:00Z');
const signedFields = 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle';

function assertion(flow, overrides = {}) {
  const returnTo = new URL(flow.url).searchParams.get('openid.return_to');
  const url = new URL(returnTo);
  const identity = `https://steamcommunity.com/openid/id/${steamId}`;
  const fields = {
    ns: namespace,
    mode: 'id_res',
    op_endpoint: provider,
    claimed_id: identity,
    identity,
    return_to: returnTo,
    response_nonce: '2026-10-21T12:00:00Zfixture',
    assoc_handle: 'fixture-handle',
    signed: signedFields,
    sig: 'fixture-signature',
    ...overrides,
  };
  for (const [name, value] of Object.entries(fields)) url.searchParams.set(`openid.${name}`, value);
  return url;
}

test('Steam sign-in verifies directly with Steam and resolves a single-use flow on its original origin', async () => {
  let requests = 0;
  const signIn = createSteamSignIn({now: () => startTime, fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, provider);
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.body.get('openid.mode'), 'check_authentication');
    assert.equal(options.body.has('state'), false);
    assert.equal(options.headers, undefined);
    return new Response(`ns:${namespace}\nis_valid:true\n`);
  }});
  const flow = signIn.start(origin);
  const url = new URL(flow.url);
  assert.equal(url.origin + url.pathname, provider);
  assert.equal(url.searchParams.get('openid.mode'), 'checkid_setup');
  assert.equal(url.searchParams.get('openid.realm'), `${origin}/`);
  assert.equal(new URL(url.searchParams.get('openid.return_to')).searchParams.get('state'), flow.state);
  const callback = assertion(flow);
  await signIn.callback(callback, 'http://localhost:3000');
  assert.equal(requests, 0);
  await Promise.all([signIn.callback(callback, origin), signIn.callback(callback, origin)]);
  assert.equal(requests, 1);
  assert.match(signIn.finish(flow.state, 'http://localhost:3000').error, /expired/);
  assert.deepEqual(signIn.finish(flow.state, origin), {steamId});
  assert.match(signIn.finish(flow.state, origin).error, /expired/);

  const replay = signIn.start(origin);
  await signIn.callback(assertion(replay), origin);
  assert.match(signIn.finish(replay.state, origin).error, /could not be verified/);
  assert.equal(requests, 1);
});

test('Steam sign-in rejects mismatched return addresses, unsigned identities and unknown states locally', async () => {
  let requests = 0;
  const signIn = createSteamSignIn({now: () => startTime, fetchImpl: async () => { requests++; }});
  for (const overrides of [
    {return_to: `${origin}/unexpected`},
    {signed: signedFields.replace('claimed_id,', '')},
    {identity: 'https://example.invalid/identity'},
    {op_endpoint: 'https://example.invalid/openid'},
    {response_nonce: '2026-10-21T11:30:00Zold'},
  ]) {
    const flow = signIn.start(origin);
    await signIn.callback(assertion(flow, overrides), origin);
    assert.match(signIn.finish(flow.state, origin).error, /could not be verified/);
  }
  const flow = signIn.start(origin);
  const callback = assertion(flow);
  callback.searchParams.append('state', 'unexpected');
  await signIn.callback(callback, origin);
  assert.match(signIn.finish(flow.state, origin).error, /expired/);
  assert.equal(requests, 0);
});

test('Steam sign-in fails closed on invalid provider responses, cancellation and expiry', async () => {
  let time = startTime;
  const signIn = createSteamSignIn({now: () => time, fetchImpl: async () => new Response(`ns:${namespace}\nis_valid:false\n`)});
  const rejected = signIn.start(origin);
  await signIn.callback(assertion(rejected), origin);
  assert.match(signIn.finish(rejected.state, origin).error, /could not be verified/);
  const canceled = signIn.start(origin);
  await signIn.callback(assertion(canceled, {mode: 'cancel'}), origin);
  assert.match(signIn.finish(canceled.state, origin).error, /cancelled/);
  const expired = signIn.start(origin);
  time += 10 * 60_000;
  await signIn.callback(assertion(expired), origin);
  assert.match(signIn.finish(expired.state, origin).error, /expired/);
});
