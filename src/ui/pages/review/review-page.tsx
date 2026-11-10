import { useState } from 'react';
import type { Friend, GameSession, RangeDays } from '../../../shared';
import { Empty } from '../../components/feedback';
import { Totals } from '../../components/game-totals';
import { Icon } from '../../components/icon';
import { Avatar, GamePicture } from '../../components/media';
import { clock, dateTime, day, duration, localDateInput } from '../../lib/format';
import { useGameTitles } from '../../lib/game-titles';
import { gameText } from '../../lib/model';
import { useReport } from '../../lib/use-report';

export function ReviewPage({ friends, version, activePage, onSession, onError }: {
  friends: Friend[]; version: number; activePage: boolean; onSession: (session: GameSession) => void; onError: (text: string) => void;
}) {
  const titles = useGameTitles();
  const [range, setRange] = useState<RangeDays>(7);
  const [daily, setDaily] = useState(false);
  const today = localDateInput(new Date());
  const [date, setDate] = useState(today);
  const [player, setPlayer] = useState('');
  const byId = new Map(friends.map(friend => [friend.id, friend]));
  const selected = daily && byId.has(player) ? player : null;
  const report = useReport(selected, daily ? 1 : range, version, onError, daily ? date : undefined, activePage);
  return <section className="page">
    <div className="page-heading"><h1>回顾</h1>
      <div className="segmented" aria-label="回顾范围">
        <button aria-pressed={daily} onClick={() => setDaily(true)}>按日</button>
        <button aria-pressed={!daily && range === 7} onClick={() => { setDaily(false); setRange(7); }}>7 天</button>
        <button aria-pressed={!daily && range === 30} onClick={() => { setDaily(false); setRange(30); }}>30 天</button>
      </div>
    </div>
    {daily && <div className="panel history-filters day-filters">
      <label>日期<input type="date" value={date} max={today} onChange={event => {
        if (event.target.value && event.target.value <= today && event.target.validity.valid) setDate(event.target.value);
      }} /></label>
      <label>好友<select value={selected ?? ''} onChange={event => setPlayer(event.target.value)}>
        <option value="">全部好友</option>
        {friends.map(friend => <option key={friend.id} value={friend.id}>{friend.name}</option>)}
      </select></label>
    </div>}
    {report && <>
      <Totals report={report} global={!selected} />
      {daily && <section className="panel summary-panel"><div className="summary-header"><div><h2>{day(report.start)} · 游戏时段</h2>
        <p className="muted">跨零点按天拆分。同一游戏在收起的缺口两侧合并显示，时长只累计观测到的部分。</p></div></div>
        {!report.sessions?.length ? <Empty title="当天暂无游戏时段" detail="所选日期内没有观测到可计算的游戏时段。" /> :
          <ul className="report-games daily-sessions">{report.sessions.slice(0, 200).map(session => <li key={session.playerId + ':' + session.start}>
            <button className="daily-session-link" type="button" onClick={() => onSession(session)}>
            <Avatar person={byId.get(session.playerId) ?? { id: session.playerId, name: session.playerName }} />
            <span>{session.playerName}</span><GamePicture id={session.gameId} />
            <strong>{gameText({ gameId: session.gameId, gameName: session.gameName }, titles)}</strong>
            <span className="muted">{clock(session.start)} – {session.end === report.end && new Date(report.end).getDate() !== new Date(report.start).getDate()
              ? '24:00' : clock(session.end)}</span><span>{duration(session.observedMs / 60_000)}</span>
            <Icon name="arrow" size={15} /></button>
          </li>)}</ul>}
        {(report.sessions?.length ?? 0) > 200 && <p className="muted">这里显示最近 200 段，游戏时长汇总包含当天全部时段。</p>}
      </section>}
      {!selected && <section className="panel summary-panel"><div className="summary-header"><div><h2>共同游玩时段</h2>
        <p className="muted">最近 50 个重叠时段。记录表示同时显示在同一游戏。</p></div></div>
        {!report.shared.length ? <Empty title="暂无重叠时段" detail="所选范围内没有观察到两人同时玩同一游戏。" /> :
          <ul className="report-games">{report.shared.map((row, index) => <li key={index}><strong>{row.game}</strong>
            <span>{row.names.join('、')}</span><span className="muted">{dateTime(row.start)} – {dateTime(row.end)}</span></li>)}</ul>}
      </section>}
    </>}
  </section>;
}
