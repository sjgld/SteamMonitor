const assert = require('node:assert/strict');
const { test } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { mkdtempSync, rmdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Store } = require('../build/main/store');
const { PlaytimeSampler, playtimeInterval, reviewPlaytime } = require('../build/main/playtime');

const id = '76561197960265729';
const other = '76561197960265730';
const friend = { id, name: '测试', presence: 'online', gameId: null, gameName: null };
const dota = { appId: '570', name: 'Dota 2', minutes: 100 };
const cs = { appId: '730', name: 'CS2', minutes: 100 };
const portal = { appId: '620', name: 'Portal 2', minutes: 100 };
const minute = 60_000;
const settle = () => new Promise(resolve => setImmediate(resolve));

test('attribution uses App IDs, keeps delayed gains separate, and marks gaps', () => {
  const store = new Store(':memory:');
  try {
    store.add([friend]);
    const observe = (at, game) => store.apply([id], new Map([[id, {
      ...friend, gameId: game?.appId ?? null, gameName: game?.name ?? null,
    }]]), at * minute, '');
    observe(5, dota);
    observe(12);
    observe(25, cs);
    store.apply([id], new Map(), 30 * minute, '断网');
    observe(38);
    observe(46);
    const since = 20 * minute;
    const previous = { review: { at: since, since: null, changes: [] }, games: [dota, cs, portal] };
    const at = 46 * minute;
    const games = [dota, cs, portal].map(game => ({ ...game, minutes: 110 }));
    const { sample, events } = reviewPlaytime(store, store.friends()[0], previous, games, at);
    assert.deepEqual(events.map(event => [event.appId, event.match, event.gap]), [
      ['570', 'recent', true], ['730', 'observed', true], ['620', 'unmatched', true],
    ]);
    store.recordPlaytime(id, sample, events);
    assert.deepEqual(store.playtimeEvents(id, since, at).map(event => event.minutes), [10, 10, 10]);
    assert.equal(store.playtimeEvents(id, at + 1, at + minute).length, 0);
  } finally { store.close(); }
});

test('automatic sampling requires consent, establishes a new baseline and resumes its persisted schedule', async () => {
  const store = new Store(':memory:');
  try {
    store.add([friend, { id: other, name: '未启用' }]);
    store.savePlaytime(id, { review: { at: minute, since: null, changes: [] }, games: [dota] });
    let now = 20 * minute;
    let total = 130;
    let allowed = true;
    const requests = [];
    const api = () => ({ ownedGames: async player => { requests.push(player); return [{ ...dota, minutes: total }]; } });
    const sampler = () => new PlaytimeSampler(store, api, () => allowed, () => {}, () => now);
    const first = sampler();
    assert.throws(() => first.configure(id, true, false), /授权/);
    first.configure(id, true, true);
    await settle();
    assert.deepEqual(requests, [id]);
    assert.equal(store.playtime(id).review.since, null);
    assert.equal(store.playtimeEvents(id, 0, now).length, 0);

    total = 148;
    now += playtimeInterval - 1;
    const restarted = sampler();
    await restarted.tick();
    assert.deepEqual(requests, [id]);
    now += 1;
    allowed = false;
    await restarted.tick();
    assert.deepEqual(requests, [id]);
    allowed = true;
    await restarted.tick();
    assert.deepEqual(requests, [id, id]);
    assert.deepEqual(store.playtimeEvents(id, 0, now).map(event => event.minutes), [18]);
    restarted.configure(id, false, false);
    now += playtimeInterval;
    await restarted.tick();
    assert.deepEqual(requests, [id, id]);
    assert.equal(store.playtimeEvents(id, 0, now).length, 1);
    store.clearPlaytime(id);
    assert.equal(store.playtime(id), null);
    assert.equal(store.playtimeEvents(id, 0, now).length, 0);
  } finally { store.close(); }
});

test('disabling a watch invalidates a response that is already in flight', async () => {
  const store = new Store(':memory:');
  try {
    store.add([friend]);
    let respond;
    let request;
    const api = () => ({ ownedGames: (_id, signal) => {
      request = signal;
      return new Promise(resolve => { respond = resolve; });
    } });
    const sampler = new PlaytimeSampler(store, api, () => true, () => {});
    sampler.configure(id, true, true);
    sampler.configure(id, false, false);
    assert.equal(request.aborted, true);
    respond([dota]);
    await settle();
    assert.equal(store.playtime(id), null);
  } finally { store.close(); }
});

test('restoring current and older backups restores records and leaves automatic sampling off', () => {
  const directory = mkdtempSync(join(tmpdir(), 'steammonitor-playtime-'));
  const file = join(directory, 'backup.sqlite');
  const store = new Store(':memory:');
  try {
    store.add([friend]);
    store.watchPlaytime(id, true, minute);
    const sample = { review: { at: 2 * minute, since: minute, changes: [] }, games: [dota] };
    store.recordPlaytime(id, sample, [{
      appId: '570', name: 'Dota 2', minutes: 10, from: minute, at: 2 * minute, match: 'unmatched', gap: false,
    }]);
    store.backup(file);
    store.clearPlaytime(id);
    store.restore(file);
    assert.equal(store.playtimeEvents(id, 0, 3 * minute).length, 1);
    assert.equal(store.watch(id), undefined);

    const legacy = new DatabaseSync(file);
    legacy.exec('DROP TABLE playtime_events; DROP TABLE playtime_watch;');
    legacy.close();
    store.watchPlaytime(id, true, minute);
    store.restore(file);
    assert.equal(store.playtimeEvents(id, 0, 3 * minute).length, 0);
    assert.equal(store.watch(id), undefined);
    assert.deepEqual(store.playtime(id), sample);
  } finally {
    store.close();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});
