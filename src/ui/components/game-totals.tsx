import type { Report } from '../../shared';
import { duration } from '../lib/format';
import { useGameTitles } from '../lib/game-titles';
import { gameText } from '../lib/model';
import { Empty } from './feedback';
import { GamePicture } from './media';

export function Totals({ report, global }: { report: Report; global: boolean }) {
  const titles = useGameTitles();
  return <section className="panel summary-panel">
    <div className="summary-header"><div><h2>观测到的游戏时长</h2>
      <p className="muted">{global ? '好友合计按人累加，共同时段按实际重叠计算。' : '按相邻采样估算，跳过采集缺口。'}</p></div>
      <span className="coverage">采集覆盖率 {Math.round(report.coverage * 100)}%</span></div>
    {!report.games.length ? <Empty title="暂无可统计游戏" detail="所选范围内没有观测到有效的游戏时段。" /> :
      <ul className="report-games">{report.games.map(game => <li key={game.id}>
        <GamePicture id={game.id} /><strong>{gameText({ gameId: game.id, gameName: game.name }, titles)}</strong><span>{duration(game.minutes)}</span>
        {global && <span className="muted">{game.sharedMinutes > 0 ? '共同 ' + duration(game.sharedMinutes) : '无重叠'}</span>}
      </li>)}</ul>}
  </section>;
}
