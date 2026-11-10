const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isApiKey } = require('../build/shared/domain');
const { isFirstRun } = require('../build/main/preferences');
const { SteamApi, verifyKey } = require('../build/main/steam/api');
const { collectionHandlers } = require('../build/main/ipc/collection');

const key = '0123456789abcdef0123456789ABCDEF';

test('API key format is 32 hexadecimal characters', () => {
  assert.equal(isApiKey(key), true);
  for (const value of ['', key.slice(1), key + '0', key.slice(1) + 'g', ' ' + key, key.slice(2) + '\n0']) {
    assert.equal(isApiKey(value), false, JSON.stringify(value));
  }
});

test('the setup guide opens by itself only for an installation with nothing configured', () => {
  assert.equal(isFirstRun({ onboarded: false, hasKey: false, friends: 0 }), true);
  assert.equal(isFirstRun({ onboarded: true, hasKey: false, friends: 0 }), false);
  assert.equal(isFirstRun({ onboarded: false, hasKey: true, friends: 0 }), false);
  assert.equal(isFirstRun({ onboarded: false, hasKey: false, friends: 3 }), false);
});

test('key verification makes one GetPlayerSummaries call and reports why Steam refused', async () => {
  const requests = [];
  const answer = response => new SteamApi(key, async (url, options) => {
    requests.push([String(url), options.headers['x-webapi-key']]);
    if (response instanceof Error) throw response;
    return response;
  });
  await verifyKey(answer(Response.json({ response: { players: [] } })));
  assert.equal(requests.length, 1);
  assert.match(requests[0][0], /\/ISteamUser\/GetPlayerSummaries\/v2\/\?steamids=\d{17}$/);
  assert.equal(requests[0][1], key);

  await assert.rejects(verifyKey(answer(new Response('', { status: 403 }))), /检查 API Key/);
  await assert.rejects(verifyKey(answer(new Response('', { status: 401 }))), /检查 API Key/);
  await assert.rejects(verifyKey(answer(new Response('', { status: 429, headers: { 'Retry-After': '30' } }))), /限流/);
  await assert.rejects(verifyKey(answer(new Response('', { status: 503 }))), /HTTP 503/);
  await assert.rejects(verifyKey(answer(new TypeError('offline'))), /无法连接 Steam/);
  await assert.rejects(verifyKey(answer(new Response('<html>'))), /无法读取/);
  await assert.rejects(verifyKey(answer(Response.json({}))), /未返回账号列表/);
});

test('connecting saves a key only after Steam accepts it, then switches to Steam data', async t => {
  let status = 403;
  const seen = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    seen.push(options.headers['x-webapi-key']);
    return status === 200 ? Response.json({ response: { players: [] } }) : new Response('', { status });
  });
  const log = [];
  const preferences = new Map();
  const rt = {
    mode: 'demo', vault: { value: '', write: async value => { log.push('write'); return value; } },
    quitting: () => false, changes: 0,
    changed: () => { rt.changes += 1; },
    adoptKey: value => { log.push('adopt'); rt.vault.value = value; },
    setMode: mode => { log.push(mode); rt.mode = mode; },
    live: { preference: name => preferences.get(name), setPreference: (name, value) => preferences.set(name, value) },
  };
  const { connectSteam, finishOnboarding } = collectionHandlers(rt);

  await assert.rejects(connectSteam(''), /请先填写/);
  await assert.rejects(connectSteam('not-a-key'), /32 位十六进制/);
  await assert.rejects(connectSteam(7), /格式无效/);
  assert.deepEqual(seen, []);
  await assert.rejects(connectSteam(key), /检查 API Key/);
  assert.deepEqual(log, []);
  assert.equal(rt.mode, 'demo');

  status = 200;
  await connectSteam(`  ${key} `);
  assert.deepEqual(log, ['write', 'adopt', 'live']);
  assert.deepEqual(seen, [key, key]);

  // An empty input re-checks the saved key without rewriting it; a refused replacement keeps the old one.
  rt.mode = 'demo';
  await connectSteam('');
  assert.deepEqual(log, ['write', 'adopt', 'live', 'live']);
  status = 403;
  const replacement = 'f'.repeat(32);
  await assert.rejects(connectSteam(replacement), /检查 API Key/);
  assert.equal(rt.vault.value, key);
  assert.equal(seen.at(-1), replacement);

  finishOnboarding();
  const first = preferences.get('onboarded');
  assert.ok(first);
  finishOnboarding();
  assert.equal(preferences.get('onboarded'), first);
  assert.equal(rt.changes, 2);
});
