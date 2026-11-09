import { isGameAppId, presenceLabels, type Activity, type ActivityFilter, type Friend, type MonitorApi } from '../shared';
import { chineseGameName } from '../game-names';

declare global {
  interface Window { monitor: MonitorApi }
}

export const api = window.monitor;
export const clock = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
export const day = (at: number) => new Date(at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

export function localDateInput(date: Date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

export function errorText(error: unknown) {
  if (!(error instanceof Error)) return '操作失败，请重试。';
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

export function gameText(player: { gameName: string | null; gameId: string | null }, titles?: ReadonlyMap<string, string>) {
  const { gameId, gameName } = player;
  const title = gameId ? titles?.get(gameId) : undefined;
  return (gameId && titles ? chineseGameName(gameId, title) : null) ?? gameName ?? title ?? (gameId ? `游戏 #${gameId}` : '');
}

export function gameImage(id: string | null) {
  return isGameAppId(id) ? 'steam-art://icon/' + id : null;
}

export const dateTime = (at: number) => new Date(at).toLocaleString('zh-CN', {
  month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

export function duration(minutes: number) {
  const rounded = Math.round(minutes);
  if (minutes > 0 && !rounded) return '不足 1 分钟';
  return rounded >= 60 ? Math.floor(rounded / 60) + ' 小时 ' + rounded % 60 + ' 分钟' : rounded + ' 分钟';
}

export function segmentDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 1) return '<1秒';
  if (seconds < 60) return seconds + '秒';
  const minutes = Math.floor(seconds / 60);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor(minutes / 60) % 24;
  const rest = minutes % 60;
  return (days ? days + '天' : '') + (hours ? hours + '小时' : '') + (rest ? rest + '分' : '');
}

export function timelineTextWidth(text: string) {
  return Array.from(text).reduce((width, char) => width + (/^[\x00-\x7f]$/.test(char) ? 7 : 12), 0);
}

export function statusOf(friend: Friend) {
  if (friend.paused || friend.gapSince !== null) return 'unknown';
  return gameText(friend) ? 'playing' : friend.presence;
}

type RosterStatus = Exclude<ReturnType<typeof statusOf>, 'busy'>;
const rosterOrder: Record<RosterStatus, number> = { playing: 0, online: 1, away: 2, offline: 3, unknown: 4 };
const rosterLabels = { online: '在线', away: '离开', offline: '显示离线', unknown: '未知 / 中断' };

export function rosterGroups(friends: Friend[], favoriteGames: string[], titles?: ReadonlyMap<string, string>) {
  const groups = new Map<string, { key: string; name: string; status: RosterStatus; friends: Friend[] }>();
  const favorites = new Set(favoriteGames);
  for (const friend of friends) {
    const current = statusOf(friend);
    const status = current === 'busy' ? 'online' : current;
    const name = status === 'playing' ? gameText(friend, titles) : rosterLabels[status];
    const key = status === 'playing' ? (friend.gameId ? 'id:' + friend.gameId : 'name:' + name) : 'status:' + status;
    const group = groups.get(key);
    if (group) group.friends.push(friend);
    else groups.set(key, { key, name, status, friends: [friend] });
  }
  return [...groups.values()].sort((left, right) =>
    rosterOrder[left.status] - rosterOrder[right.status] ||
    Number(favorites.has(right.key)) - Number(favorites.has(left.key)) ||
    left.name.localeCompare(right.name));
}

export function describeActivity(row: Activity, titles?: ReadonlyMap<string, string>) {
  if (row.kind === 'gap') return `采集缺口 · ${row.reason ?? '数据中断'}`;
  const parts: string[] = [];
  const current = gameText(row, titles);
  const previous = gameText({ gameId: row.previousGameId, gameName: row.previousGameName }, titles);
  if (row.kind === 'baseline') {
    parts.push(row.reason ?? '首次观测');
    if (row.presence) parts.push(presenceLabels[row.presence]);
    if (current) parts.push(current);
  } else {
    if (row.presence && row.presence !== row.previousPresence) parts.push(presenceLabels[row.presence]);
    if ((row.gameId ?? current) !== (row.previousGameId ?? previous)) {
      if (!current) parts.push(`未再观测到 ${previous}`);
      else parts.push(previous ? `换到 ${current}` : `看到 ${current}`);
    }
  }
  return parts.join(' · ');
}

export function makeFilter(playerId: string, game: string, from: string, until: string): ActivityFilter {
  function timestamp(text: string, nextDay = false): number | undefined {
    if (!text) return;
    const date = new Date(text + 'T00:00:00');
    if (nextDay) date.setDate(date.getDate() + 1);
    return date.getTime();
  }
  return { playerId: playerId || undefined, game: game.trim() || undefined, from: timestamp(from), until: timestamp(until, true) };
}
