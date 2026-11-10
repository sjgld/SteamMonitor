const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmdirSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { activityTracks, buildReport, calendarDayRange, comparePlaytime, unchangedRecoveries } = require('../build/main/data/analytics');
const { displayBands, gapDisplay, hideGapEvent } = require('../build/shared/gap-display');
const { defaultNotices, inQuietHours, Notices } = require('../build/main/notify/rules');
const { Store } = require('../build/main/data/store');
const { safeAvatar, SteamApi } = require('../build/main/steam/api');

const id = '76561197960265729';
const other = '76561197960265730';
const dota = { id, name: '甲', presence: 'online', gameId: '570', gameName: 'Dota 2' };
const noGame = { ...dota, gameId: null, gameName: null };
const second = { ...dota, id: other, name: '乙' };
const minute = 60_000;

test('daily review clips at local midnight and keeps gaps out of game sessions', () => {
  const now = new Date(2026, 10, 9, 12).getTime();
  const { start, end } = calendarDayRange('2026-11-08', now);
  assert.equal(start, new Date(2026, 10, 8).getTime());
  assert.equal(end, new Date(2026, 10, 9).getTime());
  assert.equal(calendarDayRange('2026-11-09', now).end, now);
  assert.throws(() => calendarDayRange('2026-02-30', now), /日期无效/);
  assert.throws(() => calendarDayRange('2026-11-10', now), /今天或更早/);

  const store = new Store(':memory:');
  try {
    store.add([dota]);
    const observe = (offset, value) => store.apply([id], new Map([[id, value]]), start + offset * minute, '');
    observe(-10, dota);
    observe(5, { ...dota, presence: 'away' });
    store.apply([id], new Map(), start + 15 * minute, '断网');
    observe(25, dota);
    observe(35, noGame);
    const report = buildReport(store.historyRange(start, end, id), store.friends(), start, end, true, true);
    assert.equal(report.games[0].minutes, 25);
    assert.deepEqual(report.sessions.map(session => [(session.start - start) / minute, (session.end - start) / minute]), [
      [25, 35], [0, 15],
    ]);
  } finally {
    store.close();
  }
});

test('horizontal history separates gaps and overlap uses the intersection', () => {
  const store = new Store(':memory:');
  try {
    store.add([dota, second]);
    store.apply([id], new Map([[id, dota]]), 1 * minute, '');
    store.apply([other], new Map([[other, second]]), 2 * minute, '');
    store.apply([id], new Map(), 3 * minute, '网络失败');
    store.apply([id], new Map([[id, noGame]]), 5 * minute, '');
    store.apply([id, other], new Map([[id, noGame], [other, second]]), 6 * minute, '');
    const from = 2 * minute;
    const until = 7 * minute;
    const rows = store.historyRange(from, until);
    const friends = store.friends();
    const report = buildReport(rows, friends, from, until, false);
    assert.deepEqual(report.games, [{ id: '570', name: 'Dota 2', minutes: 5, sharedMinutes: 1 }]);
    assert.deepEqual(report.shared, [{ game: 'Dota 2', start: 2 * minute, end: 3 * minute, names: ['甲', '乙'] }]);
    const detail = buildReport(rows, friends.filter(friend => friend.id === id), from, until, true);
    assert.deepEqual(detail.spans.map(({ start, end, state, gameId }) => [start / minute, end / minute, state, gameId]),
      [[2, 3, 'online', '570'], [3, 5, 'gap', null], [5, 6, 'online', null], [6, 7, 'empty', null]]);
  } finally {
    store.close();
  }
});

test('activity lanes link to records before the window and keep growth separate from gaps', () => {
  const store = new Store(':memory:');
  try {
    store.add([dota, second]);
    store.apply([id], new Map([[id, dota]]), minute, '');
    store.apply([id], new Map(), 3 * minute, '断网');
    store.apply([id], new Map([[id, noGame]]), 5 * minute, '');
    const window = { from: 2 * minute, until: 6 * minute };
    const rows = store.historyRange(window.from, window.until);
    const track = activityTracks(rows, store.friends(), window).find(item => item.playerId === id);
    assert.deepEqual(track.spans.map(span => [span.start / minute, span.end / minute, span.state, span.sourceId]), [
      [2, 3, 'online', rows[0].rowId],
      [3, 5, 'gap', rows[1].rowId],
      [5, 6, 'empty', undefined],
    ]);
    assert.ok(!store.activity(window).some(row => row.rowId === rows[0].rowId));
    const at = 4 * minute;
    const sample = { review: { at, since: minute, changes: [] }, games: [] };
    store.recordPlaytime(id, sample, [{ appId: '570', name: 'Dota 2', minutes: 10, from: minute, at, match: 'unmatched', gap: true }]);
    assert.equal(store.playtimeRange({ ...window, game: '570' })[0].playerId, id);
    assert.deepEqual(store.playtimeRange({ ...window, until: at }), []);
    assert.deepEqual(store.playtimeRange({ ...window, playerId: other }), []);
  } finally {
    store.close();
  }
});

test('short-gap display respects actual duration, keeps changes, and leaves observed totals intact', () => {
  const store = new Store(':memory:');
  try {
    store.add([dota]);
    const observe = (offset, value) => store.apply([id], value ? new Map([[id, value]]) : new Map(), offset * minute, '短断网');
    observe(1, dota);
    observe(3);
    observe(6, dota);
    observe(9);
    observe(11, noGame);
    observe(12);
    const rows = store.historyRange(minute, 14 * minute);
    const tracks = activityTracks(rows, store.friends(), { from: minute, until: 14 * minute });
    const spans = tracks[0].spans;
    assert.deepEqual(spans.map((span, index) => gapDisplay(spans, index, 3)), ['show', 'bridge', 'show', 'hide', 'show', 'show']);
    assert.equal(gapDisplay(spans, 1, 2), 'show');
    assert.equal(gapDisplay(spans, 1, 0), 'show');
    const bands = displayBands(spans, 3);
    assert.deepEqual(bands.map(band => [band.state, band.start / minute, band.end / minute, band.elapsed / minute, band.hidden / minute]), [
      ['online', 1, 9, 5, 3], ['online', 11, 12, 1, 0], ['gap', 12, 14, 2, 0],
    ]);
    assert.deepEqual(bands[0].parts.map(part => part.sourceId), [rows[0].rowId, rows[2].rowId]);
    assert.equal(displayBands(spans, 0).length, spans.length);
    const clipped = activityTracks(rows, store.friends(), { from: 5 * minute, until: 14 * minute })[0].spans;
    assert.equal(clipped[0].end - clipped[0].start, minute);
    assert.equal(gapDisplay(clipped, 0, 2), 'show');
    const recovery = unchangedRecoveries(rows);
    assert.deepEqual(rows.filter(row => hideGapEvent(row, recovery, 3)).map(row => row.at / minute), [3, 6, 9]);
    const report = buildReport(rows, store.friends(), minute, 14 * minute, true);
    assert.equal(report.games[0].minutes, 5);
  } finally {
    store.close();
  }
});

test('game sessions merge across short or deleted gaps without increasing coverage or shared time', () => {
  const directory = mkdtempSync(join(tmpdir(), 'steam-gap-test-'));
  const file = join(directory, 'backup.sqlite');
  const store = new Store(':memory:');
  const restored = new Store(':memory:');
  try {
    store.add([dota, second]);
    store.apply([id, other], new Map([[id, dota], [other, second]]), minute, '');
    store.apply([id], new Map(), 3 * minute, '断网');
    store.apply([id], new Map([[id, { ...dota, presence: 'away' }]]), 5 * minute, '');
    store.apply([id, other], new Map([[id, noGame], [other, second]]), 9 * minute, '');
    store.apply([id], new Map(), 10 * minute, '仍在中断');
    const report = (source, threshold) => buildReport(source.historyRange(minute, 12 * minute), source.friends(),
      minute, 12 * minute, false, true, threshold);
    const sessions = value => value.sessions.filter(session => session.playerId === id);
    assert.deepEqual(sessions(report(store, 0)).map(row => row.observedMs / minute), [4, 2]);
    const combined = report(store, 3);
    assert.deepEqual(sessions(combined).map(row => [row.start / minute, row.end / minute, row.observedMs / minute]), [[1, 9, 6]]);
    assert.equal(combined.games[0].sharedMinutes, 6);
    const gaps = store.activity({ playerId: id }).filter(row => row.kind === 'gap');
    const [open, closed] = gaps;
    assert.equal(store.gapBatch({ ...open, endedAt: 12 * minute }), null);
    assert.equal(store.removeGap(id, open.rowId, open.at, 12 * minute), false);
    assert.equal(store.removeGap(other, closed.rowId, closed.at, closed.endedAt), false);
    assert.equal(store.removeGap(id, closed.rowId, closed.at, closed.endedAt), true);
    assert.equal(store.removeGap(id, closed.rowId, closed.at, closed.endedAt), false);
    assert.equal(store.activity({ playerId: id }).some(row => row.rowId === closed.rowId), false);
    assert.deepEqual(sessions(report(store, 0)), sessions(combined));
    assert.deepEqual(report(store, 0).games, combined.games);
    assert.equal(report(store, 0).coverage, combined.coverage);
    store.backup(file);
    restored.restore(file);
    assert.deepEqual(sessions(report(restored, 0)), sessions(combined));
    assert.ok(!restored.activity({ playerId: id }).some(row => row.rowId === closed.rowId));
  } finally {
    restored.close();
    store.close();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test('gap batch previews all friends, requires explicit nearby selection and rolls back stale targets', () => {
  const store = new Store(':memory:');
  const friends = Array.from({ length: 5 }, (_, i) => ({ ...dota, id: String(BigInt(id) + BigInt(i)), name: String(i) }));
  try {
    store.add(friends);
    const ranges = [
      [10_000, 30_000, '断网'], [10_000, 30_000, '断网'], [15_000, 35_000, '断网'],
      [10_000, 30_000, '暂停'], [21_000, 30_000, '断网'],
    ];
    for (const [index, friend] of friends.entries()) {
      const [start, end, reason] = ranges[index];
      store.apply([friend.id], new Map([[friend.id, friend]]), 1_000, '');
      store.apply([friend.id], new Map(), start, reason);
      store.apply([friend.id], new Map([[friend.id, friend]]), end, '');
    }
    const anchor = store.activity({ playerId: friends[0].id }).find(row => row.kind === 'gap');
    const preview = store.gapBatch(anchor);
    assert.deepEqual(preview.exact.map(row => row.name), ['0', '1']);
    assert.deepEqual(preview.nearby.map(row => row.name), ['2']);
    assert.throws(() => store.removeGapBatch(anchor, [anchor], 'batch'), /重新打开预览/);
    assert.throws(() => store.removeGapBatch(anchor, [...preview.exact, { ...preview.nearby[0], endedAt: 36_000 }], 'batch'), /重新打开预览/);
    assert.equal(store.activity({}).filter(row => row.kind === 'gap').length, 5);
    assert.equal(store.removeGapBatch(anchor, preview.exact, 'batch'), 2);
    assert.deepEqual(store.activity({}).filter(row => row.kind === 'gap').map(row => row.name).sort(), ['2', '3', '4']);
  } finally {
    store.close();
  }
});

test('a deleted gap joins different statuses at recovery and keeps the observed durations', () => {
  const store = new Store(':memory:');
  try {
    store.add([dota]);
    const offline = { ...noGame, presence: 'offline' };
    const observe = (offset, value) => store.apply([id], value ? new Map([[id, value]]) : new Map(), offset * minute, '断网');
    observe(1, dota);
    observe(3);
    observe(8, offline);
    observe(10, offline);
    const gap = store.activity({ playerId: id }).find(row => row.kind === 'gap');
    assert.equal(store.removeGap(id, gap.rowId, gap.at, gap.endedAt), true);
    const bands = from => {
      const until = 10 * minute;
      return displayBands(activityTracks(store.historyRange(from, until), store.friends(), { from, until })[0].spans, 0);
    };
    const [before, after] = bands(minute);
    assert.equal(before.paintEnd, after.start);
    assert.deepEqual([before.end, before.elapsed, after.elapsed], [3 * minute, 2 * minute, 2 * minute]);
    const [clipped] = bands(5 * minute);
    assert.equal(clipped.paintStart, 5 * minute);
    assert.equal(clipped.elapsed, 2 * minute);
  } finally {
    store.close();
  }
});

test('retention clips the open gap and SQLite backup restores history without replacing settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'steammonitor-test-'));
  const file = join(directory, 'backup.sqlite');
  const store = new Store(':memory:');
  try {
    store.add([dota, second]);
    store.apply([id, other], new Map([[id, dota], [other, second]]), minute, '');
    store.apply([id], new Map(), 2 * minute, '缺口');
    store.favoriteGame('id:570', true);
    store.prune(3 * minute);
    assert.deepEqual(store.activity({ playerId: id }).map(row => [row.kind, row.at]), [['gap', 3 * minute]]);
    assert.equal(store.friends().find(friend => friend.id === id).gapSince, 3 * minute);
    store.backup(file);
    store.setPreference('mode', 'demo');
    store.clearHistory(id);
    assert.equal(store.activity({ playerId: id }).length, 0);
    assert.equal(store.activity({ playerId: other }).length, 1);
    store.remove(id);
    store.restore(file);
    assert.equal(store.preference('mode'), 'demo');
    assert.deepEqual(store.favoriteGames(), ['id:570']);
    assert.equal(store.activity({ playerId: id })[0].kind, 'gap');
  } finally {
    store.close();
    rmSync(file, { force: true });
    rmdirSync(directory);
  }
});

test('playtime comparison reports only positive differences with baselines', () => {
  const game = { appId: '570', name: 'Dota 2', minutes: 100 };
  const initial = comparePlaytime(null, [game], new Set(), 1);
  const next = comparePlaytime(initial, [{ ...game, minutes: 109 }, { appId: '730', name: 'CS2', minutes: 800 }], new Set(), 2);
  assert.deepEqual(next.review, { at: 2, since: 1, changes: [{ appId: '570', name: 'Dota 2', minutes: 9, seen: false }] });
  assert.equal(comparePlaytime(next, [{ ...game, minutes: 110 }], new Set(['570']), 3).review.changes[0].seen, true);
  assert.equal(comparePlaytime(next, [game], new Set(), 3).review.changes.length, 0);
});

test('Steam URLs allow known avatar CDN paths and missing game details fail closed', async () => {
  const hash = 'a'.repeat(40);
  assert.equal(safeAvatar('https://avatars.steamstatic.com/' + hash + '_full.jpg')?.endsWith('_full.jpg'), true);
  assert.equal(safeAvatar('https://avatars.steamstatic.com.attacker.invalid/' + hash + '.jpg'), null);
  let response = { response: {} };
  const api = new SteamApi('test', async () => Response.json(response));
  await assert.rejects(api.ownedGames(id), /未公开/);
  response = { response: { game_count: 1, games: [{ appid: 570, name: 'Dota 2', playtime_forever: 42 }] } };
  assert.deepEqual(await api.ownedGames(id), [{ appId: '570', name: 'Dota 2', minutes: 42 }]);
});

test('notifications ignore first or recovered baselines, quiet hours, and cooldown repeats', () => {
  const alerts = [];
  const notifications = new Notices((title, body) => alerts.push({ title, body }));
  const now = new Date(2026, 10, 8, 15).getTime();
  const opts = { ...defaultNotices, game: true, party: true, cooldown: 15 };
  const friend = (info, observedAt, gapSince = null) => ({ ...info, paused: false, observedAt, gapSince });
  const active = [friend(dota, 2), friend(second, 2)];
  notifications.evaluate([friend(noGame, null), friend(second, 1, 1)], active, opts, now);
  assert.equal(alerts.length, 0);
  notifications.evaluate([friend(noGame, 1), friend(second, 1)], active, opts, now);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].body, /已凑够人数/);
  notifications.evaluate([friend(noGame, 1), friend(second, 1)], active, opts, now + minute);
  assert.equal(alerts.length, 1);
  assert.equal(inQuietHours('22:00', '08:00', new Date(2026, 10, 8, 1)), true);
  assert.equal(inQuietHours('22:00', '08:00', new Date(now)), false);
});
