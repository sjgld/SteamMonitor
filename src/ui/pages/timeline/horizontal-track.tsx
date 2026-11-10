import { useId, useState } from 'react';
import { type ActivityWindow, displayBands, type GameSession, type GapRecord, type PlaytimeEvent, presenceLabels, type Report, type Snapshot, type Span } from '../../../shared';
import { RemoveGapButton } from '../../components/gap-controls';
import { GamePicture } from '../../components/media';
import { PlaytimeEvents } from '../../components/playtime-events';
import { bandHeight, bandRowHeight, bandTop, durationY, growthRowHeight, growthY, spanLabel, TimelineBandMark, timelineInset, usePlotWidth } from '../../components/timeline-band';
import { clock, dateTime, segmentDuration } from '../../lib/format';
import { useGameTitles, useLoadGameTitles } from '../../lib/game-titles';
import { gameText } from '../../lib/model';
import { minTimelineWindow, placeWindow, timeInView, useTimelineNavigation } from '../../lib/timeline-navigation';
import { useReport } from '../../lib/use-report';

const states: Record<Span['state'], string> = { ...presenceLabels, gap: '采集缺口', empty: '无观测' };

const legend: Span['state'][] = ['online', 'away', 'busy', 'offline', 'unknown', 'gap', 'empty'];

const trackLeft = 80;

const axisHeight = 29;

function trackPlot(element: SVGSVGElement) {
  const rect = element.getBoundingClientRect();
  return { left: rect.left + trackLeft, width: Math.max(1, rect.width - trackLeft - timelineInset) };
}

const gapKey = (gap: GapRecord) => `${gap.rowId}:${gap.at}`;

export function HorizontalTrack({ report: latest, gapMinutes, session, friendId, mode, version, activePage, onError }: {
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
          <rect width="7" height="7" fill="var(--hatch-a)" /><rect width="2" height="7" fill="var(--hatch-b)" />
        </pattern></defs>
        {ticks.map((at, index) => <g key={at}>
          <line className="board-gridline" x1={x(at)} x2={x(at)} y1={axisHeight} y2={height} />
          <text className="track-label" x={x(at)} y="18" textAnchor={index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'}>
            {spanLength <= 86_400_001 ? clock(at) : dateTime(at)}
          </text>
        </g>)}
        <g transform={`translate(0,${axisHeight})`}>
        <text className="track-label" x="4" y={bandTop + 14}>状态 / 游戏</text>
        <text className="track-label" x="4" y={durationY}>观测时长</text>
        <rect className="board-track" x={left} y={bandTop} width={width} height={bandHeight} rx={3} />
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
