import { DatabaseSync } from 'node:sqlite';

/** Marks a SQLite file as a SteamMonitor database ("STMO"). */
export const applicationId = 0x53544d4f;

export interface SchemaRow {
  type: string;
  name: string;
  sql: string;
}

/** The tables of 0.7.4 and earlier. Releases before 0.8 created whatever was missing at every start. */
function createLegacyTables(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS friends (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      pinned INTEGER NOT NULL DEFAULT 0, paused INTEGER NOT NULL DEFAULT 0,
      presence TEXT NOT NULL DEFAULT 'unknown', game_id TEXT, game_name TEXT,
      observed_at INTEGER, gap_since INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY, player_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, at INTEGER NOT NULL, ended_at INTEGER, reason TEXT,
      presence TEXT, previous_presence TEXT,
      game_id TEXT, game_name TEXT, previous_game_id TEXT, previous_game_name TEXT
    ) STRICT;
    CREATE INDEX IF NOT EXISTS activity_time ON activity(at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS activity_friend ON activity(player_id, at DESC, id DESC);
    CREATE TABLE IF NOT EXISTS removed_gaps (
      activity_id INTEGER PRIMARY KEY REFERENCES activity(id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS favorite_games (game TEXT PRIMARY KEY) STRICT;
    CREATE TABLE IF NOT EXISTS playtime (
      player_id TEXT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
      at INTEGER NOT NULL, review TEXT NOT NULL, games TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS playtime_watch (
      player_id TEXT PRIMARY KEY REFERENCES friends(id) ON DELETE CASCADE,
      enabled_at INTEGER NOT NULL, next_at INTEGER NOT NULL, error TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS playtime_events (
      id INTEGER PRIMARY KEY, player_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL, name TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes > 0),
      since INTEGER NOT NULL, at INTEGER NOT NULL CHECK(at >= since),
      match TEXT NOT NULL CHECK(match IN ('observed','recent','unmatched')),
      gap INTEGER NOT NULL CHECK(gap IN (0,1))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS playtime_events_friend ON playtime_events(player_id, at DESC, id DESC);
  `);
}

/**
 * Version 1 brings any database written before 0.8 (user_version 0, possibly empty) to the 0.7.4
 * schema. It is the only step that inspects what already exists; later steps rely on the version.
 */
function baseline(db: DatabaseSync) {
  createLegacyTables(db);
  if (!db.prepare('PRAGMA table_info(friends)').all().some(column => column.name === 'avatar')) {
    db.exec('ALTER TABLE friends ADD COLUMN avatar TEXT');
  }
}

/** Version 2: the consent log. Discovery consent concerns the user's own account and has no friend row. */
function consents(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE consents (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK(kind IN ('track','playtime','discovery')),
      player_id TEXT REFERENCES friends(id) ON DELETE CASCADE,
      text TEXT NOT NULL, granted_at INTEGER NOT NULL, revoked_at INTEGER,
      CHECK((kind = 'discovery') = (player_id IS NULL))
    ) STRICT;
    CREATE INDEX consents_player ON consents(player_id, kind, granted_at DESC, id DESC);
  `);
}

/** Step `n` (zero-based) upgrades a database from user_version `n` to `n + 1`. Append only. */
const migrations: ((db: DatabaseSync) => void)[] = [baseline, consents];

export const schemaVersion = migrations.length;

export function userVersion(db: DatabaseSync) {
  return Number(db.prepare('PRAGMA user_version').get()?.user_version);
}

/** Runs the missing steps in order, each in its own transaction together with its version stamp. */
export function migrate(db: DatabaseSync, target = schemaVersion) {
  const current = userVersion(db);
  if (!Number.isInteger(current) || current < 0 || current > schemaVersion) {
    throw new Error('数据库由更新版本的 SteamMonitor 创建，请升级程序后再打开。');
  }
  for (let version = current; version < target; version += 1) {
    db.exec('BEGIN IMMEDIATE');
    try {
      migrations[version](db);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function readSchema(db: DatabaseSync): SchemaRow[] {
  return db.prepare("SELECT type, name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name")
    .all() as unknown as SchemaRow[];
}

function memorySchema(build: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(':memory:');
  try {
    build(db);
    return readSchema(db);
  } finally {
    db.close();
  }
}

/**
 * A statement without its layout. SQLite stores the text exactly as it was written, and ALTER TABLE
 * splices a column into it, so the same schema differs in line breaks and spaces around punctuation.
 */
export const statementLayout = (sql: string) => sql.replace(/\s+/g, ' ').replace(/ ?([(),]) ?/g, '$1').trim();

const fingerprint = (rows: SchemaRow[]) => JSON.stringify(rows.map(row => [row.type, row.name, statementLayout(String(row.sql))]));

/** Objects that 0.3 – 0.7 added by `CREATE … IF NOT EXISTS`; an unversioned backup may lack them. */
const playtimeHistory = new Set(['playtime_watch', 'playtime_events', 'playtime_events_friend']);

/**
 * The schema a backup must have, in our own wording, or null when the file is not a known
 * SteamMonitor layout. Versioned backups must match their version exactly. Unversioned ones (before
 * 0.8) may predate the avatar column, the playtime history tables and removed_gaps.
 */
export function knownSchema(archived: SchemaRow[], version: number): SchemaRow[] | null {
  if (!Number.isInteger(version) || version < 0 || version > schemaVersion) return null;
  const candidates: SchemaRow[][] = [];
  if (version > 0) {
    candidates.push(memorySchema(db => migrate(db, version)));
  } else {
    const names = new Set(archived.map(row => row.name));
    const keep = (row: SchemaRow) => (names.has('playtime_events') || !playtimeHistory.has(row.name)) &&
      (names.has('removed_gaps') || row.name !== 'removed_gaps');
    candidates.push(memorySchema(baseline).filter(keep), memorySchema(createLegacyTables).filter(keep));
  }
  const wanted = fingerprint(archived);
  return candidates.find(candidate => fingerprint(candidate) === wanted) ?? null;
}

/** An in-memory database with exactly `schema`, stamped `version`; used to upgrade a backup's rows. */
export function stagingDatabase(schema: SchemaRow[], version: number) {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  for (const row of [...schema].sort((a, b) => Number(a.type !== 'table') - Number(b.type !== 'table'))) db.exec(row.sql);
  db.exec(`PRAGMA user_version = ${version}`);
  return db;
}
