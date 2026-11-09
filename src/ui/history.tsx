import { useEffect, useId, useState } from 'react';
import { presenceLabels, type ActivityWindow, type Friend, type GameSession, type GapRecord, type PlaytimeEvent, type PlaytimeReview, type PlaytimeWatch, type RangeDays, type Report, type Snapshot, type Span } from '../shared';
import { displayBands } from '../gap-display';
import { Avatar, Badge, Dialog, Empty, GamePicture, Icon } from './components';
import { GapThreshold, RemoveGapButton } from './gap-threshold';
import { useGameTitles, useLoadGameTitles } from './game-titles';
import { api, clock, dateTime, day, duration, errorText, gameText, localDateInput, segmentDuration } from './model';
import { minTimelineWindow, placeWindow, timeInView, useTimelineNavigation } from './timeline-navigation';
import { bandHeight, bandRowHeight, bandTop, durationY, growthRowHeight, growthY, spanLabel, TimelineBandMark, timelineInset, usePlotWidth } from './timeline-band';

const ranges: [RangeDays, string][] = [[0.25, '6 小时'], [1, '24 小时'], [7, '7 天'], [30, '30 天']];
const states: Record<Span['state'], string> = { ...presenceLabels, gap: '采集缺口', empty: '无观测' };
const legend: Span['state'][] = ['online', 'away', 'busy', 'offline', 'unknown', 'gap', 'empty'];
const matchText: Record<PlaytimeEvent['match'], string> = {
  observed: '同期有游戏记录', recent: '可能对应近期会话', unmatched: '未匹配到会话',
};

function PlaytimeEvents({ events }: { events: PlaytimeEvent[] }) {
  const titles = useGameTitles();
  return <ul className="report-games playtime-events">{events.map(event => <li key={event.rowId}>
    <GamePicture id={event.appId} /><strong>{gameText({ gameId: event.appId, gameName: event.name }, titles)}</strong><span>+{event.minutes} 分钟</span>
    <span className={event.match === 'unmatched' ? 'playtime-unmatched' : 'muted'}>{matchText[event.match]}</span>
    {event.gap && <span className="muted">期间有采集缺口</span>}
    <small>发现 {dateTime(event.at)} · 对比 {dateTime(event.from)} 的样本</small>
  </li>)}</ul>;
}

function useReport(id: string | null, range: RangeDays, version: number, onError: (text: string) => void,
  calendarDay?: string, activePage = true, fixedFrom?: number, fixedUntil?: number) {
  const key = JSON.stringify([id, range, calendarDay, fixedFrom, fixedUntil]);
  const [report, setReport] = useState<{ key: string; value: Report } | null>(null);
  useEffect(() => {
    if (!activePage) return;
    let active = true;
    const fixed = fixedFrom === undefined || fixedUntil === undefined ? undefined : { from: fixedFrom, until: fixedUntil };
    void api.report(id, range, calendarDay, fixed).then(value => { if (active) setReport({ key, value }); })
      .catch(error => { if (active) onError(errorText(error)); });
    return () => { active = false; };
  }, [id, range, version, onError, calendarDay, key, activePage, fixedFrom, fixedUntil]);
  return report?.key === key ? report.value : null;
}

function RangeSelector({ range, change }: { range: RangeDays; change: (value: RangeDays) => void }) {
  return <div className="segmented" aria-label="时间范围">{ranges
    .map(([value, text]) => <button key={value} aria-pressed={range === value} onClick={() => change(value)}>{text}</button>)}</div>;
}

const trackLeft = 80;
const axisHeight = 29;
function trackPlot(element: SVGSVGElement) {
  const rect = element.getBoundingClientRect();
  return { left: rect.left + trackLeft, width: Math.max(1, rect.width - trackLeft - timelineInset) };
}

const gapKey = (gap: GapRecord) => `${gap.rowId}:${gap.at}`;

function HorizontalTrack({ report: latest, gapMinutes, session, friendId, mode, version, activePage, onError }: {
  report: Report; gapMinutes: number; session?: GameSession; friendId: string; mode: Snapshot['mode']; onError: (text: string) => void;
  version: number; activePage: boolean;
}) {
  const gapPattern = useId();
  const [selected, setSelected] = useState<{ kind: 'span'; at: number } | { kind: 'event'; at: number; ids: number[] } | null>(
    () => session ? { kind: 'span', at: session.start } : null);
  const [frozen, setFrozen] = useState<{ report: Report; view: ActivityWindow } | null>(() => session ? {
    report: latest, view: placeWindow({ from: latest.start, until: latest.end + 1 },
      session.start - 10 * 60_000, session.end - session.start + 20 * 60_000),
  } : null);
  const updated = useReport(friendId, 1, version, onError, undefined, activePage && frozen !== null,
    frozen?.report.start, frozen?.report.end);
  const report = updated ?? frozen?.report ?? latest;
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const [removedCount, setRemovedCount] = useState(0);
  const titles = useGameTitles();
  const plot = usePlotWidth();
  useLoadGameTitles(report.spans.map(span => span.gameId));
  const base = { from: report.start, until: report.end + 1 };
  const view = frozen?.view ?? base;
  const latestRemoved = new Set(latest.spans.flatMap(span => span.gapRecord?.removed ? [gapKey(span.gapRecord)] : []));
  const bands = displayBands(report.spans.map(span => {
    const gap = span.gapRecord;
    return gap && !gap.removed && (removed.has(gapKey(gap)) || latestRemoved.has(gapKey(gap)))
      ? { ...span, gapRecord: { ...gap, removed: true } } : span;
  }), gapMinutes);
  const selection = selected?.kind === 'span' ? bands.find(band =>
    selected.at >= (band.paintStart ?? band.start) && selected.at < (band.paintEnd ?? band.end)) : null;
  const left = trackLeft;
  const width = Math.max(1, plot.width - left - timelineInset);
  const spanLength = view.until - view.from;
  const x = (at: number) => left + width * (at - view.from) / spanLength;
  const navigation = useTimelineNavigation<SVGSVGElement>({
    base, view, plot: trackPlot, onView: next => setFrozen({ report, view: next }),
    selectedAt: selected?.at, onClear: () => setSelected(null),
  });
  const events = report.playtimeEvents ?? [];
  const markers = new Map<number, PlaytimeEvent[]>();
  for (const event of events) {
    if (!timeInView(view, event.at)) continue;
    const bin = Math.floor((x(event.at) - left) / 14);
    const group = markers.get(bin);
    if (group) group.push(event);
    else markers.set(bin, [event]);
  }
  const selectedEvents = selected?.kind === 'event' ? events.filter(event => selected.ids.includes(event.rowId)) : [];
  const intervals = Math.max(2, Math.min(6, Math.floor(width / (spanLength <= 86_400_001 ? 105 : 142))));
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => view.from + (spanLength - 1) * index / intervals);
  const hasSelected = Boolean(selection || selectedEvents.length);
  const height = axisHeight + (markers.size ? growthRowHeight : bandRowHeight);
  return <>
    <div className="track-controls">
      <span className="muted">{dateTime(view.from)} – {dateTime(view.until - 1)} · {session || frozen ? '回看中' : '跟随最新'}</span>
      <div className="board-zoom">
        <button aria-label="向前平移时间轴" title="查看更早时间" disabled={view.from <= base.from} onClick={() => navigation.pan(-0.25)}>‹</button>
        <button aria-label="向后平移时间轴" title="查看更晚时间" disabled={view.until >= base.until} onClick={() => navigation.pan(0.25)}>›</button>
        <button aria-label="缩小时间轴" disabled={!navigation.canPan} onClick={() => navigation.zoom(2)}>−</button>
        <button aria-label="放大时间轴" disabled={spanLength <= minTimelineWindow} onClick={() => navigation.zoom(0.5)}>＋</button>
        <button disabled={!frozen} onClick={() => setFrozen(null)}>{session ? '查看整天' : '回到最新'}</button>
        {hasSelected && <button onClick={() => setSelected(null)}>清除选中项</button>}
      </div>
    </div>
    <div className="track-scroll" ref={plot.ref}>
      <svg className={`track timeline-surface${navigation.canPan ? ' can-pan' : ''}${navigation.dragging ? ' is-dragging' : ''}`}
        ref={navigation.ref} width={plot.width} height={height}
        role="region" tabIndex={0} aria-label="好友时间轴，方向键平移，加减键缩放" {...navigation.handlers}>
        <defs><pattern id={gapPattern} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
          <rect width="7" height="7" fill="#403847" /><rect width="2" height="7" fill="#967b9f" />
        </pattern></defs>
        {ticks.map((at, index) => <g key={at}>
          <line className="board-gridline" x1={x(at)} x2={x(at)} y1={axisHeight} y2={height} />
          <text className="track-label" x={x(at)} y="18" textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}>
            {spanLength <= 86_400_001 ? clock(at) : dateTime(at)}
          </text>
        </g>)}
        <g transform={`translate(0,${axisHeight})`}>
        <text className="track-label" x="4" y={bandTop + 16}>状态 / 游戏</text>
        <text className="track-label" x="4" y={durationY}>观测时长</text>
        <rect className="board-track" x={left} y={bandTop} width={width} height={bandHeight} rx={4} />
        {bands.map((band, index) => {
          const start = Math.max(view.from, band.paintStart ?? band.start);
          const end = Math.min(view.until, band.paintEnd ?? band.end);
          if (start >= end) return null;
          return <TimelineBandMark key={band.start} band={band} start={x(start)} width={x(end) - x(start)} track
            joined={band.paintEnd !== undefined || band.paintStart !== undefined || bands[index - 1]?.paintEnd === band.start}
            pattern={gapPattern} titles={titles} focused={selection === band}
            onSelect={event => {
              const box = event?.currentTarget.ownerSVGElement?.getBoundingClientRect();
              const position = event?.detail && box ? view.from + (event.clientX - box.left - left) / width * spanLength : start;
              setSelected({ kind: 'span', at: Math.max(start, Math.min(end - 1, position)) });
            }} />;
        })}
        {selection && [selection.start, selection.end].filter(at => at >= view.from && at <= view.until).map(at =>
          <line key={at} className="track-selection-edge" x1={x(at)} x2={x(at)} y1={bandTop - 3} y2={bandTop + bandHeight + 4} />)}
        {markers.size > 0 && <>
          <text className="track-label" x="4" y={growthY + 4}>时长增长</text>
          <line className="board-gridline" x1={left} x2={left + width} y1={growthY} y2={growthY} />
          {[...markers].map(([bin, group]) => {
            const at = group[0].at;
            const title = dateTime(at) + ' · ' + group.map(event =>
              gameText({ gameId: event.appId, gameName: event.name }, titles) + ' +' + event.minutes + ' 分钟').join('、');
            const active = selected?.kind === 'event' && group.some(event => selected.ids.includes(event.rowId));
            const show = () => setSelected({ kind: 'event', at, ids: group.map(event => event.rowId) });
            return <g key={bin} className={`track-marker${group.some(event => event.match === 'unmatched') ? ' unmatched' : ''}${active ? ' chosen' : ''}`}
              tabIndex={0} role="button" aria-pressed={active} aria-label={title} data-timeline-label={group.length > 1 ? group.length + ' 条时长增长' : group[0].name}
              onClick={show}
              onKeyDown={event => {
                if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); show(); }
              }}>
              <title>{title}</title><circle cx={x(at)} cy={growthY} r="11" className="track-marker-hit" />
              <path transform={`translate(${x(at)},${growthY})`}
                d={group.length > 1 ? 'M0 -7 L7 0 L0 7 L-7 0 Z' : 'M0 -5 L5 0 L0 5 L-5 0 Z'} className="track-marker-dot" />
            </g>;
          })}
        </>}
        </g>
        {selectedEvents.length > 0 && selected && timeInView(view, selected.at) &&
          <line className="board-cursor" x1={x(selected.at)} x2={x(selected.at)} y1={axisHeight} y2={height - 2} />}
        {navigation.hover && <g className="track-hover">
          <line className="board-hover-line" x1={x(navigation.hover.at)} x2={x(navigation.hover.at)} y1={axisHeight} y2={height} />
          <text className="track-label" x="4" y="18">{clock(navigation.hover.at)}</text>
        </g>}
      </svg>
    </div>
    <div className="track-legend board-legend">{legend.map(state =>
      <span key={state} className={'board-tone-' + state}>{states[state]}</span>)}
      <span className="board-tone-playing">游戏中</span>
      {events.length > 0 && <span className="board-tone-growth">时长增长</span>}
    </div>
    {hasSelected && selected && !timeInView(view, selected.at) && timeInView(base, selected.at) &&
      <button className="link" onClick={() => navigation.pan((selected.at - view.from) / spanLength - 0.5)}>找回选中项</button>}
    {selectedEvents.length ? <div aria-live="polite"><PlaytimeEvents events={selectedEvents} /></div> : selection ? <div className="track-readout" aria-live="polite">
      {selection.gameId && <GamePicture id={selection.gameId} large />}
      <strong>{spanLabel(selection, titles)}{gameText(selection) && selection.parts.every(part => part.state === selection.state)
        ? ' · ' + states[selection.state] : ''}</strong>
      <span>{dateTime(selection.start)} – {dateTime(selection.end)}</span>
      <strong>{selection.state === 'gap' ? '中断' : '观测'} {segmentDuration(selection.elapsed)}</strong>
      {selection.hidden > 0 && <span>已扣除 {segmentDuration(selection.hidden)} 采集缺口</span>}
      {(selection.paintStart !== undefined || selection.paintEnd !== undefined) &&
        <span>已连接缺口边缘，时长按观测计算</span>}
      <RemoveGapButton mode={mode} playerId={friendId} record={selection.gapRecord} onError={onError}
        onRemoved={gaps => {
          setRemoved(previous => new Set([...previous, ...gaps.filter(gap => gap.playerId === friendId).map(gapKey)]));
          setSelected(null);
          setRemovedCount(gaps.length);
        }} />
    </div> : <p className="muted track-readout">{removedCount > 0 ? `已删除 ${removedCount} 条缺口` : '点选区段查看详情 · Ctrl + 滚轮缩放'}</p>}
  </>;
}

function Totals({ report, global }: { report: Report; global: boolean }) {
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

function PlaytimeExperiment({ friend, demo, version, events, onError }: {
  friend: Friend; demo: boolean; version: number; events: PlaytimeEvent[]; onError: (text: string) => void;
}) {
  const titles = useGameTitles();
  const [review, setReview] = useState<PlaytimeReview | null>(null);
  const [watch, setWatch] = useState<PlaytimeWatch | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirming, setConfirming] = useState<'manual' | 'auto' | 'clear' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.all([api.playtime(friend.id), api.playtimeWatch(friend.id)]).then(([value, settings]) => {
      if (active) { setReview(value); setWatch(settings); }
    })
      .catch(error => { if (active) onError(errorText(error)); });
    return () => { active = false; };
  }, [friend.id, version, onError]);
  async function sample() {
    setConfirming(null);
    setBusy(true);
    try { setReview(await api.samplePlaytime(friend.id, consent)); }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function configure(enabled: boolean) {
    setConfirming(null);
    setBusy(true);
    try {
      await api.setPlaytimeWatch(friend.id, enabled, consent);
      setWatch(await api.playtimeWatch(friend.id));
    } catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  async function clear() {
    setConfirming(null);
    setBusy(true);
    try { await api.clearPlaytime(friend.id); setReview(null); setConsent(false); setWatch(await api.playtimeWatch(friend.id)); }
    catch (error) { onError(errorText(error)); }
    finally { setBusy(false); }
  }
  const blocked = busy || Boolean(watch?.checking) || friend.paused;
  return <section className="panel summary-panel">
    <div className="summary-header">
      <div><h2>公开游戏时长对比 <small className="experiment">实验</small></h2>
        <p className="muted">Steam 公开累计时长的增长按发现时间记录。延迟同步和采集缺口会影响匹配。</p></div>
      <div className="playtime-actions">
        {!demo && <button className={watch?.enabled ? undefined : 'primary'}
          disabled={!watch || busy || (!watch.enabled && friend.paused)} onClick={() => {
            if (watch?.enabled) void configure(false);
            else { setConsent(false); setConfirming('auto'); }
          }}>{watch?.enabled ? '关闭自动采样' : '开启自动采样'}</button>}
        <button disabled={blocked} onClick={() => demo || review || watch?.enabled ? void sample() :
          (setConsent(false), setConfirming('manual'))}>{review ? '再次采样' : '记录时长基线'}</button>
      </div>
    </div>
    {!demo && <p className="muted" role="status">{watch?.checking ? '正在采样…' : watch?.enabled
      ? watch.paused ? '自动采样已暂停' : watch.nextAt ? '下次自动采样约在 ' + dateTime(watch.nextAt) : '等待首次自动采样'
      : '自动采样关闭 · 启用后约每 30 分钟检查一次'}</p>}
    {watch?.error && <p className="message error" role="status">{watch.error}</p>}
    {review && <div className="playtime-result">
      <p>采样 {dateTime(review.at)}{review.since !== null && ' · 对比 ' + dateTime(review.since)}</p>
      {review.since === null ? <p className="muted">已保存基线。{demo ? '可再次采样查看示例。' : watch?.enabled ? '等待下一次自动采样。' : '至少 10 分钟后可再次采样。'}</p>
        : review.changes.length && !events.some(event => event.at === review.at) ? <ul className="report-games">{review.changes.map(game => <li key={game.appId}>
          <GamePicture id={game.appId} /><strong>{gameText({ gameId: game.appId, gameName: game.name }, titles)}</strong><span>+{game.minutes} 分钟</span>
          <span className="muted">{game.seen ? '时间轴有记录' : '同期未观测到此游戏'}</span>
        </li>)}</ul> : !review.changes.length && <p className="muted">两次采样之间暂无可比较的增长。</p>}
    </div>}
    {events.length > 0 && <div className="playtime-result"><h3>所选范围的时长增长</h3><PlaytimeEvents events={events} /></div>}
    {(review || events.length > 0 || watch?.enabled) && <button className="link" disabled={busy}
      onClick={() => setConfirming('clear')}>清除时长样本与历史</button>}
    {confirming === 'clear' && <Dialog title="清除公开时长记录" close={() => setConfirming(null)}>
      <p>清除这个账号的累计时长样本和增长历史，并关闭自动采样。</p>
      <footer><button className="danger" onClick={() => void clear()}>确认清除</button></footer>
    </Dialog>}
    {(confirming === 'manual' || confirming === 'auto') && <Dialog title={confirming === 'auto' ? '开启自动时长采样' : '开始公开时长对比'}
      close={() => setConfirming(null)}>
      <p className="muted">{confirming === 'auto' ? '程序运行时约每 30 分钟采样一次，首次采样建立基线。' : '采样会把该账号的 Steam 公开游戏累计分钟数保存到本机。'}</p>
      <label className="check"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} />
        这是我的账号，或账号持有人已请求保存公开游戏时长。</label>
      <footer><button className="primary" disabled={!consent}
        onClick={() => confirming === 'auto' ? void configure(true) : void sample()}>{confirming === 'auto' ? '确认开启' : '保存首次样本'}</button></footer>
    </Dialog>}
  </section>;
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
