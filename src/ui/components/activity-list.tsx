import type { Activity, Player } from '../../shared';
import { clock } from '../lib/format';
import { useGameTitles, useLoadGameTitles } from '../lib/game-titles';
import { describeActivity, gameText } from '../lib/model';
import { Empty } from './feedback';
import { Icon } from './icon';
import { Avatar, GamePicture } from './media';

export function Timeline({ rows, people }: { rows: Activity[]; people?: ReadonlyMap<string, Player> }) {
  const titles = useGameTitles();
  useLoadGameTitles(rows.flatMap(row => [row.gameId, row.previousGameId]));
  if (!rows.length) return <Empty title="暂无活动" detail="有效采样后，状态变化会出现在这里。" />;
  return <ol className={people ? 'timeline activity-timeline' : 'timeline'}>
    {rows.map(row => {
      const person = people?.get(row.playerId) ?? { id: row.playerId, name: row.name };
      const current = gameText(row, titles);
      const previous = gameText({ gameId: row.previousGameId, gameName: row.previousGameName }, titles);
      const switching = current && previous && (row.gameId ?? current) !== (row.previousGameId ?? previous);
      return <li key={row.rowId} className={row.kind === 'gap' ? 'gap-event' : ''}>
        <span className="event-marker" />
        {people && <Avatar person={person} />}
        <div className="event-meta">
          <time dateTime={new Date(row.at).toISOString()}>{clock(row.at)}</time>
          {row.kind === 'gap' && <span>至 {row.endedAt === null ? '恢复采集前' : clock(row.endedAt)}</span>}
          {people && <span className="event-person">{row.name}</span>}
        </div>
        <div className="event-text">
          {people && (current || previous) && <span className="event-games">
            {switching && <><span title={previous}><GamePicture id={row.previousGameId} /></span><Icon name="arrow" size={12} /></>}
            <span title={current || previous}><GamePicture id={current ? row.gameId : row.previousGameId} /></span>
          </span>}
          <span>{describeActivity(row, titles)}</span>
        </div>
      </li>;
    })}
  </ol>;
}
