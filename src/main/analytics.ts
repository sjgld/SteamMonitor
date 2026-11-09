import type { Activity, ActivityBoard, ActivityWindow, Friend, GameSession, Report, Span } from '../shared';
import type { OwnedGame } from './steam';
import type { SavedPlaytime } from './store';
import { displayBands } from '../gap-display';

export const dayMs = 86_400_000;

export function calendarDayRange(value: string, now: number) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('日期无效。');
  const start = new Date(value + 'T00:00:00');
  const [year, month, day] = value.split('-').map(Number);
  if (start.getFullYear() !== year || start.getMonth() + 1 !== month || start.getDate() !== day) {
    throw new Error('日期无效。');
  }
  if (start.getTime() > now) throw new Error('请选择今天或更早的日期。');
  const next = new Date(start);
  next.setDate(next.getDate() + 1);
  return { start: start.getTime(), end: Math.min(next.getTime(), now) };
}

export function spansFor(rows: Activity[], friend: Friend, start: number, end: number): Span[] {
  const spans: Span[] = [];
  function append(state: Span['state'], at: number, until: number, gameId: string | null = null, gameName: string | null = null,
    gap?: Activity) {
    if (until <= at) return;
    const last = spans.at(-1);
    if (state !== 'gap' && last?.end === at && last.state === state && last.gameId === gameId && last.gameName === gameName) {
      last.end = until;
    } else {
      const span: Span = { start: at, end: until, state, gameId, gameName };
      if (gap) {
        if (gap.endedAt !== null) span.gapDuration = gap.endedAt - gap.at;
        span.gapRecord = { rowId: gap.rowId, at: gap.at, endedAt: gap.endedAt, removed: gap.gapRemoved };
      }
      spans.push(span);
    }
  }

  let cursor = start;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const at = Math.max(cursor, row.at, start);
    const next = Math.min(end, rows[index + 1]?.at ?? end);
    append('empty', cursor, Math.min(at, end));
    const until = row.kind === 'gap' ? Math.min(next, row.endedAt ?? end)
      : Math.min(next, index < rows.length - 1 ? next : friend.observedAt ?? at);
    if (row.kind === 'gap') {
      append('gap', at, until, null, null, row);
    } else append(row.presence ?? 'unknown', at, until, row.gameId, row.gameName);
    cursor = Math.max(cursor, Math.min(end, at), until);
  }
  append('empty', cursor, end);
  return spans;
}

function groupActivity(rows: Activity[]) {
  const byFriend = new Map<string, Activity[]>();
  for (const row of rows) {
    const list = byFriend.get(row.playerId);
    if (list) list.push(row);
    else byFriend.set(row.playerId, [row]);
  }
  return byFriend;
}

export function unchangedRecoveries(rows: Activity[]): ActivityBoard['unchangedRecoveries'] {
  const result: ActivityBoard['unchangedRecoveries'] = {};
  const previous = new Map<string, { observation?: Activity; gap?: Activity }>();
  for (const row of rows) {
    const before = previous.get(row.playerId);
    if (row.kind === 'gap') {
      previous.set(row.playerId, { observation: before?.gap ? undefined : before?.observation, gap: row });
      continue;
    }
    if (row.kind === 'baseline' && before?.observation && before.gap?.endedAt === row.at &&
        row.presence === before.observation.presence &&
        (row.gameId ?? row.gameName) === (before.observation.gameId ?? before.observation.gameName)) {
      result[row.rowId] = { duration: row.at - before.gap.at, removed: before.gap.gapRemoved };
    }
    previous.set(row.playerId, { observation: row });
  }
  return result;
}

export function activityTracks(rows: Activity[], friends: Friend[], { from, until }: ActivityWindow): ActivityBoard['tracks'] {
  const byFriend = groupActivity(rows);
  return friends.map(friend => {
    const history = byFriend.get(friend.id) ?? [];
    let index = -1;
    const spans = spansFor(history, friend, from, until).map(span => {
      while (history[index + 1]?.at <= span.start) index++;
      return span.state === 'empty' ? span : { ...span, sourceId: history[index]?.rowId };
    });
    return { playerId: friend.id, spans };
  });
}

export function buildReport(rows: Activity[], friends: Friend[], start: number, end: number, single: boolean,
  includeSessions = false, gapMinutes = 0): Report {
  const byFriend = groupActivity(rows);
  const shared: Report['shared'] = [];
  const games = new Map<string, { name: string; total: number; edges: { at: number; id: string; start: boolean }[] }>();
  const names = new Map(friends.map(friend => [friend.id, friend.name]));
  let coverage = 0;
  let spans: Span[] = [];
  const sessions: GameSession[] = [];
  for (const friend of friends) {
    const track = spansFor(byFriend.get(friend.id) ?? [], friend, start, end);
    if (single) spans = track;
    if (includeSessions) {
      let previous: GameSession | undefined;
      for (const band of displayBands(track, gapMinutes)) {
        const id = band.gameId ?? band.gameName;
        if (!id) continue;
        if (previous && previous.end === band.start && (previous.gameId ?? previous.gameName) === id) {
          previous.end = band.end;
          previous.observedMs += band.elapsed;
        } else {
          previous = { playerId: friend.id, playerName: friend.name, gameId: band.gameId,
            gameName: band.gameName ?? '游戏 #' + id, start: band.start, end: band.end, observedMs: band.elapsed };
          sessions.push(previous);
        }
      }
    }
    for (const item of track) {
      const elapsed = item.end - item.start;
      if (item.state !== 'empty' && item.state !== 'gap') coverage += elapsed;
      const id = item.gameId ?? item.gameName;
      if (!id) continue;
      const name = item.gameName ?? '游戏 #' + id;
      let game = games.get(id);
      if (!game) {
        game = { name, total: 0, edges: [] };
        games.set(id, game);
      }
      if (item.gameName) game.name = item.gameName;
      game.total += elapsed;
      if (!single) game.edges.push({ at: item.start, id: friend.id, start: true }, { at: item.end, id: friend.id, start: false });
    }
  }
  const totals = [...games].map(([id, game]) => {
    const active = new Set<string>();
    let overlap = 0;
    let cursor = start;
    let last: Report['shared'][number] | undefined;
    for (const edge of game.edges.sort((a, b) => a.at - b.at || Number(a.start) - Number(b.start))) {
      if (edge.at > cursor && active.size >= 2) {
        overlap += edge.at - cursor;
        const players = [...active].sort().map(id => names.get(id)!);
        if (last?.end === cursor && last.names.length === players.length && last.names.every((name, index) => name === players[index])) {
          last.end = edge.at;
        } else {
          last = { game: game.name, start: cursor, end: edge.at, names: players };
          shared.push(last);
        }
      }
      if (edge.start) active.add(edge.id);
      else active.delete(edge.id);
      cursor = edge.at;
    }
    return { id, name: game.name, minutes: game.total / 60_000, sharedMinutes: overlap / 60_000 };
  }).sort((a, b) => b.minutes - a.minutes);
  return { start, end, spans, games: totals, coverage: friends.length && end > start ? coverage / ((end - start) * friends.length) : 0,
    shared: shared.sort((a, b) => b.end - a.end).slice(0, 50),
    ...(includeSessions ? { sessions: sessions.sort((a, b) => b.start - a.start) } : {}) };
}

export function comparePlaytime(previous: SavedPlaytime | null, games: OwnedGame[], visibleIds: Set<string>, at: number): SavedPlaytime {
  const totals = new Map(previous?.games.map(game => [game.appId, game.minutes]));
  return {
    games,
    review: {
      at,
      since: previous?.review.at ?? null,
      changes: games.flatMap(game => {
        const baseline = totals.get(game.appId);
        if (baseline === undefined || baseline >= game.minutes) return [];
        return [{ appId: game.appId, name: game.name, minutes: game.minutes - baseline, seen: visibleIds.has(game.appId) }];
      }).sort((a, b) => b.minutes - a.minutes),
    },
  };
}
