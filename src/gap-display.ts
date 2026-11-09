import type { Activity, ActivityBoard, Span } from './shared';

export const defaultGapThreshold = 3;
export const maxGapThreshold = 60;

export function validGapThreshold(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maxGapThreshold;
}

export function shortGap(duration: number | undefined, minutes: number) {
  return minutes > 0 && duration !== undefined && duration >= 0 && duration <= minutes * 60_000;
}

export function gapDisplay(spans: Span[], index: number, minutes: number) {
  const gap = spans[index];
  if (gap.state !== 'gap' || (!gap.gapRecord?.removed && !shortGap(gap.gapDuration, minutes))) return 'show';
  const before = spans[index - 1];
  const after = spans[index + 1];
  if (before && after && before.end === gap.start && gap.end === after.start &&
      before.state !== 'empty' && before.state !== 'gap' && after.state !== 'empty' && after.state !== 'gap') {
    const game = before.gameId ?? before.gameName;
    if (game === (after.gameId ?? after.gameName) && (game !== null || before.state === after.state)) return 'bridge';
  }
  return 'hide';
}

export function hideGapEvent(row: Activity, recoveries: ActivityBoard['unchangedRecoveries'], minutes: number) {
  if (row.kind === 'gap') return Boolean(row.gapRemoved) || (row.endedAt !== null && shortGap(row.endedAt - row.at, minutes));
  const recovery = recoveries[row.rowId];
  return Boolean(recovery?.removed) || shortGap(recovery?.duration, minutes);
}

export type DisplayBand<T extends Span> = T & { parts: T[]; elapsed: number; hidden: number; paintStart?: number; paintEnd?: number };

export function displayBands<T extends Span>(spans: T[], minutes: number): DisplayBand<T>[] {
  const bands: DisplayBand<T>[] = [];
  let paintStart: number | undefined;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index];
    if (span.state === 'empty') continue;
    const display = gapDisplay(spans, index, minutes);
    const band = bands.at(-1);
    if (display === 'hide') {
      if (span.gapRecord?.removed) {
        if (band && band.state !== 'gap' && (band.paintEnd ?? band.end) === span.start) {
          band.paintEnd = span.end;
        } else if (spans[index + 1] && spans[index + 1].start === span.end &&
            spans[index + 1].state !== 'gap' && spans[index + 1].state !== 'empty') {
          paintStart = span.start;
        }
      }
      continue;
    }
    if (display === 'bridge' && band) {
      const after = spans[++index];
      band.parts.push(after);
      band.end = after.end;
      delete band.paintEnd;
      band.elapsed += after.end - after.start;
      band.hidden += span.end - span.start;
    } else {
      bands.push({ ...span, parts: [span], elapsed: span.end - span.start, hidden: 0, paintStart });
    }
    paintStart = undefined;
  }
  return bands;
}
