import type { Friend, NoticeOptions } from '../shared';

export const defaultNotices: NoticeOptions = {
  online: false, game: false, party: false, friendId: '', gameFilter: '', partySize: 2,
  quietStart: '', quietEnd: '', cooldown: 30,
};

type Notice = { key: string; title: string; body: string };
const ready = (friend: Friend) => !friend.paused && friend.observedAt !== null && friend.gapSince === null;
const online = (friend: Friend) => ['online', 'away', 'busy'].includes(friend.presence);
const game = (friend: Friend) => friend.gameId ?? friend.gameName;

export function inQuietHours(start: string, end: string, date: Date) {
  if (!start || !end || start === end) return false;
  const current = String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
  return start < end ? current >= start && current < end : current >= start || current < end;
}

export class Notices {
  private readonly sent = new Map<string, number>();

  constructor(private readonly show: (title: string, body: string) => void) {}

  evaluate(before: Friend[], after: Friend[], options: NoticeOptions, now: number) {
    if (!options.online && !options.game && !options.party) return;
    if (inQuietHours(options.quietStart, options.quietEnd, new Date(now))) return;
    const previous = new Map(before.map(friend => [friend.id, friend]));
    const found: Notice[] = [];
    const changedGames = new Set<string>();
    const matches = (friend: Friend) => !options.gameFilter || [friend.gameId, friend.gameName]
      .some(value => value?.toLowerCase().includes(options.gameFilter.toLowerCase()));

    for (const friend of after) {
      const old = previous.get(friend.id);
      if (!old || !ready(old) || !ready(friend) || friend.observedAt === old.observedAt) continue;
      const gameId = game(friend);
      const newGame = gameId !== null && gameId !== game(old);
      if (newGame && matches(friend)) changedGames.add(gameId);
      if (options.friendId && friend.id !== options.friendId) continue;
      if (options.game && newGame && matches(friend)) {
        found.push({ key: 'game:' + friend.id + ':' + gameId, title: friend.name + ' 开始玩游戏',
          body: friend.gameName ?? '游戏 #' + gameId });
      } else if (options.online && old.presence === 'offline' && online(friend)) {
        found.push({ key: 'online:' + friend.id, title: friend.name + ' 上线了', body: 'Steam 显示该好友在线。' });
      }
    }

    if (options.party) {
      for (const id of changedGames) {
        const oldCount = before.filter(friend => ready(friend) && game(friend) === id).length;
        const group = after.filter(friend => ready(friend) && game(friend) === id);
        if (oldCount < options.partySize && group.length >= options.partySize) {
          found.push({ key: 'party:' + id, title: (group[0].gameName ?? '游戏 #' + id) + ' 已凑够人数',
            body: group.map(friend => friend.name).slice(0, 6).join('、') + ' 正在玩。' });
        }
      }
    }

    const cutoff = now - options.cooldown * 60_000;
    for (const [key, at] of this.sent) if (at <= cutoff) this.sent.delete(key);
    const send = found.filter(notice => !this.sent.has(notice.key));
    if (!send.length) return;
    for (const notice of send) this.sent.set(notice.key, now);
    this.show(send.length === 1 ? send[0].title : 'Steam 好友活动',
      send.map(notice => send.length === 1 ? notice.body : notice.title).slice(0, 4).join('\n'));
  }
}
