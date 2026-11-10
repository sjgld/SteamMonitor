const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { consentText } = require('../build/shared/consent');
const { Store } = require('../build/main/data/store');
const { Discovery } = require('../build/main/collect/discovery');
const { PlaytimeSampler } = require('../build/main/collect/playtime');
const { collectionHandlers } = require('../build/main/ipc/collection');
const { consentHandlers } = require('../build/main/ipc/consents');

const id = '76561197960265729';
const other = '76561197960265730';
const friend = { id, name: '甲', presence: 'online', gameId: '570', gameName: 'Dota 2' };
const dota = { appId: '570', name: 'Dota 2', minutes: 100 };
const minute = 60_000;
const settle = () => new Promise(resolve => setImmediate(resolve));
const open = store => store.consents(id).filter(record => record.revokedAt === null).map(record => record.kind);

/** The parts of Runtime the consent and discovery handlers use, over a real store. */
function runtime(store, now = () => Date.now()) {
  const rt = {
    mode: 'live', paused: true, sleeping: false, live: store, vault: { value: 'key' }, changes: 0,
    quitting: () => false,
    changed: () => { rt.changes += 1; },
    requireLiveApi: () => ({ resolve: async input => input }),
  };
  rt.discovery = new Discovery(store, () => null, rt.changed);
  rt.playtime = new PlaytimeSampler(store, () => ({ ownedGames: async () => [dota] }), () => true, rt.changed, now);
  return rt;
}

test('adding with a confirmation logs its time and wording once per account and follows the account', () => {
  const store = new Store(':memory:');
  try {
    store.add([friend, { id: other, name: '乙' }], { text: consentText.track, at: 5 * minute });
    store.add([friend], { text: consentText.track, at: 9 * minute });
    const [record, ...rest] = store.consents(id);
    assert.equal(rest.length, 0);
    assert.deepEqual({ ...record }, { rowId: record.rowId, kind: 'track', playerId: id, text: consentText.track,
      grantedAt: 5 * minute, revokedAt: null });
    assert.equal(store.consentWithdrawn('track', id), false);

    assert.equal(store.revokeConsent('track', id, 7 * minute), 1);
    assert.equal(store.revokeConsent('track', id, 8 * minute), 0);
    assert.equal(store.consents(id)[0].revokedAt, 7 * minute);
    assert.equal(store.consentWithdrawn('track', id), true);
    assert.equal(store.consentWithdrawn('track', other), false);

    store.grantConsent('track', id, consentText.track, 10 * minute);
    assert.deepEqual(store.consents(id).map(item => [item.grantedAt, item.revokedAt]), [[10 * minute, null], [5 * minute, 7 * minute]]);
    assert.equal(store.consentWithdrawn('track', id), false);

    store.remove(id);
    assert.deepEqual(store.consents(id), []);
    assert.equal(store.consents(other).length, 1);
    assert.throws(() => store.grantConsent('discovery', other, 'x', minute));
    assert.throws(() => store.grantConsent('track', null, 'x', minute));
  } finally { store.close(); }
});

test('clearing playtime data closes the playtime consent, and a backup carries only per-friend records', () => {
  const directory = mkdtempSync(join(tmpdir(), 'steammonitor-consent-'));
  const file = join(directory, 'backup.sqlite');
  const store = new Store(':memory:');
  try {
    store.add([friend], { text: consentText.track, at: minute });
    store.grantConsent('playtime', id, consentText.playtime, 2 * minute);
    store.grantConsent('discovery', null, consentText.discovery, 3 * minute);
    store.backup(file);

    store.clearPlaytime(id, 4 * minute);
    assert.deepEqual(open(store), ['track']);
    store.revokeConsent('discovery', null, 5 * minute);
    store.grantConsent('discovery', null, consentText.discovery, 6 * minute);
    store.remove(id);

    store.restore(file);
    assert.deepEqual(open(store).sort(), ['playtime', 'track']);
    assert.deepEqual(store.consents(id).map(record => record.grantedAt), [2 * minute, minute]);
    // Discovery is a local setting: its log is neither replaced nor duplicated by the backup.
    assert.deepEqual(store.consents(null).map(record => [record.grantedAt, record.revokedAt]),
      [[6 * minute, null], [3 * minute, 5 * minute]]);

    store.clearHistory(undefined, 7 * minute);
    assert.deepEqual(open(store), ['track']);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('playtime sampling logs the confirmation and asks again after it is withdrawn', async () => {
  const store = new Store(':memory:');
  try {
    store.add([friend]);
    let now = 20 * minute;
    const rt = runtime(store, () => now);
    await assert.rejects(rt.playtime.sample(id, false), /授权/);
    assert.deepEqual(store.consents(id), []);
    await rt.playtime.sample(id, true);
    assert.deepEqual(open(store), ['playtime']);
    assert.equal(store.consents(id)[0].text, consentText.playtime);
    assert.equal(rt.playtime.status(id).needsConsent, false);

    now += 11 * minute;
    await rt.playtime.sample(id, false);
    rt.playtime.configure(id, true, true);
    assert.equal(store.consents(id).length, 1);

    const { revokeConsent } = consentHandlers(rt);
    revokeConsent(store.consents(id)[0].rowId, false);
    await settle();
    assert.equal(store.watch(id), undefined);
    assert.notEqual(store.playtime(id), null);
    assert.equal(rt.playtime.status(id).needsConsent, true);
    now += 11 * minute;
    await assert.rejects(rt.playtime.sample(id, false), /授权/);
    await rt.playtime.sample(id, true);
    assert.equal(rt.playtime.status(id).needsConsent, false);
    assert.equal(store.consents(id).length, 2);

    revokeConsent(store.consents(id)[0].rowId, true);
    assert.equal(store.playtime(id), null);
    assert.throws(() => revokeConsent(store.consents(id)[0].rowId, false), /已撤回/);
  } finally { store.close(); }
});

test('withdrawing the recording consent pauses the account and can clear its history', () => {
  const store = new Store(':memory:');
  try {
    store.add([friend, { ...friend, id: other, name: '乙' }], { text: consentText.track, at: minute });
    store.apply([id, other], new Map([[id, friend], [other, { ...friend, id: other }]]), 2 * minute, '');
    const rt = runtime(store);
    const handlers = consentHandlers(rt);
    assert.equal(handlers.consents(id).length, 1);
    assert.throws(() => handlers.consents('nope'), /SteamID64/);
    assert.throws(() => handlers.revokeConsent(999, false), /不存在/);
    assert.throws(() => handlers.revokeConsent(1, 'yes'), /无效/);

    handlers.revokeConsent(store.consents(id)[0].rowId, false);
    let [first, second] = store.friends();
    assert.deepEqual([first.paused, second.paused], [true, false]);
    assert.ok(store.activity({ playerId: id }).some(row => row.kind === 'baseline'));
    assert.equal(store.consentWithdrawn('track', id), true);
    assert.ok(rt.changes > 0);

    handlers.revokeConsent(store.consents(other)[0].rowId, true);
    [first, second] = store.friends();
    assert.equal(second.paused, true);
    assert.equal(store.activity({ playerId: other }).length, 0);
    assert.notEqual(store.activity({ playerId: id }).length, 0);

    rt.mode = 'demo';
    assert.deepEqual(handlers.consents(id), []);
    assert.throws(() => handlers.revokeConsent(1, false), /Steam 数据/);
  } finally { store.close(); }
});

test('friend discovery is only enabled with a confirmation, which follows the owner and the switch', async () => {
  const store = new Store(':memory:');
  try {
    const rt = runtime(store);
    const { configureDiscovery } = collectionHandlers(rt);
    const log = () => store.consents(null).map(record => record.revokedAt === null);
    await assert.rejects(configureDiscovery(id, true, false), /自己的账号/);
    assert.equal(rt.discovery.snapshot().enabled, false);
    await configureDiscovery(id, false, false);
    assert.deepEqual(log(), []);

    await configureDiscovery(id, true, true);
    assert.deepEqual(log(), [true]);
    assert.equal(store.consents(null)[0].text, consentText.discovery);
    await configureDiscovery(id, true, false);
    assert.deepEqual(log(), [true]);

    await assert.rejects(configureDiscovery(other, true, false), /自己的账号/);
    assert.equal(rt.discovery.snapshot().owner, id);
    await configureDiscovery(other, true, true);
    assert.deepEqual(log(), [true, false]);

    consentHandlers(rt).revokeConsent(store.consents(null)[0].rowId, false);
    assert.deepEqual([rt.discovery.snapshot().enabled, rt.discovery.snapshot().owner], [false, other]);
    assert.deepEqual(log(), [false, false]);

    await configureDiscovery(other, true, true);
    await configureDiscovery('', false, false);
    assert.deepEqual(log(), [false, false, false]);
  } finally { store.close(); }
});
