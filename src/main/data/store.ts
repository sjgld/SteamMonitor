import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { Activity, ActivityBoard, ActivityFilter, ActivityWindow, ConsentKind, ConsentRecord, Friend, GapBatch, GapCandidate, GapTarget, Observation, Player, PlaytimeEvent, PlaytimeReview } from '../../shared';
import type { OwnedGame } from '../steam/api';
import { applicationId, knownSchema, migrate, readSchema, stagingDatabase, userVersion } from './migrations';

const friendFields = `
  id, name, note, pinned, paused, presence, game_id AS gameId, game_name AS gameName,
  observed_at AS observedAt, gap_since AS gapSince, avatar
`;

const activityFields = `
  a.id AS rowId, a.player_id AS playerId, f.name, a.kind, a.at, a.ended_at AS endedAt, a.reason,
  a.presence, a.previous_presence AS previousPresence, a.game_id AS gameId, a.game_name AS gameName,
  a.previous_game_id AS previousGameId, a.previous_game_name AS previousGameName
`;
// Restored from a backup, in foreign-key order. Automatic sampling (playtime_watch) and settings stay local.
const backupTables = ['friends', 'activity', 'favorite_games', 'playtime', 'playtime_events', 'removed_gaps', 'consents'];
const consentFields = 'id AS rowId, kind, player_id AS playerId, text, granted_at AS grantedAt, revoked_at AS revokedAt';
const nearbyGapMs = 10_000;
const gapFields = 'a.id AS rowId, a.player_id AS playerId, a.at, a.ended_at AS endedAt, f.name';
const availableGap = "a.kind = 'gap' AND a.ended_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM removed_gaps g WHERE g.activity_id = a.id)";

function sameGap(a: GapTarget, b: GapTarget) {
  return a.rowId === b.rowId && a.playerId === b.playerId && a.at === b.at && a.endedAt === b.endedAt;
}

function copyRows(from: DatabaseSync, to: DatabaseSync, table: string, where = '') {
  let insert: ReturnType<DatabaseSync['prepare']> | undefined;
  for (const row of from.prepare(`SELECT * FROM ${table}${where}`).iterate()) {
    insert ??= to.prepare(`INSERT INTO ${table} (${Object.keys(row).map(name => `"${name}"`).join(',')})
      VALUES (${Object.keys(row).map(() => '?').join(',')})`);
    insert.run(...Object.values(row) as SQLInputValue[]);
  }
}

export interface SavedPlaytime {
  review: PlaytimeReview;
  games: OwnedGame[];
}

export interface WatchRow {
  id: string;
  enabledAt: number;
  nextAt: number;
  error: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
    try {
      this.db.exec('PRAGMA journal_mode = WAL');
      migrate(this.db);
      this.db.exec(`PRAGMA application_id = ${applicationId}`);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  preference(key: string): string | undefined {
    return this.db.prepare('SELECT value FROM preferences WHERE key = ?').get(key)?.value as string | undefined;
  }

  setPreference(key: string, value: string) {
    this.db.prepare('INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)').run(key, value);
  }

  private transaction(action: () => void) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      action();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  friends(): Friend[] {
    const rows = this.db.prepare(`SELECT ${friendFields} FROM friends ORDER BY pinned DESC, name COLLATE NOCASE, id`)
      .all() as unknown as Friend[];
    return rows.map(row => ({ ...row, pinned: Boolean(row.pinned), paused: Boolean(row.paused) }));
  }

  /** Adds accounts; `consent` logs the confirmation the user ticked for each of them. */
  add(players: Player[], consent?: { text: string; at: number }) {
    const insert = this.db.prepare('INSERT OR IGNORE INTO friends (id, name, avatar) VALUES (?, ?, ?)');
    this.transaction(() => {
      for (const player of players) {
        insert.run(player.id, player.name, player.avatar ?? null);
        if (consent) this.grantConsent('track', player.id, consent.text, consent.at);
      }
    });
  }

  /** Consent log of one friend, or of friend discovery (`null`), newest first. */
  consents(playerId: string | null): ConsentRecord[] {
    return this.db.prepare(`SELECT ${consentFields} FROM consents WHERE player_id IS ?
      ORDER BY granted_at DESC, id DESC`).all(playerId) as unknown as ConsentRecord[];
  }

  consent(rowId: number): ConsentRecord | undefined {
    return this.db.prepare(`SELECT ${consentFields} FROM consents WHERE id = ?`).get(rowId) as unknown as ConsentRecord | undefined;
  }

  /** Logs a confirmation. An unrevoked record of the same kind already covers it. */
  grantConsent(kind: ConsentKind, playerId: string | null, text: string, at: number) {
    this.db.prepare(`INSERT INTO consents (kind, player_id, text, granted_at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (
        SELECT 1 FROM consents WHERE kind = ? AND player_id IS ? AND revoked_at IS NULL)`)
      .run(kind, playerId, text, at, kind, playerId);
  }

  /** Closes the open records of a kind; with `playerId` undefined, for every friend. */
  revokeConsent(kind: ConsentKind, playerId: string | null | undefined, at: number) {
    const one = playerId === undefined ? '' : ' AND player_id IS ?';
    return Number(this.db.prepare(`UPDATE consents SET revoked_at = max(granted_at, ?)
      WHERE kind = ? AND revoked_at IS NULL${one}`).run(at, kind, ...(playerId === undefined ? [] : [playerId])).changes);
  }

  /** True when the newest record of a kind was withdrawn, so the activity needs a new confirmation. */
  consentWithdrawn(kind: ConsentKind, playerId: string | null) {
    const latest = this.db.prepare(`SELECT revoked_at AS revokedAt FROM consents WHERE kind = ? AND player_id IS ?
      ORDER BY granted_at DESC, id DESC LIMIT 1`).get(kind, playerId);
    return Boolean(latest) && latest!.revokedAt !== null;
  }

  update(id: string, note: string, pinned: boolean, paused: boolean, at: number) {
    this.transaction(() => {
      this.db.prepare('UPDATE friends SET note = ?, pinned = ?, paused = ? WHERE id = ?')
        .run(note, Number(pinned), Number(paused), id);
      if (paused) this.openGap(id, at, '暂停记录');
    });
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM friends WHERE id = ?').run(id);
  }

  removeGap(playerId: string, rowId: number, at: number, endedAt: number) {
    return Boolean(this.db.prepare(`INSERT OR IGNORE INTO removed_gaps(activity_id)
      SELECT id FROM activity WHERE player_id = ? AND id = ? AND at = ? AND ended_at = ? AND kind = 'gap'`)
      .run(playerId, rowId, at, endedAt).changes);
  }

  gapBatch(target: GapTarget): GapBatch | null {
    const anchor = this.db.prepare(`
      SELECT ${gapFields}, a.reason FROM activity a JOIN friends f ON a.player_id = f.id
      WHERE ${availableGap} AND a.id = ? AND a.player_id = ? AND a.at = ? AND a.ended_at = ?
    `).get(target.rowId, target.playerId, target.at, target.endedAt) as (GapCandidate & { reason: string | null }) | undefined;
    if (!anchor) return null;
    const candidates = this.db.prepare(`
      SELECT ${gapFields} FROM activity a JOIN friends f ON a.player_id = f.id
      WHERE ${availableGap} AND a.reason IS ? AND a.at BETWEEN ? AND ? AND a.ended_at BETWEEN ? AND ?
      ORDER BY f.name COLLATE NOCASE, a.player_id, a.at, a.id
    `).all(anchor.reason, anchor.at - nearbyGapMs, anchor.at + nearbyGapMs,
      anchor.endedAt - nearbyGapMs, anchor.endedAt + nearbyGapMs) as unknown as GapCandidate[];
    const exact = candidates.filter(row => row.at === anchor.at && row.endedAt === anchor.endedAt);
    const exactFriends = new Set(exact.map(row => row.playerId));
    return { anchor, reason: anchor.reason, exact, nearby: candidates.filter(row => !exactFriends.has(row.playerId)) };
  }

  removeGapBatch(anchor: GapTarget, targets: GapTarget[], scope: 'single' | 'batch') {
    const stale = '这批缺口已更新，请重新打开预览。';
    this.transaction(() => {
      const current = this.gapBatch(anchor);
      if (!current) throw new Error(stale);
      const permitted = new Map((scope === 'single' ? [current.anchor] : [...current.exact, ...current.nearby])
        .map(item => [item.rowId, item]));
      const selected = new Set(targets.map(item => item.rowId));
      const required = scope === 'single' ? [current.anchor] : current.exact;
      if (selected.size !== targets.length || required.some(item => !selected.has(item.rowId)) ||
          targets.some(item => {
            const candidate = permitted.get(item.rowId);
            return !candidate || !sameGap(candidate, item);
          })) throw new Error(stale);
      for (const item of targets) {
        if (!this.removeGap(item.playerId, item.rowId, item.at, item.endedAt)) throw new Error(stale);
      }
    });
    return targets.length;
  }

  private openGap(id: string, at: number, reason: string) {
    const changed = this.db.prepare('UPDATE friends SET gap_since = ? WHERE id = ? AND gap_since IS NULL')
      .run(at, id).changes;
    if (changed) {
      this.db.prepare("INSERT INTO activity (player_id, kind, at, reason) VALUES (?, 'gap', ?, ?)")
        .run(id, at, reason);
    }
  }

  gap(at: number, reason: string, fromLastReading = false) {
    this.transaction(() => {
      for (const friend of this.friends()) {
        if (!friend.paused && friend.observedAt !== null) {
          this.openGap(friend.id, fromLastReading ? Math.min(at, friend.observedAt) : at, reason);
        }
      }
    });
  }

  apply(ids: string[], samples: Map<string, Observation>, at: number, missingReason: string) {
    const get = this.db.prepare(`SELECT ${friendFields} FROM friends WHERE id = ? AND paused = 0`);
    const closeGap = this.db.prepare("UPDATE activity SET ended_at = max(at, ?) WHERE player_id = ? AND kind = 'gap' AND ended_at IS NULL");
    const save = this.db.prepare(`
      UPDATE friends SET name = ?, presence = ?, game_id = ?, game_name = ?, observed_at = ?, gap_since = NULL, avatar = ?
      WHERE id = ?
    `);
    const log = this.db.prepare(`
      INSERT INTO activity (player_id, kind, at, reason, presence, previous_presence,
                            game_id, game_name, previous_game_id, previous_game_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.transaction(() => {
      for (const id of ids) {
        const before = get.get(id) as unknown as Friend | undefined;
        if (!before) continue;
        const after = samples.get(id);
        if (!after) {
          this.openGap(id, at, missingReason);
          continue;
        }
        const recovery = before.gapSince !== null;
        const baseline = recovery || before.observedAt === null;
        if (recovery) closeGap.run(at, id);
        save.run(after.name, after.presence, after.gameId, after.gameName, at, after.avatar ?? null, id);
        const previousGame = before.gameId ?? before.gameName;
        const currentGame = after.gameId ?? after.gameName;
        if (baseline || before.presence !== after.presence || previousGame !== currentGame) {
          log.run(id, baseline ? 'baseline' : 'change', at, recovery ? '恢复采集' : null,
            after.presence, baseline ? null : before.presence,
            after.gameId, after.gameName, baseline ? null : before.gameId, baseline ? null : before.gameName);
        }
      }
    });
  }

  activity(filter: ActivityFilter, limit?: number, localized: string[] = []): Activity[] {
    const where = ['NOT EXISTS (SELECT 1 FROM removed_gaps g WHERE g.activity_id = a.id)'];
    const values: SQLInputValue[] = [];
    if (filter.playerId) {
      where.push('a.player_id = ?');
      values.push(filter.playerId);
    }
    if (filter.from !== undefined) {
      where.push("(a.at >= ? OR (a.kind = 'gap' AND (a.ended_at IS NULL OR a.ended_at > ?)))");
      values.push(filter.from, filter.from);
    }
    if (filter.until !== undefined) {
      where.push('a.at < ?');
      values.push(filter.until);
    }
    if (filter.game) {
      const ids = localized.map(() => '?').join(',');
      where.push(`(instr(lower(coalesce(a.game_name, '')), lower(?)) > 0
        OR instr(lower(coalesce(a.previous_game_name, '')), lower(?)) > 0
        OR a.game_id = ? OR a.previous_game_id = ?
        ${ids ? `OR a.game_id IN (${ids}) OR a.previous_game_id IN (${ids})` : ''})`);
      values.push(filter.game, filter.game, filter.game, filter.game, ...localized, ...localized);
    }
    if (limit !== undefined) values.push(limit);
    return this.db.prepare(`
      SELECT ${activityFields}
      FROM activity AS a JOIN friends AS f ON a.player_id = f.id
      WHERE ${where.join(' AND ')}
      ORDER BY a.at DESC, a.id DESC
      ${limit === undefined ? '' : 'LIMIT ?'}
    `).all(...values) as unknown as Activity[];
  }

  historyRange(from: number, until: number, playerId?: string): Activity[] {
    const player = playerId ? ' AND f.id = ?' : '';
    const rows = this.db.prepare(`
      SELECT ${activityFields}, EXISTS (SELECT 1 FROM removed_gaps g WHERE g.activity_id = a.id) AS gapRemoved
      FROM friends AS f JOIN activity AS a ON a.player_id = f.id
      WHERE a.at < ? AND (a.at >= ? OR a.id = (
        SELECT old.id FROM activity AS old WHERE old.player_id = f.id AND old.at < ?
        ORDER BY old.at DESC, old.id DESC LIMIT 1
      ))${player}
      ORDER BY a.at, a.id
    `).all(until, from, from, ...(playerId ? [playerId] : [])) as unknown as Activity[];
    return rows.map(({ gapRemoved, ...row }) => gapRemoved ? { ...row, gapRemoved: true } : row);
  }

  favoriteGames(): string[] {
    return this.db.prepare('SELECT game FROM favorite_games ORDER BY game').all().map(row => row.game as string);
  }

  favoriteGame(game: string, enabled: boolean) {
    this.db.prepare(enabled ? 'INSERT OR IGNORE INTO favorite_games VALUES (?)' : 'DELETE FROM favorite_games WHERE game = ?').run(game);
  }

  playtime(id: string): SavedPlaytime | null {
    const row = this.db.prepare('SELECT review, games FROM playtime WHERE player_id = ?').get(id);
    return row ? { review: JSON.parse(row.review as string), games: JSON.parse(row.games as string) } : null;
  }

  savePlaytime(id: string, data: SavedPlaytime) {
    this.db.prepare('INSERT OR REPLACE INTO playtime VALUES (?, ?, ?, ?)')
      .run(id, data.review.at, JSON.stringify(data.review), JSON.stringify(data.games));
  }

  recordPlaytime(id: string, data: SavedPlaytime, events: Omit<PlaytimeEvent, 'rowId'>[]) {
    this.transaction(() => {
      this.savePlaytime(id, data);
      const insert = this.db.prepare('INSERT INTO playtime_events (player_id, app_id, name, minutes, since, at, match, gap) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const event of events) insert.run(id, event.appId, event.name, event.minutes, event.from, event.at, event.match, Number(event.gap));
    });
  }

  playtimeEvents(id: string, from: number, until: number): PlaytimeEvent[] {
    return this.playtimeRange({ playerId: id, from, until: until + 1 }, 200);
  }

  playtimeRange({ playerId, game, from, until }: ActivityFilter & ActivityWindow, limit?: number,
    localized: string[] = []): ActivityBoard['playtime'] {
    const values: SQLInputValue[] = [from, until];
    if (playerId) values.push(playerId);
    if (game) values.push(game, game, ...localized);
    const ids = localized.map(() => '?').join(',');
    if (limit !== undefined) values.push(limit);
    const rows = this.db.prepare(`
      SELECT id AS rowId, player_id AS playerId, app_id AS appId, name, minutes, since AS "from", at, match, gap
      FROM playtime_events WHERE at >= ? AND at < ?
      ${playerId ? 'AND player_id = ?' : ''}
      ${game ? `AND (instr(lower(name), lower(?)) > 0 OR app_id = ? ${ids ? `OR app_id IN (${ids})` : ''})` : ''}
      ORDER BY at DESC, id DESC ${limit === undefined ? '' : 'LIMIT ?'}
    `).all(...values) as unknown as ActivityBoard['playtime'];
    return rows.map(row => ({ ...row, gap: Boolean(row.gap) }));
  }

  watch(id: string): WatchRow | undefined {
    return this.db.prepare('SELECT player_id AS id, enabled_at AS enabledAt, next_at AS nextAt, error FROM playtime_watch WHERE player_id = ?')
      .get(id) as unknown as WatchRow | undefined;
  }

  dueWatches(now: number): string[] {
    return this.db.prepare(`SELECT w.player_id AS id FROM playtime_watch w JOIN friends f ON f.id = w.player_id
      WHERE w.next_at <= ? AND f.paused = 0 ORDER BY w.next_at, w.player_id`).all(now).map(row => String(row.id));
  }

  watchPlaytime(id: string, enabled: boolean, now: number) {
    if (enabled) this.db.prepare('INSERT OR IGNORE INTO playtime_watch VALUES (?, ?, ?, ?)').run(id, now, now, '');
    else this.db.prepare('DELETE FROM playtime_watch WHERE player_id = ?').run(id);
  }

  scheduleWatch(id: string, at: number, error = '') {
    this.db.prepare('UPDATE playtime_watch SET next_at = ?, error = ? WHERE player_id = ?').run(at, error, id);
  }

  clearPlaytime(id: string, at = Date.now()) {
    this.transaction(() => {
      this.revokeConsent('playtime', id, at);
      this.db.prepare('DELETE FROM playtime_watch WHERE player_id = ?').run(id);
      this.db.prepare('DELETE FROM playtime_events WHERE player_id = ?').run(id);
      this.db.prepare('DELETE FROM playtime WHERE player_id = ?').run(id);
    });
  }

  clearHistory(id?: string, at = Date.now()) {
    this.transaction(() => {
      this.revokeConsent('playtime', id, at);
      const where = id ? ' WHERE player_id = ?' : '';
      const friend = id ? ' WHERE id = ?' : '';
      const parameters = id ? [id] : [];
      this.db.prepare('DELETE FROM activity' + where).run(...parameters);
      this.db.prepare('DELETE FROM playtime' + where).run(...parameters);
      this.db.prepare('DELETE FROM playtime_events' + where).run(...parameters);
      this.db.prepare('DELETE FROM playtime_watch' + where).run(...parameters);
      this.db.prepare(`UPDATE friends SET presence = 'unknown', game_id = NULL, game_name = NULL,
        observed_at = NULL, gap_since = NULL${friend}`).run(...parameters);
    });
  }

  prune(cutoff: number) {
    this.transaction(() => {
      this.db.prepare(`
        DELETE FROM activity AS a
        WHERE a.at < ? AND a.id != (
          SELECT old.id FROM activity AS old WHERE old.player_id = a.player_id AND old.at < ?
          ORDER BY old.at DESC, old.id DESC LIMIT 1
        )
      `).run(cutoff, cutoff);
      this.db.prepare("DELETE FROM activity WHERE at < ? AND kind = 'gap' AND ended_at <= ?").run(cutoff, cutoff);
      this.db.prepare(`
        UPDATE activity SET at = ?, kind = CASE WHEN kind = 'gap' THEN 'gap' ELSE 'baseline' END,
          reason = CASE WHEN kind = 'gap' THEN reason ELSE '保留期起点' END,
          previous_presence = NULL, previous_game_id = NULL, previous_game_name = NULL WHERE at < ?
      `).run(cutoff, cutoff);
      this.db.prepare('UPDATE friends SET gap_since = ? WHERE gap_since < ?').run(cutoff, cutoff);
      this.db.prepare('DELETE FROM playtime WHERE at < ?').run(cutoff);
      this.db.prepare('DELETE FROM playtime_events WHERE at < ?').run(cutoff);
      for (const row of this.db.prepare('SELECT player_id FROM playtime').all()) {
        const id = row.player_id as string;
        const data = this.playtime(id);
        if (data && data.review.since !== null && data.review.since < cutoff) {
          this.savePlaytime(id, { ...data, review: { at: data.review.at, since: null, changes: [] } });
        }
      }
    });
  }

  backup(path: string) {
    this.db.prepare('VACUUM INTO ?').run(path);
  }

  /**
   * Replaces the roster and history with a backup. The file is untrusted: its schema must be one this
   * program wrote, and its rows are upgraded in memory by the same migrations as a live database.
   */
  restore(path: string) {
    const source = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
    let staging: DatabaseSync | undefined;
    try {
      source.exec('PRAGMA trusted_schema = OFF; BEGIN');
      if (source.prepare('PRAGMA application_id').get()?.application_id !== applicationId ||
        source.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
        source.prepare('PRAGMA foreign_key_check').get()) throw new Error('Invalid SteamMonitor backup.');

      const version = userVersion(source);
      const schema = knownSchema(readSchema(source), version);
      if (!schema) throw new Error('Incompatible SteamMonitor backup schema.');
      const upgraded = staging = stagingDatabase(schema, version);
      for (const row of schema) if (row.type === 'table') copyRows(source, upgraded, row.name);
      migrate(upgraded);
      this.transaction(() => {
        this.db.exec('DELETE FROM friends; DELETE FROM favorite_games;');
        for (const table of backupTables) {
          copyRows(upgraded, this.db, table, table === 'consents' ? ' WHERE player_id IS NOT NULL' : '');
        }
      });
    } finally {
      staging?.close();
      source.close();
    }
  }

  close() {
    this.db.close();
  }
}
