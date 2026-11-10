import { dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import type { ActivityBoard, MonitorHandlers } from '../../shared';
import { activityTracks, buildReport, calendarDayRange, dayMs, unchangedRecoveries } from '../data/analytics';
import { toCsv } from '../data/csv';
import type { Runtime } from '../runtime';
import { checkBoardWindow, checkFilter, checkGapTarget, checkId, checkRange, checkReportWindow } from './validate';

/** Activity events, the multi-friend board, reports, CSV export and gap removal. */
export function historyHandlers(rt: Runtime) {
  return {
    activity: filter => rt.currentStore().activity(checkFilter(filter), 200, rt.assets.matchIds(filter.game)),
    activityBoard: (filter): ActivityBoard => {
      checkFilter(filter);
      checkBoardWindow(filter);
      const { from, until, playerId } = filter;
      const store = rt.currentStore();
      const friends = store.friends().filter(friend => !playerId || friend.id === playerId);
      const history = store.historyRange(from, until, playerId);
      const localized = rt.assets.matchIds(filter.game);
      return {
        tracks: activityTracks(history, friends, filter),
        events: store.activity(filter, undefined, localized),
        playtime: store.playtimeRange(filter, undefined, localized),
        unchangedRecoveries: unchangedRecoveries(history),
      };
    },
    exportActivity: async filter => {
      checkFilter(filter);
      const store = rt.currentStore();
      const { canceled, filePath } = await dialog.showSaveDialog(rt.window!, {
        title: '导出活动记录',
        defaultPath: `SteamMonitor-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (canceled || !filePath) return false;
      await writeFile(filePath, toCsv(store.activity(filter, undefined, rt.assets.matchIds(filter.game))), 'utf8');
      return true;
    },
    report: (id, days, calendarDay, fixed) => {
      if (id !== null) checkId(id);
      checkRange(days);
      const store = rt.currentStore();
      const now = Date.now();
      checkReportWindow(fixed, id, calendarDay, now);
      const { start, end } = fixed ? { start: fixed.from, end: fixed.until } : calendarDay === undefined
        ? { start: now - days * dayMs, end: now } : calendarDayRange(calendarDay, now);
      const report = buildReport(store.historyRange(start, end, id ?? undefined),
        store.friends().filter(friend => id === null || friend.id === id), start, end, id !== null, calendarDay !== undefined,
        rt.gapThreshold());
      return id === null ? report : { ...report, playtimeEvents: store.playtimeEvents(id, start, calendarDay ? end - 1 : end) };
    },
    previewGapBatch: (expectedMode, anchor) => {
      checkGapTarget(anchor);
      if (expectedMode !== rt.mode || rt.maintenance || rt.quitting()) throw new Error('请重新选择这条缺口。');
      const batch = rt.currentStore().gapBatch(anchor);
      if (!batch) throw new Error('这条缺口已更新，请重新选择。');
      return batch;
    },
    removeGapBatch: (expectedMode, anchor, targets, scope) => {
      checkGapTarget(anchor);
      if (expectedMode !== rt.mode || rt.maintenance || rt.quitting() || !Array.isArray(targets) || !targets.length ||
          (scope !== 'single' && scope !== 'batch')) throw new Error('请重新打开缺口预览。');
      targets.forEach(checkGapTarget);
      const count = rt.currentStore().removeGapBatch(anchor, targets, scope);
      rt.changed();
      return count;
    },
    clearHistory: async id => {
      if (id !== undefined) checkId(id);
      const store = id ? rt.currentStore() : rt.live;
      const { response } = await dialog.showMessageBox(rt.window!, {
        type: 'warning', message: id ? '清除此好友的活动和公开时长对比？' : '清除所有 Steam 活动和公开时长对比？',
        detail: '保留好友名单和置顶，同时关闭所选账号的自动时长采样。', buttons: ['取消', '清除历史'], cancelId: 0, defaultId: 0,
      });
      if (response !== 1) return false;
      if (store === rt.live) rt.playtime.cancel(id);
      rt.poller.stop();
      store.clearHistory(id);
      rt.syncPolling();
      return true;
    },
  } satisfies Partial<MonitorHandlers>;
}
