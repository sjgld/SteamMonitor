import type { ActivityFilter, ActivityWindow, GapTarget, RangeDays } from '../../shared';
import { dayMs } from '../data/analytics';
import { isSteamId } from '../steam/api';

// Everything here guards values that arrive from the renderer over IPC.

export function checkId(id: unknown): asserts id is string {
  if (!isSteamId(id)) throw new Error('SteamID64 无效。');
}

export function checkGapTarget(gap: GapTarget) {
  if (!gap || !Number.isSafeInteger(gap.rowId) || gap.rowId < 1 ||
      !Number.isSafeInteger(gap.at) || !Number.isSafeInteger(gap.endedAt) || gap.endedAt < gap.at) {
    throw new Error('请选择已恢复的采集缺口。');
  }
  checkId(gap.playerId);
}

export function checkFilter(filter: ActivityFilter): ActivityFilter {
  if (!filter || typeof filter !== 'object') throw new Error('筛选条件无效。');
  if (filter.playerId !== undefined) checkId(filter.playerId);
  for (const at of [filter.from, filter.until]) {
    if (at !== undefined && (!Number.isSafeInteger(at) || at < 0 || at > 8.64e15)) throw new Error('日期无效。');
  }
  if (filter.game !== undefined && (typeof filter.game !== 'string' || filter.game.length > 160)) {
    throw new Error('游戏筛选条件无效。');
  }
  return filter;
}

/** The activity board accepts up to 31 calendar days (32 × 24 h covers a DST change). */
export function checkBoardWindow({ from, until }: ActivityWindow) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || until <= from || until - from > 32 * dayMs) {
    throw new Error('请选择有效的时间范围，最长 31 个日历日。');
  }
}

export function checkRange(days: RangeDays) {
  if (![0.25, 1, 7, 30].includes(days)) throw new Error('无效时间范围。');
}

export function checkReportWindow(fixed: ActivityWindow | undefined, id: string | null, calendarDay: string | undefined, now: number) {
  if (fixed !== undefined && (id === null || !fixed || !Number.isSafeInteger(fixed.from) ||
      !Number.isSafeInteger(fixed.until) || fixed.from < 0 || fixed.until <= fixed.from ||
      fixed.until - fixed.from > 31 * dayMs || fixed.until > now + 2 * dayMs || calendarDay !== undefined)) {
    throw new Error('无效时间范围。');
  }
}
