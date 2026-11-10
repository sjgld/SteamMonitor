import type { PlaytimeEvent } from '../../shared';
import { dateTime } from '../lib/format';
import { useGameTitles } from '../lib/game-titles';
import { gameText } from '../lib/model';
import { GamePicture } from './media';

const matchText: Record<PlaytimeEvent['match'], string> = {
  observed: '同期有游戏记录', recent: '可能对应近期会话', unmatched: '未匹配到会话',
};

export function PlaytimeEvents({ events }: { events: PlaytimeEvent[] }) {
  const titles = useGameTitles();
  return <ul className="report-games playtime-events">{events.map(event => <li key={event.rowId}>
    <GamePicture id={event.appId} /><strong>{gameText({ gameId: event.appId, gameName: event.name }, titles)}</strong><span>+{event.minutes} 分钟</span>
    <span className={event.match === 'unmatched' ? 'playtime-unmatched' : 'muted'}>{matchText[event.match]}</span>
    {event.gap && <span className="muted">期间有采集缺口</span>}
    <small>发现 {dateTime(event.at)} · 对比 {dateTime(event.from)} 的样本</small>
  </li>)}</ul>;
}
