const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Store, toCsv } = require('../build/main/store');
const { normalizeSummary, parseProfile, SteamApi } = require('../build/main/steam');
const { Poller } = require('../build/main/poller');

const id = '76561197960265729';
const player = { id, name: '测试' };
const online = { ...player, presence: 'online', gameId: null, gameName: null };
const dota = { ...online, gameId: '570', gameName: 'Dota 2' };

test('private and missing presence remain unknown', () => {
  assert.equal(normalizeSummary({ steamid: id, personastate: 0, communityvisibilitystate: 1 }).presence, 'unknown');
  assert.equal(normalizeSummary({ steamid: id, personastate: 0, communityvisibilitystate: 3 }).presence, 'offline');
  assert.equal(normalizeSummary({ steamid: id }).presence, 'unknown');
  assert.equal(normalizeSummary({ steamid: id, gameextrainfo: 'Local Game' }).gameName, 'Local Game');
  assert.deepEqual(parseProfile(`https://steamcommunity.com/profiles/${id}/`), { id });
  assert.deepEqual(parseProfile('steamcommunity.com/id/test'), { vanity: 'test' });
  assert.throws(() => parseProfile('https://steamcommunity.com.example.org/id/test'));
});

test('one change for a combined status and game change, with a new baseline after missing data', () => {
  const store = new Store(':memory:');
  try {
    store.add([player]);
    store.apply([id], new Map([[id, { ...online, presence: 'offline' }]]), 1, '');
    store.apply([id], new Map([[id, dota]]), 2, '');
    store.apply([id], new Map([[id, dota]]), 3, '');
    assert.deepEqual(store.activity({}).map(row => row.kind), ['change', 'baseline']);
    assert.equal(store.friends()[0].observedAt, 3);

    store.apply([id], new Map(), 4, '缺少资料');
    store.apply([id], new Map(), 5, '缺少资料');
    assert.equal(store.friends()[0].presence, 'online');
    assert.equal(store.friends()[0].gapSince, 4);
    store.apply([id], new Map([[id, online]]), 6, '');
    const [recovery, gap, change] = store.activity({});
    assert.equal(recovery.kind, 'baseline');
    assert.equal(gap.kind, 'gap');
    assert.equal(gap.endedAt, 6);
    assert.equal(change.previousPresence, 'offline');
    assert.equal(store.activity({ from: 5, until: 6 })[0].kind, 'gap');
    assert.equal(store.activity({ game: 'DOTA 2' }).length, 1);
  } finally {
    store.close();
  }
});

test('CSV protects spreadsheet cells and removing a friend clears its history', () => {
  const store = new Store(':memory:');
  try {
    store.add([{ ...player, name: '=2+2' }]);
    store.apply([id], new Map([[id, { ...online, name: '=2+2' }]]), 1, '');
    const csv = toCsv(store.activity({ playerId: id }));
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.match(csv, /"'=2\+2"/);
    store.remove(id);
    assert.deepEqual(store.activity({ playerId: id }), []);
  } finally {
    store.close();
  }
});

test('poller splits 101 accounts into two requests and keeps partial data', async () => {
  const store = new Store(':memory:');
  const ids = Array.from({ length: 101 }, (_, index) => String(BigInt(id) + BigInt(index)));
  store.add(ids.map(steamId => ({ id: steamId, name: steamId })));
  const batchSizes = [];
  const api = new SteamApi('test-key', async (url, options) => {
    assert.equal(new URL(url).searchParams.has('key'), false);
    assert.equal(options.headers['x-webapi-key'], 'test-key');
    const requested = new URL(url).searchParams.get('steamids').split(',');
    batchSizes.push(requested.length);
    const players = requested.length === 1 ? [] : requested.map(steamid => ({
      steamid, communityvisibilitystate: 3, personastate: 1,
    }));
    return Response.json({ response: { players } });
  });
  let finish;
  const complete = new Promise(resolve => { finish = resolve; });
  const poller = new Poller(store, () => api, () => {
    if (poller.state.status === 'partial' && poller.state.nextCheckAt) finish();
  });
  try {
    poller.start();
    await complete;
    assert.deepEqual(batchSizes, [100, 1]);
    assert.equal(store.friends().filter(friend => friend.observedAt !== null).length, 100);
    assert.notEqual(store.friends().find(friend => friend.id === ids[100]).gapSince, null);
  } finally {
    poller.stop();
    store.close();
  }
});

test('late responses after stopping cannot write status', async () => {
  const store = new Store(':memory:');
  store.add([player]);
  let respond;
  const api = new SteamApi('test-key', () => new Promise(resolve => { respond = resolve; }));
  const poller = new Poller(store, () => api, () => {});
  try {
    poller.start();
    poller.stop();
    respond(Response.json({ response: { players: [{ steamid: id, personastate: 1 }] } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(store.activity({}), []);
  } finally {
    store.close();
  }
});
