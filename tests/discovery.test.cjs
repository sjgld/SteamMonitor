const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Discovery, compareFriendList } = require('../build/main/collect/discovery');
const { SteamRequestError } = require('../build/main/steam/api');
const { Store } = require('../build/main/data/store');

const owner = '76561197960265728';
const tracked = '76561197960265729';
const pending = '76561197960265730';
const added = '76561197960265731';

test('friend discovery keeps new untracked friends and excludes duplicates and withdrawn friendships', () => {
  const previous = { known: [tracked, pending], pending: [pending] };
  assert.deepEqual(compareFriendList(previous, [tracked, added, added], new Set([tracked])),
    { known: [tracked, added], pending: [added] });
  assert.deepEqual(compareFriendList({ known: [pending], pending: [] }, [pending, added], new Set([added])),
    { known: [pending, added], pending: [] });
});

test('opted-in discovery persists the baseline, retains the inbox on Steam errors, and never adds accounts', async () => {
  const store = new Store(':memory:');
  try {
    const ids = [tracked, pending];
    let reject = false;
    const fake = { friendIds: async id => {
      assert.equal(id, owner);
      if (reject) throw new SteamRequestError('好友名单不可读取。', 401);
      return ids;
    } };
    store.add([{ id: tracked, name: '已记录' }]);
    const discovery = new Discovery(store, () => fake, () => {});
    discovery.configure(owner, true);
    await discovery.check();
    assert.deepEqual(discovery.preview(), [{ id: pending, name: pending }]);
    assert.equal(store.friends().length, 1);
    reject = true;
    await discovery.check(true);
    assert.match(discovery.snapshot().error, /不可读取/);
    assert.equal(discovery.snapshot().pending, 1);
    discovery.dismiss();
    reject = false;
    ids.push(added);
    const restarted = new Discovery(store, () => fake, () => {});
    await restarted.check(true);
    assert.deepEqual(restarted.preview(), [{ id: added, name: added }]);
  } finally {
    store.close();
  }
});

test('discarded in-flight checks cannot replace a new owner and limit responses defer manual retry', async () => {
  const store = new Store(':memory:');
  try {
    let respond;
    let limit = false;
    const fake = { friendIds: () => {
      if (limit) throw new SteamRequestError('Steam 请求限流。', 429, 60_000);
      return new Promise(resolve => { respond = resolve; });
    } };
    const discovery = new Discovery(store, () => fake, () => {});
    discovery.configure(owner, true);
    const oldRequest = discovery.check();
    discovery.configure(added, true);
    respond([pending]);
    await oldRequest;
    assert.equal(discovery.snapshot().owner, added);
    assert.equal(discovery.snapshot().pending, 0);
    limit = true;
    await discovery.check();
    assert.match(discovery.snapshot().error, /限流/);
    await assert.rejects(discovery.check(true), /限流/);
  } finally {
    store.close();
  }
});
