import { type MouseEvent, type RefObject, useLayoutEffect, useRef, useState } from 'react';
import { type DisplayBand, presenceLabels, type Span } from '../../shared';
import { dateTime, segmentDuration, timelineTextWidth } from '../lib/format';
import { gameText } from '../lib/model';
import { TimelineGamePicture } from './media';

export const bandTop = 9;

export const bandHeight = 20;

export const durationY = 48;

export const bandRowHeight = 56;

export const growthY = 64;

export const growthRowHeight = 76;

export const timelineInset = 10;

export const spanLabel = (span: Span, titles?: ReadonlyMap<string, string>) => gameText(span, titles) ||
  (span.state === 'gap' ? '采集缺口' : span.state === 'empty' ? '无记录' : presenceLabels[span.state]);

export function usePlotWidth(target?: RefObject<HTMLDivElement | null>) {
  const fallback = useRef<HTMLDivElement>(null);
  const ref = target ?? fallback;
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return { ref, width };
}

function fitLabel(label: string, space: number) {
  if (timelineTextWidth(label) <= space) return label;
  let text = '';
  for (const char of label) {
    if (timelineTextWidth(text + char + '…') > space) break;
    text += char;
  }
  return text ? text + '…' : '';
}

export function TimelineBandMark({ band, start, width, focused, pattern, titles, eventKeys, track, joined, onSelect }: {
  band: DisplayBand<Span>; start: number; width: number; focused: boolean; pattern: string;
  titles: ReadonlyMap<string, string>; eventKeys?: string; track?: boolean; joined?: boolean; onSelect: (event?: MouseEvent<SVGGElement>) => void;
}) {
  const playing = Boolean(gameText(band));
  const tone = playing ? 'playing' : band.state;
  const label = spanLabel(band, titles);
  const length = segmentDuration(band.elapsed);
  const presence = playing && band.state !== 'empty' && band.state !== 'gap' && band.parts.every(part => part.state === band.state)
    ? ' · ' + presenceLabels[band.state] : '';
  const detail = `${label}${presence} · ${length} · ${dateTime(band.start)} – ${dateTime(band.end)}` +
    (band.hidden ? ' · 已扣除 ' + segmentDuration(band.hidden) + ' 采集缺口' : '') +
    (band.paintStart !== undefined || band.paintEnd !== undefined ? ' · 已连接缺口边缘，时长按观测计算' : '');
  const space = width - 10;
  const showArtwork = playing && space >= 16;
  const textOffset = showArtwork ? 21 : 0;
  const labelSpace = space - textOffset;
  const visibleName = fitLabel(label, labelSpace);
  const showLength = width >= timelineTextWidth(length) + 6;
  return <g className={`board-band board-tone-${tone}${focused ? ' is-focused' : ''}${track ? ' track-segment' : ''}`}
    data-board-band={track ? undefined : ''} data-timeline-label={length + ' · ' + label} data-timeline-event={eventKeys}
    role="button" tabIndex={0} aria-pressed={focused} aria-label={detail} onClick={onSelect}
    onKeyDown={event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onSelect();
    }}>
    <title>{detail}</title>
    <rect className="board-band-fill" x={start} y={bandTop} width={Math.max(1, width)} height={bandHeight} rx={joined ? 0 : 3}
      fill={band.state === 'gap' ? `url(#${pattern})` : undefined} />
    {(showArtwork || visibleName) && <svg x={start + 5} y={bandTop} width={space} height={bandHeight}
      className="board-band-label" aria-hidden="true">
      {showArtwork && <TimelineGamePicture id={band.gameId} width={16} height={16} y={2} />}
      {visibleName && <svg x={textOffset} width={labelSpace} height={bandHeight}><text y={14}>{visibleName}</text></svg>}
    </svg>}
    {showLength && <text className={track ? 'track-band-duration' : 'board-band-duration'} x={start + width / 2}
      y={durationY} textAnchor="middle" aria-hidden="true">{length}</text>}
  </g>;
}
