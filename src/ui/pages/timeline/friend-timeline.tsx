import { useState } from 'react';
import type { Friend, GameSession, RangeDays } from '../../../shared';
import { Badge } from '../../components/feedback';
import { Totals } from '../../components/game-totals';
import { GapThreshold } from '../../components/gap-controls';
import { Avatar } from '../../components/media';
import { api, errorText } from '../../lib/api';
import { dateTime, localDateInput } from '../../lib/format';
import { useGameTitles, useLoadGameTitles } from '../../lib/game-titles';
import { gameText } from '../../lib/model';
import { useReport } from '../../lib/use-report';
import { HorizontalTrack } from './horizontal-track';
import { PlaytimeExperiment } from './playtime-experiment';

const ranges: [RangeDays, string][] = [[0.25, '6 小时'], [1, '24 小时'], [7, '7 天'], [30, '30 天']];

function RangeSelector({ range, change }: { range: RangeDays; change: (value: RangeDays) => void }) {
  return <div className="segmented" aria-label="时间范围">{ranges
    .map(([value, text]) => <button key={value} aria-pressed={range === value} onClick={() => change(value)}>{text}</button>)}</div>;
}

export function FriendTimeline({ friend, version, demo, gapMinutes, preferredGapMinutes, activePage, session, onBack, onInspect, onError }: {
  friend: Friend; version: number; demo: boolean; gapMinutes: number; preferredGapMinutes: number; activePage: boolean; session?: GameSession;
  onBack: () => void; onInspect?: () => void; onError: (text: string) => void;
}) {
  const [range, setRange] = useState<RangeDays>(0.25);
  const [showDay, setShowDay] = useState(Boolean(session));
  const titles = useGameTitles();
  useLoadGameTitles([friend.gameId]);
  const dayValue = session && showDay ? localDateInput(new Date(session.start)) : undefined;
  const report = useReport(friend.id, dayValue ? 1 : range, version, onError, dayValue, activePage);
  return <section className="page">
    <button className="link" onClick={onBack}>{session ? '‹ 返回按日回顾' : '‹ 返回好友'}</button>
    <div className="page-heading timeline-page-heading">
      <div className="timeline-person"><Avatar person={friend} big /><div>
        <h1>{friend.name}</h1><Badge friend={friend} /> {gameText(friend) && <span>{gameText(friend, titles)}</span>}</div></div>
      {dayValue ? <button onClick={() => setShowDay(false)}>查看近期活动</button> : <RangeSelector range={range} change={setRange} />}
    </div>
    {report && <>
      <section className="panel track-panel"><div className="summary-header">
        <div><h2>活动时间轴</h2><p className="muted">{dateTime(report.start)} – {dateTime(report.end)}</p></div>
        {dayValue && onInspect ? <button onClick={onInspect}>在活动页查看事件</button> : <span className="coverage">首次观测时间</span>}
      </div><GapThreshold minutes={gapMinutes} preferred={preferredGapMinutes} onError={onError} />
        <HorizontalTrack key={dayValue ?? range} report={report} gapMinutes={gapMinutes} session={dayValue ? session : undefined}
          friendId={friend.id} mode={demo ? 'demo' : 'live'} version={version} activePage={activePage} onError={onError} /></section>
      <Totals report={report} global={false} />
    </>}
    <PlaytimeExperiment friend={friend} version={version} demo={demo} events={report?.playtimeEvents ?? []} onError={onError} />
    <button className="link" onClick={() => void api.clearHistory(friend.id).catch(error => onError(errorText(error)))}>清除该好友历史</button>
  </section>;
}
