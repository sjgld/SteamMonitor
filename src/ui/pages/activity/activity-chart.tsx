import { Brush } from '@visx/brush';
import { scaleLinear, scaleTime } from '@visx/scale';
import { type KeyboardEvent, useId, useMemo, useRef } from 'react';
import type { ActivityBoard, ActivityWindow, DisplayBand, Friend, Span } from '../../../shared';
import { Avatar } from '../../components/media';
import { bandHeight, bandRowHeight, bandTop, growthRowHeight, growthY, TimelineBandMark, timelineInset, usePlotWidth } from '../../components/timeline-band';
import { clock, dateTime } from '../../lib/format';
import { useGameTitles } from '../../lib/game-titles';
import { gameText } from '../../lib/model';
import { minTimelineWindow, placeWindow, timeInView, useTimelineNavigation } from '../../lib/timeline-navigation';

export type Growth = ActivityBoard['playtime'][number];

export type BoardSpan = ActivityBoard['tracks'][number]['spans'][number];

export type Focus = { playerId: string; at: number; key?: string; span?: BoardSpan; growth?: Growth[] };

const plotInset = timelineInset;

const hour = 3_600_000;

const dayMs = 24 * hour;

const overviewHeight = 47;

const overviewY = scaleLinear({ domain: [0, 1], range: [overviewHeight, 0] });

export const growthKey = (growth: Growth) => 'p-' + growth.rowId;

export const activityKey = (id: number) => 'a-' + id;

function laneLabelWidth(element: HTMLDivElement | null) {
  return element ? Number.parseFloat(getComputedStyle(element).getPropertyValue('--board-label-width')) || 146 : 146;
}

function lanePlot(element: HTMLDivElement) {
  const labelWidth = laneLabelWidth(element);
  return { left: element.getBoundingClientRect().left + labelWidth + plotInset,
    width: Math.max(1, element.clientWidth - labelWidth - 2 * plotInset) };
}

function timeScale({ from, until }: ActivityWindow, width: number) {
  return scaleTime({ domain: [new Date(from), new Date(until)], range: [0, width] });
}

function gameMatches(span: Span, game: string, titles: ReadonlyMap<string, string>) {
  const query = game.toLowerCase();
  return !game || span.gameId === game || Boolean(span.gameName?.toLowerCase().includes(query)) ||
    gameText(span, titles).toLowerCase().includes(query);
}

function overviewCounts(tracks: ActivityBoard['tracks'], window: ActivityWindow, game: string, bins: number, titles: ReadonlyMap<string, string>) {
  const counts = Array<number>(bins).fill(0);
  const step = (window.until - window.from) / bins;
  for (const { spans } of tracks) {
    const played = new Set<number>();
    for (const span of spans) {
      if (!gameText(span) || !gameMatches(span, game, titles)) continue;
      const first = Math.max(0, Math.floor((span.start - window.from) / step));
      const last = Math.min(bins, Math.ceil((span.end - window.from) / step));
      for (let index = first; index < last; index++) played.add(index);
    }
    for (const index of played) counts[index]++;
  }
  return counts;
}

export function Overview({ tracks, base, view, game, onView }: {
  tracks: ActivityBoard['tracks']; base: ActivityWindow; view: ActivityWindow; game: string;
  onView: (window: ActivityWindow) => void;
}) {
  const { ref, width } = usePlotWidth();
  const titles = useGameTitles();
  const dragged = useRef(false);
  const inner = Math.max(1, width - 2 * plotInset);
  const bins = Math.max(18, Math.min(96, Math.floor(inner / 8)));
  const counts = useMemo(() => overviewCounts(tracks, base, game, bins, titles), [tracks, base, game, bins, titles]);
  const peak = Math.max(0, ...counts);
  const x = timeScale(base, inner);
  const step = inner / bins;
  return <div className="board-overview">
    <div className="board-overview-heading"><strong>游戏活动概览</strong><span>每格统计有游戏记录的好友数 · 峰值 {peak} 人</span></div>
    <div className="board-brush" ref={ref}>
      {width > 20 && <svg width={width} height={overviewHeight} aria-label="拖选要放大的时间范围，或点选以移动当前范围"
        onPointerDown={() => { dragged.current = false; }}
        onClick={event => {
          if (dragged.current || view.until - view.from >= base.until - base.from) return;
          const left = event.currentTarget.getBoundingClientRect().left;
          const at = +x.invert(Math.max(0, Math.min(inner, event.clientX - left - plotInset)));
          onView(placeWindow(base, at - (view.until - view.from) / 2, view.until - view.from));
        }}>
        <g transform={`translate(${plotInset},0)`}>
          {counts.map((count, index) => {
            const height = count ? count / peak * (overviewHeight - 8) : 2;
            return <rect key={index} className={count ? 'board-bin' : 'board-bin-empty'} x={index * step}
              y={overviewHeight - height - 3} width={Math.max(1, step - 2)} height={height} rx={1.5} />;
          })}
          <rect className="board-viewport" x={x(view.from)} y={1} width={Math.max(1, x(view.until) - x(view.from))}
            height={overviewHeight - 2} rx={4} />
          <Brush xScale={x} yScale={overviewY} width={inner} height={overviewHeight} brushDirection="horizontal"
            resetOnEnd useWindowMoveEvents resizeTriggerAreas={[]} disableDraggingSelection
            selectedBoxStyle={{ fill: 'var(--text-1)', fillOpacity: 0.16, stroke: 'var(--text-1)', strokeWidth: 1 }}
            onBrushEnd={bounds => {
              if (!bounds || bounds.x1 - bounds.x0 < minTimelineWindow) return;
              dragged.current = true;
              onView(placeWindow(base, bounds.x0, bounds.x1 - bounds.x0));
            }} />
        </g>
      </svg>}
    </div>
    <div className="board-overview-labels"><time>{dateTime(base.from)}</time><span>拖动框选 · 放大后可点选跳转</span><time>{dateTime(base.until)}</time></div>
  </div>;
}

function activate(event: KeyboardEvent<SVGGElement>, action: () => void) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  action();
}

function clusterGrowth(events: Growth[], x: ReturnType<typeof timeScale>) {
  const groups = new Map<number, Growth[]>();
  for (const event of events) {
    const cell = Math.floor(x(event.at) / 22);
    const group = groups.get(cell);
    if (group) group.push(event);
    else groups.set(cell, [event]);
  }
  return [...groups.values()];
}

export function Lanes({ board, bands, people, base, view, focus, game, axisVersion, idPrefix, onFocus, onView }: {
  board: ActivityBoard; people: ReadonlyMap<string, Friend>; base: ActivityWindow; view: ActivityWindow; focus: Focus | null;
  bands: ReadonlyMap<string, DisplayBand<BoardSpan>[]>;
  game: string; axisVersion: number; idPrefix: string;
  onFocus: (focus: Focus | null) => void; onView: (window: ActivityWindow) => void;
}) {
  const navigation = useTimelineNavigation<HTMLDivElement>({
    base, view, plot: lanePlot, onView, onClear: () => onFocus(null), selectedAt: focus?.at,
  });
  const titles = useGameTitles();
  const { width } = usePlotWidth(navigation.ref);
  const pattern = useId();
  const inner = Math.max(1, width - laneLabelWidth(navigation.ref.current) - 2 * plotInset);
  const x = timeScale(view, inner);
  const labelTime = view.until - view.from >= dayMs ? dateTime : clock;
  const tickInset = labelTime === dateTime ? 82 : 46;
  const ticks = x.ticks(Math.max(2, Math.floor(inner / 118))).filter(tick => x(tick) >= tickInset && x(tick) <= inner - tickInset);
  const growthByFriend = useMemo(() => {
    const byFriend = new Map<string, Growth[]>();
    for (const event of board.playtime) {
      if (event.at < view.from || event.at >= view.until) continue;
      const list = byFriend.get(event.playerId);
      if (list) list.push(event);
      else byFriend.set(event.playerId, [event]);
    }
    return byFriend;
  }, [board.playtime, view.from, view.until]);
  const hoverX = navigation.hover ? x(navigation.hover.at) : null;
  const hoverLabel = navigation.hover?.label;
  const preview = navigation.hover ? clock(navigation.hover.at) + (hoverLabel ? ' · ' + (hoverLabel.length > 16 ? hoverLabel.slice(0, 15) + '…' : hoverLabel) : '') : '';
  const previewHalf = hoverLabel ? 106 : 26;
  return <div className={`board-lanes timeline-surface${navigation.canPan ? ' can-pan' : ''}${navigation.dragging ? ' is-dragging' : ''}`}
    ref={navigation.ref} tabIndex={0} role="region" aria-label="好友时间轴，方向键平移，加减键缩放"
    {...navigation.handlers}>
    <div className="board-lane board-axis">
      <span className="board-lane-label">好友</span>
      <svg width={inner + 2 * plotInset} height={31} aria-label="共享时间刻度">
        <g transform={`translate(${plotInset},0)`}>
          <g key={axisVersion} className={axisVersion ? 'axis-change' : undefined}>
          {inner >= tickInset * 2 && <>
            <text x={0} y={20}>{labelTime(view.from)}</text>
            <text x={inner} y={20} textAnchor="end">{labelTime(view.until)}</text>
          </>}
          {ticks.map(tick => <text key={+tick} x={x(tick)} y={20} textAnchor="middle">
            {labelTime(+tick)}
          </text>)}</g>
          {hoverX !== null && <g className="board-hover-label"
            transform={`translate(${Math.max(previewHalf, Math.min(inner - previewHalf, hoverX))},0)`}>
            <rect x={-previewHalf} y={5} width={2 * previewHalf} height={21} rx={4} /><text y={20} textAnchor="middle">{preview}</text>
          </g>}
        </g>
      </svg>
    </div>
    {board.tracks.map(({ playerId }) => {
      const person = people.get(playerId);
      if (!person) return null;
      const selected = focus?.playerId === playerId ? focus : null;
      const clusters = clusterGrowth(growthByFriend.get(playerId) ?? [], x);
      const rowHeight = clusters.length ? growthRowHeight : bandRowHeight;
      return <div className={`board-lane${selected ? ' is-selected' : ''}`} key={playerId} id={idPrefix + 'board-player-' + playerId} tabIndex={-1}>
        <div className="board-lane-label" title={person.name}><Avatar person={person} /><strong>{person.name}</strong></div>
        <svg width={inner + 2 * plotInset} height={rowHeight} aria-label={person.name + '的活动泳道'}>
          <defs><pattern id={pattern + playerId} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width={6} height={6} fill="var(--hatch-a)" /><rect width={2} height={6} fill="var(--hatch-b)" />
          </pattern></defs>
          <g transform={`translate(${plotInset},0)`}>
            <rect className="board-track" y={bandTop} width={inner} height={bandHeight} rx={3} />
            {ticks.map(tick => <line className="board-gridline" key={+tick} x1={x(tick)} x2={x(tick)} y2={rowHeight} />)}
            {bands.get(playerId)?.map((band, index, lane) => {
              const start = Math.max(view.from, band.paintStart ?? band.start);
              const end = Math.min(view.until, band.paintEnd ?? band.end);
              if (end <= start || (band.state !== 'gap' && !gameMatches(band, game, titles))) return null;
              const keys = band.parts.flatMap(part => part.sourceId === undefined ? [] : [activityKey(part.sourceId)]);
              const focused = Boolean(selected && (band.parts.some(part => part.start === selected.span?.start) ||
                (selected.key && keys.includes(selected.key))));
              return <TimelineBandMark key={band.start} band={band} start={x(start)} width={x(end) - x(start)}
                joined={band.paintEnd !== undefined || band.paintStart !== undefined || lane[index - 1]?.paintEnd === band.start}
                pattern={pattern + playerId} eventKeys={keys.join(' ')} titles={titles} focused={focused}
                onSelect={event => {
                  const box = event?.currentTarget.ownerSVGElement?.getBoundingClientRect();
                  const position = event?.detail && box ? +x.invert(event.clientX - box.left - plotInset) : start;
                  const at = Math.max(start, Math.min(end - 1, position));
                  const span = band.parts.find(part => part.start <= at && part.end > at) ??
                    (at >= band.end ? band.parts.at(-1)! : band.parts[0]);
                  onFocus({ playerId, at, span, key: span.sourceId === undefined ? undefined : activityKey(span.sourceId) });
                }} />;
            })}
            {hoverX !== null && <line className="board-hover-line" x1={hoverX} x2={hoverX} y2={rowHeight} />}
            {selected && timeInView(view, selected.at) &&
              <line className="board-cursor" x1={x(selected.at)} x2={x(selected.at)} y1={3} y2={rowHeight - 3} />}
            {clusters.map(group => {
              const mark = group[0];
              const active = group.some(event => growthKey(event) === selected?.key);
              const choose = () => onFocus({ playerId, at: mark.at, key: growthKey(mark), growth: group });
              const label = group.length === 1
                ? `${gameText({ gameId: mark.appId, gameName: mark.name }, titles)} +${mark.minutes} 分钟`
                : `${group.length} 条时长增长`;
              return <g key={mark.rowId} transform={`translate(${x(mark.at)},${growthY})`}
                className={`board-growth${active ? ' is-focused' : ''}`} data-board-growth
                data-timeline-label={label} data-timeline-event={group.map(event => growthKey(event)).join(' ')}
                role="button" tabIndex={0} aria-label={label} aria-pressed={active}
                onClick={choose} onKeyDown={event => activate(event, choose)}>
                <title>{label} · {dateTime(mark.at)}</title>
                <rect className="board-growth-hit" x={-11} y={-8} width={22} height={16} />
                {group.length === 1 ? <path d="M0 -5 L5 0 L0 5 L-5 0 Z" /> :
                  <><rect x={-10} y={-7} width={20} height={14} rx={5} /><text y={3.5} textAnchor="middle">{group.length}</text></>}
              </g>;
            })}
          </g>
        </svg>
      </div>;
    })}
  </div>;
}
