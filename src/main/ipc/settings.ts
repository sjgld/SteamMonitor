import { app, dialog } from 'electron';
import { constants } from 'node:fs';
import { copyFile, mkdtemp, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import type { MonitorHandlers } from '../../shared';
import { startupArgs, startupName } from '../paths';
import { parsePreferences } from '../preferences';
import type { Runtime } from '../runtime';

/** Notification and retention preferences, auto-start, backup and restore. */
export function settingsHandlers(rt: Runtime) {
  return {
    preferences: () => rt.preferences,
    savePreferences: async input => {
      const settings = parsePreferences(input);
      if (settings.notices.online || settings.notices.game || settings.notices.party) await rt.notifier.prepare();
      if (settings.autoStart !== rt.preferences.autoStart) {
        if (!app.isPackaged) throw new Error('请从便携版设置开机启动。');
        app.setLoginItemSettings({ openAtLogin: settings.autoStart, name: startupName, path: process.execPath, args: startupArgs });
        if (app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin !== settings.autoStart) {
          throw new Error('Windows 未保存开机启动设置。');
        }
      }
      rt.live.setPreference('retentionDays', String(settings.retentionDays));
      rt.live.setPreference('notices', JSON.stringify(settings.notices));
      rt.preferences = settings;
      rt.prune();
      rt.changed();
    },
    testNotice: async () => {
      await rt.notifier.prepare();
      await rt.notifier.send('SteamMonitor 测试通知', 'Windows 系统通知已接通。');
    },
    backup: async () => {
      const { canceled, filePath } = await dialog.showSaveDialog(rt.window!, {
        title: '备份 Steam 数据', defaultPath: 'SteamMonitor-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite',
        filters: [{ name: 'SteamMonitor SQLite', extensions: ['sqlite'] }],
      });
      if (canceled || !filePath) return false;
      const directory = await mkdtemp(path.join(rt.userData, 'backup-'));
      const temporary = path.join(directory, 'backup.sqlite');
      try {
        rt.live.backup(temporary);
        await copyFile(temporary, filePath, constants.COPYFILE_EXCL);
        return true;
      } catch {
        throw new Error('备份失败。请选择一个新的文件名和可写目录。');
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
        await rmdir(directory).catch(() => {});
      }
    },
    restore: async () => {
      const { canceled, filePaths } = await dialog.showOpenDialog(rt.window!, {
        title: '选择 SteamMonitor 备份', properties: ['openFile'],
        filters: [{ name: 'SteamMonitor SQLite', extensions: ['sqlite'] }],
      });
      if (canceled || !filePaths[0]) return false;
      const { response } = await dialog.showMessageBox(rt.window!, {
        type: 'warning', message: '用备份替换本机的 Steam 好友名单和活动历史？',
        detail: 'API Key 和其他设置会保留。自动时长采样需重新启用。', buttons: ['取消', '替换'], cancelId: 0, defaultId: 0,
      });
      if (response !== 1) return false;
      rt.maintenance = true;
      rt.syncPolling();
      try {
        rt.live.restore(filePaths[0]);
        rt.live.gap(Date.now(), '恢复备份后的采集间隔', true);
        rt.prune();
        return true;
      } catch {
        throw new Error('无法恢复此备份。请选择 SteamMonitor 生成的备份文件；较新版本的备份需要先升级程序。');
      } finally {
        rt.maintenance = false;
        rt.syncPolling();
      }
    },
  } satisfies Partial<MonitorHandlers>;
}
