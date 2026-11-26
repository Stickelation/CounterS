import {randomUUID} from 'node:crypto';

const provider = 'https://steamcommunity.com/openid/login';
const namespace = 'http://specs.openid.net/auth/2.0';
const selectIdentity = `${namespace}/identifier_select`;
const requiredSigned = ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle'];
const assertionFields = ['ns', 'mode', ...requiredSigned, 'signed', 'sig', 'invalidate_handle'];
const flowLifetime = 10 * 60_000;
const nonceLifetime = 5 * 60_000;

export function createSteamSignIn({fetchImpl = fetch, now = Date.now} = {}) {
  const flows = new Map();
  const nonces = new Map();

  function start(origin) {
    for (const [state, flow] of flows) {
      if (flow.expires <= now()) flows.delete(state);
    }
    if (flows.size >= 256) throw Object.assign(Error('Too many pending Steam sign-ins. Try again later.'), {status: 429});
    const state = randomUUID();
    const returnTo = new URL('/api/steam/callback', origin);
    returnTo.searchParams.set('state', state);
    flows.set(state, {origin, returnTo: returnTo.href, expires: now() + flowLifetime});
    const url = new URL(provider);
    url.search = new URLSearchParams({
      'openid.ns': namespace,
      'openid.mode': 'checkid_setup',
      'openid.claimed_id': selectIdentity,
      'openid.identity': selectIdentity,
      'openid.return_to': returnTo.href,
      'openid.realm': `${origin}/`,
    });
    return {state, url: url.href};
  }

  async function callback(url, origin) {
    const params = url.searchParams;
    const state = params.get('state');
    const flow = flows.get(state);
    if (params.getAll('state').length !== 1 || !flow || flow.origin !== origin || flow.expires <= now() || flow.returned) return;
    flow.returned = true;
    const result = await verify(params, flow.returnTo);
    flow.result = result;
  }

  async function verify(params, returnTo) {
    const field = name => params.get(`openid.${name}`);
    const invalid = {error: 'Steam sign-in could not be verified. Try signing in again.'};
    if (assertionFields.some(name => params.getAll(`openid.${name}`).length > 1)) return invalid;
    if (field('mode') === 'cancel') return {error: 'Steam sign-in was cancelled.'};
    const identity = field('claimed_id');
    const steamId = /^https?:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(identity ?? '')?.[1];
    const signed = new Set(field('signed')?.split(','));
    if (field('ns') !== namespace || field('mode') !== 'id_res' || field('op_endpoint') !== provider ||
        field('return_to') !== returnTo || !steamId || field('identity') !== identity || !field('sig') ||
        !requiredSigned.every(name => signed.has(name) && field(name))) return invalid;

    const nonce = field('response_nonce');
    const timestamp = Date.parse(nonce.slice(0, 20));
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ[!-~]{0,235}$/.test(nonce) ||
        !Number.isFinite(timestamp) || Math.abs(now() - timestamp) >= nonceLifetime) return invalid;
    for (const [key, expires] of nonces) {
      if (expires <= now()) nonces.delete(key);
    }
    if (nonces.has(nonce)) return invalid;
    nonces.set(nonce, timestamp + nonceLifetime);

    const body = new URLSearchParams();
    for (const name of assertionFields) {
      const value = field(name);
      if (value !== null) body.set(`openid.${name}`, value);
    }
    body.set('openid.mode', 'check_authentication');
    try {
      const response = await fetchImpl(provider, {method: 'POST', body, redirect: 'error', signal: AbortSignal.timeout(15_000)});
      if (!response.ok) return invalid;
      const lines = (await response.text()).split(/\r?\n/);
      const namespaces = lines.filter(line => line.startsWith('ns:'));
      const assertions = lines.filter(line => line.startsWith('is_valid:'));
      if (namespaces.length !== 1 || namespaces[0] !== `ns:${namespace}` ||
          assertions.length !== 1 || assertions[0] !== 'is_valid:true') return invalid;
    } catch {
      return {error: 'CounterS could not reach Steam to verify sign-in. Try again.'};
    }
    return {steamId};
  }

  function finish(state, origin) {
    const flow = flows.get(state);
    if (!flow || flow.origin !== origin || flow.expires <= now() || !flow.result) {
      return {error: 'Steam sign-in expired or started in another tab. Try signing in again.'};
    }
    flows.delete(state);
    return flow.result;
  }

  return {start, callback, finish};
}
