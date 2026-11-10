const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { applicationId, knownSchema, migrate, readSchema, schemaVersion, statementLayout, userVersion } = require('../build/main/data/migrations');
const { Store } = require('../build/main/data/store');
// Captured from the 0.7.4 release build: the statements exactly as that version stored them.
const released = require('./fixtures/schema-0.7.4.json');

const id = '76561197960265729';
const minute = 60_000;
const layout = rows => rows.map(row => [row.type, row.name, statementLayout(row.sql)]);
const playtimeHistory = ['playtime_watch', 'playtime_events', 'playtime_events_friend'];

/** Statements of an older release: before the avatar column and/or the playtime history tables. */
function olderSchema({ avatar = true, playtime = true, removedGaps = true } = {}) {
  return released
    .filter(row => (playtime || !playtimeHistory.includes(row.name)) && (removedGaps || row.name !== 'removed_gaps'))
    .map(row => avatar || row.name !== 'friends' ? row : { ...row, sql: row.sql.replace(/\s*, avatar TEXT\)/, ')') });
}

function writeLegacy(file, schema, { avatar = true } = {}) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA application_id = ${applicationId}`);
  for (const row of schema.filter(item => item.type === 'table')) db.exec(row.sql);
  for (const row of schema.filter(item => item.type !== 'table')) db.exec(row.sql);
  db.prepare(`INSERT INTO friends (id, name, note${avatar ? ', avatar' : ''}) VALUES (?, '甲', '旧备注'${avatar ? ', NULL' : ''})`).run(id);
  db.prepare("INSERT INTO activity (player_id, kind, at, presence, game_id, game_name) VALUES (?, 'baseline', ?, 'online', '570', 'Dota 2')")
    .run(id, minute);
  db.prepare("INSERT INTO preferences VALUES ('mode', 'live')").run();
  db.close();
}

function scratch(run) {
  const directory = mkdtempSync(join(tmpdir(), 'steammonitor-migrate-'));
  try { run(name => join(directory, name)); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test('a new database is created at the current version with the released 0.7.4 statements', () => scratch(path => {
  const file = path('new.sqlite');
  new Store(file).close();
  const db = new DatabaseSync(file);
  try {
    assert.equal(userVersion(db), schemaVersion);
    assert.equal(db.prepare('PRAGMA application_id').get().application_id, applicationId);
    const baseline = readSchema(db).filter(row => !row.name.startsWith('consents'));
    assert.deepEqual(layout(baseline), layout(released));
    assert.ok(readSchema(db).some(row => row.name === 'consents'));
  } finally { db.close(); }
}));

test('databases of every earlier layout upgrade in place and keep their rows and settings', () => scratch(path => {
  const layouts = [{}, { avatar: false }, { playtime: false }, { avatar: false, playtime: false, removedGaps: false }];
  for (const [index, options] of layouts.entries()) {
    const file = path(`legacy-${index}.sqlite`);
    writeLegacy(file, olderSchema(options), options);
    const store = new Store(file);
    try {
      const [friend] = store.friends();
      assert.deepEqual([friend.id, friend.note, friend.avatar], [id, '旧备注', null]);
      assert.equal(store.activity({ playerId: id })[0].gameName, 'Dota 2');
      assert.equal(store.preference('mode'), 'live');
      assert.deepEqual(store.consents(id), []);
      store.watchPlaytime(id, true, minute);
      assert.equal(store.watch(id).enabledAt, minute);
    } finally { store.close(); }
    const db = new DatabaseSync(file);
    try {
      assert.equal(userVersion(db), schemaVersion);
      const fresh = new DatabaseSync(':memory:');
      migrate(fresh);
      assert.deepEqual(layout(readSchema(db)), layout(readSchema(fresh)));
      fresh.close();
    } finally { db.close(); }
    // Opening again is a no-op.
    new Store(file).close();
  }
}));

test('migrations stop at the requested version and a failed step leaves the version unchanged', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, 1);
    assert.equal(userVersion(db), 1);
    assert.ok(!readSchema(db).some(row => row.name === 'consents'));
    db.exec('CREATE TABLE consents (id INTEGER)');
    assert.throws(() => migrate(db));
    assert.equal(userVersion(db), 1);
    db.exec('DROP TABLE consents');
    migrate(db);
    assert.equal(userVersion(db), schemaVersion);
  } finally { db.close(); }
});

test('a database from a newer release is refused untouched', () => scratch(path => {
  const file = path('newer.sqlite');
  new Store(file).close();
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA user_version = ${schemaVersion + 1}`);
  db.close();
  assert.throws(() => new Store(file), /更新版本/);
  const check = new DatabaseSync(file);
  try { assert.equal(userVersion(check), schemaVersion + 1); } finally { check.close(); }
}));

test('backups of every earlier layout and version restore into the current schema', () => scratch(path => {
  const store = new Store(':memory:');
  try {
    const layouts = [{}, { avatar: false }, { playtime: false }, { removedGaps: false }, { avatar: false, playtime: false, removedGaps: false }];
    for (const [index, options] of layouts.entries()) {
      const file = path(`backup-${index}.sqlite`);
      writeLegacy(file, olderSchema(options), options);
      store.restore(file);
      assert.deepEqual(store.friends().map(friend => [friend.id, friend.note]), [[id, '旧备注']]);
      assert.equal(store.activity({ playerId: id }).length, 1);
      assert.equal(store.preference('mode'), undefined);
      store.clearHistory();
    }

    // A backup taken at version 1 (0.7.4 layout, stamped) and one at the current version.
    const stamped = path('v1.sqlite');
    writeLegacy(stamped, olderSchema());
    const db = new DatabaseSync(stamped);
    db.exec('PRAGMA user_version = 1');
    db.close();
    store.remove(id);
    store.restore(stamped);
    assert.equal(store.friends().length, 1);

    const current = path('current.sqlite');
    store.backup(current);
    store.remove(id);
    store.restore(current);
    assert.equal(store.activity({ playerId: id }).length, 1);
  } finally { store.close(); }
}));

test('backups with an unknown version, foreign objects or altered statements are rejected and change nothing', () => scratch(path => {
  const store = new Store(':memory:');
  try {
    store.add([{ id, name: '现有' }]);
    const tamper = (name, sql) => {
      const file = path(name);
      writeLegacy(file, olderSchema());
      const db = new DatabaseSync(file);
      db.exec(sql);
      db.close();
      return file;
    };
    const rejected = [
      tamper('newer.sqlite', `PRAGMA user_version = ${schemaVersion + 1}`),
      tamper('trigger.sqlite', 'CREATE TRIGGER leak AFTER INSERT ON friends BEGIN DELETE FROM activity; END'),
      tamper('view.sqlite', 'CREATE VIEW extra AS SELECT * FROM friends'),
      tamper('column.sqlite', 'ALTER TABLE friends ADD COLUMN extra TEXT'),
      tamper('mismatch.sqlite', 'PRAGMA user_version = 2'),
      tamper('foreign.sqlite', 'PRAGMA application_id = 1'),
    ];
    for (const file of rejected) {
      assert.throws(() => store.restore(file), /SteamMonitor backup/, file);
      assert.deepEqual(store.friends().map(friend => friend.name), ['现有']);
    }
    assert.equal(knownSchema(olderSchema(), 0).length, released.length);
    assert.equal(knownSchema(olderSchema(), 2), null);
  } finally { store.close(); }
}));
