import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, protocol, safeStorage, shell, Tray } from 'electron';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ActivityBoard, ActivityFilter, ActivityWindow, GapTarget, Player, Preferences, RangeDays, Snapshot } from '../shared';
import { activityTracks, buildReport, calendarDayRange, dayMs, unchangedRecoveries } from './analytics';
import { defaultGapThreshold, validGapThreshold } from '../gap-display';
import { GameAssets } from './artwork';
import { Demo } from './demo';
import { Discovery } from './discovery';
import { Poller } from './poller';
import { PlaytimeSampler, reviewPlaytime } from './playtime';
import { defaultNotices, Notices } from './notices';
import { isSteamId, SteamApi } from './steam';
import { Store, toCsv } from './store';
import { backendFingerprint, savedUiUpdate, stageUiUpdate, stageVerifiedUi, type UiTarget } from './ui-update';
import { checkGitHubRelease, githubCredential, releasePage } from './github-update';

let window: BrowserWindow | null = null;
let gameAssets: GameAssets;
let tray: Tray | null = null;
let quitting = false;
let mode: Snapshot['mode'] = 'demo';
let paused = false;
let sleeping = false;
let key = '';
let keyBusy = false;
let keyReadError = '';
let previewSequence = 0;
let preview = new Map<string, Player>();
let live: Store;
let demoStore: Store;
let demo: Demo;
let poller: Poller;
let discovery: Discovery;
let playtimeSampler: PlaytimeSampler;
let demoUpdated: number;
let preferences: Preferences;
let maintenance = false;
const packagedUi: UiTarget = { version: app.getVersion(), index: path.join(__dirname, '../ui/index.html') };
let activeUi = packagedUi;
let trialUi: { target: UiTarget; timer: NodeJS.Timeout } | null = null;
let choosingUi = false;
let uiUpdateResult: Snapshot['uiUpdateResult'] = null;
let checkedRelease: Awaited<ReturnType<typeof checkGitHubRelease>> | null = null;
const appId = 'SteamMonitor.Local';
const startupName = 'SteamMonitor';
const startupArgs = ['--start-hidden'];
const notifications = new Set<Notification>();
const notices = new Notices((title, body) => {
  void sendNotification(title, body).catch(() => {});
});

function prune() {
  live.prune(Date.now() - preferences.retentionDays * dayMs);
}

function parsePreferences(value: Preferences): Preferences {
  const settings = value?.notices;
  const time = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
  if (!settings || !Number.isInteger(value.retentionDays) || value.retentionDays < 7 || value.retentionDays > 365 ||
    typeof value.autoStart !== 'boolean' || typeof settings.online !== 'boolean' || typeof settings.game !== 'boolean' ||
    typeof settings.party !== 'boolean' || typeof settings.friendId !== 'string' ||
    (settings.friendId && !isSteamId(settings.friendId)) || typeof settings.gameFilter !== 'string' ||
    settings.gameFilter.length > 100 || !Number.isInteger(settings.partySize) || settings.partySize < 2 || settings.partySize > 8 ||
    !Number.isInteger(settings.cooldown) || settings.cooldown < 1 || settings.cooldown > 240 ||
    typeof settings.quietStart !== 'string' || (settings.quietStart && !time.test(settings.quietStart)) ||
    typeof settings.quietEnd !== 'string' || (settings.quietEnd && !time.test(settings.quietEnd)) ||
    Boolean(settings.quietStart) !== Boolean(settings.quietEnd)) {
    throw new Error('设置无效，请检查天数、人数、冷却时间和免打扰时段。');
  }
  return {
    retentionDays: value.retentionDays, autoStart: value.autoStart, notices: {
      online: settings.online, game: settings.game, party: settings.party, friendId: settings.friendId,
      gameFilter: settings.gameFilter.trim(), partySize: settings.partySize, cooldown: settings.cooldown,
      quietStart: settings.quietStart, quietEnd: settings.quietEnd,
    },
  };
}

async function prepareNotifications() {
  if (process.platform !== 'win32') return;
  const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  await mkdir(programs, { recursive: true });
  const shortcut = path.join(programs, 'SteamMonitor.lnk');
  const args = app.isPackaged ? '' : '"' + app.getAppPath() + '"';
  if (!shell.writeShortcutLink(shortcut, { target: process.execPath, args, appUserModelId: appId })) {
    throw new Error('无法注册 Windows 通知快捷方式。');
  }
}

async function sendNotification(title: string, body: string) {
  if (!Notification.isSupported()) throw new Error('系统通知不可用。');
  await new Promise<void>((resolve, reject) => {
    const notification = new Notification({ title, body });
    notifications.add(notification);
    const timer = setTimeout(() => {
      notifications.delete(notification);
      reject(new Error('Windows 未确认通知，请检查系统通知设置。'));
    }, 4000);
    notification.once('show', () => {
      clearTimeout(timer);
      setTimeout(() => notifications.delete(notification), 5 * 60_000).unref();
      resolve();
    });
    notification.once('failed', () => {
      clearTimeout(timer);
      notifications.delete(notification);
      reject(new Error('Windows 拒绝了通知，请检查系统通知设置。'));
    });
    notification.once('close', () => notifications.delete(notification));
    notification.once('click', showWindow);
    notification.show();
  });
}

function keyFile() {
  return path.join(app.getPath('userData'), 'steam-key.enc');
}

function currentStore() {
  return mode === 'demo' ? demoStore : live;
}

function changed() {
  if (window && !window.isDestroyed()) window.webContents.send('monitor:change');
}

function invalidatePreview() {
  previewSequence += 1;
  preview = new Map();
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function refresh() {
  if (mode === 'demo') {
    demoUpdated = Date.now();
    demo.refresh(demoUpdated);
    changed();
    return Promise.resolve();
  }
  return poller.refresh();
}

function syncPolling() {
  if (mode === 'live' && !paused && !sleeping && !maintenance) {
    poller.start();
    void discovery.check();
    void playtimeSampler.tick();
  } else {
    poller.stop();
    discovery.invalidate();
    playtimeSampler.cancel();
  }
  changed();
}

function setPaused(value: boolean) {
  if (paused === value) return;
  live.setPreference('paused', String(value));
  paused = value;
  if (paused) live.gap(Date.now(), '暂停采集', true);
  syncPolling();
  updateTray();
}

function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开 SteamMonitor', click: showWindow },
    { label: mode === 'demo' ? '模拟下一次采样' : '立即刷新', enabled: mode === 'demo' || !paused,
      click: () => { void refresh(); } },
    { label: paused ? '恢复采集' : '暂停采集', enabled: mode === 'live', click: () => setPaused(!paused) },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  ]));
}

function gapThreshold() {
  const value = Number(live.preference('gapThresholdMinutes') ?? defaultGapThreshold);
  return validGapThreshold(value) ? value : defaultGapThreshold;
}

const uiUpdateRoot = () => path.join(app.getPath('userData'), 'ui-updates');
const uiBackend = () => backendFingerprint(path.resolve(__dirname, '..'), process.versions.electron);

function tryUiUpdate(target: UiTarget) {
  if (!window || quitting) return;
  const rollback = () => {
    if (trialUi?.target !== target || !window || quitting) return;
    clearTimeout(trialUi.timer);
    trialUi = null;
    live.setPreference('activeUiUpdate', activeUi.folder ?? '');
    uiUpdateResult = { text: '新版界面未能启动，已恢复之前的界面。', error: true };
    void window.loadFile(activeUi.index).catch(() => {
      activeUi = packagedUi;
      live.setPreference('activeUiUpdate', '');
      void window?.loadFile(packagedUi.index).catch(() =>
        dialog.showErrorBox('SteamMonitor 界面加载失败', '请检查程序文件是否完整。'));
    });
  };
  trialUi = { target, timer: setTimeout(rollback, 10_000) };
  void window.loadFile(target.index).catch(rollback);
}

function markUiReady() {
  if (!trialUi || window?.webContents.getURL() !== pathToFileURL(trialUi.target.index).href) return;
  live.setPreference('activeUiUpdate', trialUi.target.folder ?? '');
  clearTimeout(trialUi.timer);
  activeUi = trialUi.target;
  trialUi = null;
  uiUpdateResult = { text: `界面已更新到 ${activeUi.version}`, error: false };
  changed();
}

async function installUiUpdate() {
  if (choosingUi || trialUi || !window) return false;
  choosingUi = true;
  try {
    const selection = await dialog.showOpenDialog(window, {
      title: '选择已解压的 SteamMonitor 新版文件夹', properties: ['openDirectory'],
    });
    if (selection.canceled || quitting) return false;
    const target = await stageUiUpdate(selection.filePaths[0], uiUpdateRoot(), activeUi.version, uiBackend());
    if (quitting) return false;
    uiUpdateResult = null;
    tryUiUpdate(target);
    return true;
  } catch (error) {
    if (error instanceof SyntaxError || (error as NodeJS.ErrnoException).code) {
      throw new Error('无法读取更新包。请选择已解压的 SteamMonitor 新版文件夹。');
    }
    throw error;
  } finally {
    choosingUi = false;
  }
}

async function checkRelease() {
  if (choosingUi || trialUi) throw new Error('软件更新正在进行，请稍后再试。');
  choosingUi = true;
  checkedRelease = null;
  try {
    checkedRelease = await checkGitHubRelease(await githubCredential(app.getPath('userData')), activeUi.version, uiBackend());
    return checkedRelease.result;
  } finally {
    choosingUi = false;
  }
}

async function applyReleaseUi() {
  if (choosingUi || trialUi) throw new Error('软件更新正在进行，请稍后再试。');
  if (!checkedRelease?.bundle) throw new Error('请先检查可用的界面更新。');
  choosingUi = true;
  try {
    const target = await stageVerifiedUi(checkedRelease.bundle, uiUpdateRoot(), activeUi.version, uiBackend());
    checkedRelease = null;
    if (quitting) return;
    uiUpdateResult = null;
    tryUiUpdate(target);
  } finally {
    choosingUi = false;
  }
}

function getSnapshot(): Snapshot {
  const state = mode === 'demo'
    ? { status: 'demo' as const, detail: '使用本机示例数据。', lastCheckedAt: demoUpdated, nextCheckAt: null }
    : paused || sleeping
      ? { ...poller.state, status: 'paused' as const, detail: sleeping ? '系统休眠。' : '采集已暂停。', nextCheckAt: null }
      : { ...poller.state, detail: keyReadError || poller.state.detail };
  const friends = currentStore().friends();
  const lastSuccessAt = mode === 'demo' ? demoUpdated :
    friends.reduce((latest, friend) => Math.max(latest, friend.observedAt ?? 0), 0) || null;
  const preferred = Number(live.preference('preferredGapThresholdMinutes') ?? defaultGapThreshold);
  return { ...state, mode, hasKey: Boolean(key), paused, friends, lastSuccessAt,
    collectorVersion: packagedUi.version, uiVersion: activeUi.version, uiUpdateResult,
    gapThresholdMinutes: gapThreshold(),
    preferredGapThresholdMinutes: validGapThreshold(preferred) && preferred > 0 ? preferred : defaultGapThreshold,
    favoriteGames: currentStore().favoriteGames(), discovery: discovery.snapshot() };
}

function requireLiveApi() {
  if (mode !== 'live' || !key) throw new Error('请先切换到 Steam 数据并填写 API Key。');
  return new SteamApi(key);
}

function checkId(id: string) {
  if (!isSteamId(id)) throw new Error('SteamID64 无效。');
}

function checkGapTarget(gap: GapTarget) {
  if (!gap || !Number.isSafeInteger(gap.rowId) || gap.rowId < 1 ||
      !Number.isSafeInteger(gap.at) || !Number.isSafeInteger(gap.endedAt) || gap.endedAt < gap.at) {
    throw new Error('请选择已恢复的采集缺口。');
  }
  checkId(gap.playerId);
}

function checkFilter(filter: ActivityFilter): ActivityFilter {
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

function beginPreview(input: string) {
  if (typeof input !== 'string' || input.length > 256) throw new Error('资料链接无效。');
  const api = requireLiveApi();
  invalidatePreview();
  return { api, sequence: previewSequence };
}

function finishPreview(sequence: number, players: Player[]) {
  if (sequence !== previewSequence) throw new Error('预览已失效，请重新查询。');
  preview = new Map(players.map(player => [player.id, player]));
  return players;
}

function registerHandlers() {
  function handle<Args extends unknown[], Result>(name: string, action: (...args: Args) => Result) {
    ipcMain.handle(`monitor:${name}`, (event, ...args: Args) => {
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('无效请求。');
      }
      return action(...args);
    });
  }
  handle('snapshot', getSnapshot);
  handle('uiReady', markUiReady);
  handle('installUiUpdate', installUiUpdate);
  handle('checkRelease', checkRelease);
  handle('applyReleaseUi', applyReleaseUi);
  handle('openRelease', () => {
    const release = checkedRelease?.result;
    if (release?.kind !== 'full') throw new Error('请先检查可用的完整版本。');
    return shell.openExternal(releasePage(release.version));
  });
  handle('setGapThreshold', (minutes: number) => {
    if (!validGapThreshold(minutes)) throw new Error('请输入 0 至 60 的整数分钟。');
    const previous = gapThreshold();
    if (minutes > 0 || previous > 0) live.setPreference('preferredGapThresholdMinutes', String(minutes || previous));
    live.setPreference('gapThresholdMinutes', String(minutes));
    changed();
  });
  handle('gameTitle', (appId: string) => gameAssets.title(appId));
  handle('setMode', (value: Snapshot['mode']) => {
    if (value !== 'demo' && value !== 'live') throw new Error('无效模式。');
    if (mode === value) return;
    live.setPreference('mode', value);
    if (value === 'demo') live.gap(Date.now(), '切换到演示模式', true);
    mode = value;
    invalidatePreview();
    syncPolling();
    updateTray();
  });
  handle('setKey', async (input: string) => {
    if (typeof input !== 'string' || input.length > 128) throw new Error('API Key 格式无效。');
    const value = input.trim();
    if (value && !/^[\da-f]{32}$/i.test(value)) throw new Error('请输入 32 位十六进制 Steam Web API Key。');
    if (keyBusy) throw new Error('正在保存 API Key。');
    keyBusy = true;
    const temporary = keyFile() + '.tmp';
    try {
      if (value) {
        if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统凭据加密不可用。');
        await writeFile(temporary, await safeStorage.encryptStringAsync(value));
        await rename(temporary, keyFile());
      } else {
        await rm(keyFile(), { force: true });
      }
    } catch {
      throw new Error('无法保存或清除 API Key，请检查本机凭据存储。');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
      keyBusy = false;
    }
    if (quitting) return;
    poller.credentialsChanged();
    discovery.credentialsChanged();
    playtimeSampler.credentialsChanged();
    live.gap(Date.now(), 'API Key 已更改', true);
    key = value;
    keyReadError = '';
    invalidatePreview();
    syncPolling();
  });
  handle('refresh', refresh);
  handle('setPaused', (value: boolean) => {
    if (typeof value !== 'boolean') throw new Error('无效设置。');
    setPaused(value);
  });
  handle('previewPlayer', async (input: string) => {
    const { api, sequence } = beginPreview(input);
    const id = await api.resolve(input);
    const player = (await api.summaries([id])).get(id);
    if (!player) throw new Error('Steam 未找到该账号。');
    return finishPreview(sequence, [{ id, name: player.name, avatar: player.avatar }])[0];
  });
  handle('previewFriends', async (input: string) => {
    const { api, sequence } = beginPreview(input);
    const id = await api.resolve(input);
    const ids = await api.friendIds(id);
    const existing = new Set(live.friends().map(friend => friend.id));
    // Show IDs at preview time. Query profiles only for selected accounts.
    return finishPreview(sequence, ids.filter(friendId => !existing.has(friendId))
      .map(friendId => ({ id: friendId, name: friendId })));
  });
  handle('addPlayers', (ids: string[]) => {
    requireLiveApi();
    if (!Array.isArray(ids) || !ids.length || ids.length > 5000) throw new Error('请选择要添加的账号。');
    const players = ids.map(id => {
      const player = preview.get(id);
      if (!player) throw new Error('请先预览要添加的账号。');
      return player;
    });
    live.add(players);
    discovery.dismiss(ids);
    invalidatePreview();
    changed();
    void poller.refresh();
  });
  handle('updateFriend', (id: string, edit: { note: string; pinned: boolean; paused: boolean }) => {
    checkId(id);
    if (!edit || typeof edit.note !== 'string' || edit.note.length > 100 ||
      typeof edit.pinned !== 'boolean' || typeof edit.paused !== 'boolean') throw new Error('无效设置。');
    const store = currentStore();
    const wasPaused = store.friends().find(friend => friend.id === id)?.paused;
    store.update(id, edit.note.trim(), edit.pinned, edit.paused, Date.now());
    changed();
    if (mode === 'live' && edit.paused) playtimeSampler.cancel(id);
    if (mode === 'live' && wasPaused && !edit.paused) {
      void poller.refresh();
      void playtimeSampler.tick();
    }
  });
  handle('removeFriend', (id: string) => {
    checkId(id);
    if (mode === 'live') playtimeSampler.cancel(id);
    currentStore().remove(id);
    changed();
  });
  handle('activity', (filter: ActivityFilter) => currentStore().activity(checkFilter(filter), 200, gameAssets.matchIds(filter.game)));
  handle('activityBoard', (filter: ActivityFilter & ActivityWindow): ActivityBoard => {
    checkFilter(filter);
    const { from, until, playerId } = filter;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || until <= from || until - from > 32 * dayMs) {
      throw new Error('请选择有效的时间范围，最长 31 个日历日。');
    }
    const store = currentStore();
    const friends = store.friends().filter(friend => !playerId || friend.id === playerId);
    const history = store.historyRange(from, until, playerId);
    const localized = gameAssets.matchIds(filter.game);
    return {
      tracks: activityTracks(history, friends, filter),
      events: store.activity(filter, undefined, localized),
      playtime: store.playtimeRange(filter, undefined, localized),
      unchangedRecoveries: unchangedRecoveries(history),
    };
  });
  handle('exportActivity', async (filter: ActivityFilter) => {
    checkFilter(filter);
    const store = currentStore();
    const { canceled, filePath } = await dialog.showSaveDialog(window!, {
      title: '导出活动记录',
      defaultPath: `SteamMonitor-${new Date().toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (canceled || !filePath) return false;
    await writeFile(filePath, toCsv(store.activity(filter, undefined, gameAssets.matchIds(filter.game))), 'utf8');
    return true;
  });
  handle('openSteam', async (kind: 'profile' | 'game', id: string) => {
    if (kind === 'profile') {
      checkId(id);
      if (mode !== 'live') return;
      await shell.openExternal(`https://steamcommunity.com/profiles/${id}/`);
    } else if (kind === 'game' && typeof id === 'string' && /^[1-9]\d{0,9}$/.test(id) && Number(id) <= 0xFFFFFF) {
      await shell.openExternal(`https://store.steampowered.com/app/${id}/`);
    } else {
      throw new Error('该游戏没有可用的 Steam 商店链接。');
    }
  });
  handle('report', (id: string | null, days: RangeDays, calendarDay?: string, fixed?: ActivityWindow) => {
    if (id !== null) checkId(id);
    if (![0.25, 1, 7, 30].includes(days)) throw new Error('无效时间范围。');
    const store = currentStore();
    const now = Date.now();
    if (fixed !== undefined && (id === null || !fixed || !Number.isSafeInteger(fixed.from) ||
        !Number.isSafeInteger(fixed.until) || fixed.from < 0 || fixed.until <= fixed.from ||
        fixed.until - fixed.from > 31 * dayMs || fixed.until > now + 2 * dayMs || calendarDay !== undefined)) {
      throw new Error('无效时间范围。');
    }
    const { start, end } = fixed ? { start: fixed.from, end: fixed.until } : calendarDay === undefined
      ? { start: now - days * dayMs, end: now } : calendarDayRange(calendarDay, now);
    const report = buildReport(store.historyRange(start, end, id ?? undefined),
      store.friends().filter(friend => id === null || friend.id === id), start, end, id !== null, calendarDay !== undefined, gapThreshold());
    return id === null ? report : { ...report, playtimeEvents: store.playtimeEvents(id, start, calendarDay ? end - 1 : end) };
  });
  handle('favoriteGame', (game: string, enabled: boolean) => {
    if (typeof game !== 'string' || !game || game.length > 170 || typeof enabled !== 'boolean') throw new Error('游戏分组无效。');
    currentStore().favoriteGame(game, enabled);
    changed();
  });
  handle('preferences', () => preferences);
  handle('savePreferences', async (input: Preferences) => {
    const settings = parsePreferences(input);
    if (settings.notices.online || settings.notices.game || settings.notices.party) await prepareNotifications();
    if (settings.autoStart !== preferences.autoStart) {
      if (!app.isPackaged) throw new Error('请从便携版设置开机启动。');
      app.setLoginItemSettings({ openAtLogin: settings.autoStart, name: startupName, path: process.execPath, args: startupArgs });
      if (app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin !== settings.autoStart) {
        throw new Error('Windows 未保存开机启动设置。');
      }
    }
    live.setPreference('retentionDays', String(settings.retentionDays));
    live.setPreference('notices', JSON.stringify(settings.notices));
    preferences = settings;
    prune();
    changed();
  });
  handle('testNotice', async () => {
    await prepareNotifications();
    await sendNotification('SteamMonitor 测试通知', 'Windows 系统通知已接通。');
  });
  handle('backup', async () => {
    const { canceled, filePath } = await dialog.showSaveDialog(window!, {
      title: '备份 Steam 数据', defaultPath: 'SteamMonitor-backup-' + new Date().toISOString().slice(0, 10) + '.sqlite',
      filters: [{ name: 'SteamMonitor SQLite', extensions: ['sqlite'] }],
    });
    if (canceled || !filePath) return false;
    const directory = await mkdtemp(path.join(app.getPath('userData'), 'backup-'));
    const temporary = path.join(directory, 'backup.sqlite');
    try {
      live.backup(temporary);
      await copyFile(temporary, filePath, constants.COPYFILE_EXCL);
      return true;
    } catch {
      throw new Error('备份失败。请选择一个新的文件名和可写目录。');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
      await rmdir(directory).catch(() => {});
    }
  });
  handle('restore', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window!, {
      title: '选择 SteamMonitor 备份', properties: ['openFile'],
      filters: [{ name: 'SteamMonitor SQLite', extensions: ['sqlite'] }],
    });
    if (canceled || !filePaths[0]) return false;
    const { response } = await dialog.showMessageBox(window!, {
      type: 'warning', message: '用备份替换本机的 Steam 好友名单和活动历史？',
      detail: 'API Key 和其他设置会保留。自动时长采样需重新启用。', buttons: ['取消', '替换'], cancelId: 0, defaultId: 0,
    });
    if (response !== 1) return false;
    maintenance = true;
    syncPolling();
    try {
      live.restore(filePaths[0]);
      live.gap(Date.now(), '恢复备份后的采集间隔', true);
      prune();
      return true;
    } catch {
      throw new Error('无法恢复此备份。请选择 SteamMonitor 0.2 或同结构版本生成的文件。');
    } finally {
      maintenance = false;
      syncPolling();
    }
  });
  handle('previewGapBatch', (expectedMode: Snapshot['mode'], anchor: GapTarget) => {
    checkGapTarget(anchor);
    if (expectedMode !== mode || maintenance || quitting) throw new Error('请重新选择这条缺口。');
    const batch = currentStore().gapBatch(anchor);
    if (!batch) throw new Error('这条缺口已更新，请重新选择。');
    return batch;
  });
  handle('removeGapBatch', (expectedMode: Snapshot['mode'], anchor: GapTarget, targets: GapTarget[], scope: 'single' | 'batch') => {
    checkGapTarget(anchor);
    if (expectedMode !== mode || maintenance || quitting || !Array.isArray(targets) || !targets.length ||
        (scope !== 'single' && scope !== 'batch')) throw new Error('请重新打开缺口预览。');
    targets.forEach(checkGapTarget);
    const count = currentStore().removeGapBatch(anchor, targets, scope);
    changed();
    return count;
  });
  handle('clearHistory', async (id?: string) => {
    if (id !== undefined) checkId(id);
    const store = id ? currentStore() : live;
    const { response } = await dialog.showMessageBox(window!, {
      type: 'warning', message: id ? '清除此好友的活动和公开时长对比？' : '清除所有 Steam 活动和公开时长对比？',
      detail: '保留好友名单和置顶，同时关闭所选账号的自动时长采样。', buttons: ['取消', '清除历史'], cancelId: 0, defaultId: 0,
    });
    if (response !== 1) return false;
    if (store === live) playtimeSampler.cancel(id);
    poller.stop();
    store.clearHistory(id);
    syncPolling();
    return true;
  });
  handle('playtime', (id: string) => {
    checkId(id);
    return currentStore().playtime(id)?.review ?? null;
  });
  handle('samplePlaytime', async (id: string, approved: boolean) => {
    checkId(id);
    if (mode === 'live') return playtimeSampler.sample(id, approved);
    const friend = demoStore.friends().find(item => item.id === id && !item.paused);
    if (!friend) throw new Error('该账号暂时不可采样。');
    const previous = demoStore.playtime(id);
    const at = Math.max(Date.now(), (previous?.review.at ?? 0) + 1);
    const games = [{ appId: '570', name: 'Dota 2', minutes: (previous?.games[0]?.minutes ?? 34) + 6 }];
    const { sample, events } = reviewPlaytime(demoStore, friend, previous, games, at);
    demoStore.recordPlaytime(id, sample, events);
    changed();
    return sample.review;
  });
  handle('playtimeWatch', (id: string) => {
    checkId(id);
    return mode === 'live' ? playtimeSampler.status(id) : { enabled: false, checking: false, paused: false, nextAt: null, error: '' };
  });
  handle('setPlaytimeWatch', (id: string, enabled: boolean, approved: boolean) => {
    checkId(id);
    if (mode !== 'live' || typeof enabled !== 'boolean') throw new Error('请切换到 Steam 数据后设置自动采样。');
    playtimeSampler.configure(id, enabled, approved);
  });
  handle('clearPlaytime', (id: string) => {
    checkId(id);
    if (mode === 'live') playtimeSampler.cancel(id);
    currentStore().clearPlaytime(id);
    changed();
  });
  handle('configureDiscovery', async (input: string, enabled: boolean) => {
    if (typeof input !== 'string' || input.length > 256 || typeof enabled !== 'boolean') throw new Error('好友发现设置无效。');
    if (!enabled && !input.trim()) {
      discovery.configure('', false);
      return;
    }
    const api = requireLiveApi();
    const expectedKey = key;
    const owner = await api.resolve(input);
    if (key !== expectedKey || mode !== 'live' || quitting) throw new Error('数据源已变更，请重新保存。');
    discovery.configure(owner, enabled);
    if (enabled && !paused && !sleeping) await discovery.check();
  });
  handle('checkDiscovery', async () => { await discovery.check(true); });
  handle('previewDiscovery', () => {
    requireLiveApi();
    invalidatePreview();
    return finishPreview(previewSequence, discovery.preview());
  });
  handle('dismissDiscovery', () => {
    if (mode !== 'live') return;
    discovery.dismiss();
    invalidatePreview();
  });
}

async function launch() {
  live = new Store(path.join(app.getPath('userData'), 'history.sqlite'));
  gameAssets = new GameAssets(path.join(app.getPath('userData'), 'game-assets.sqlite'));
  protocol.handle('steam-art', async request => {
    const match = /^steam-art:\/\/(game|icon)\/([1-9]\d{0,7})$/.exec(request.url);
    const image = match && request.method === 'GET' ? await gameAssets.image(match[2], match[1] === 'icon' ? 'icon' : 'image') : null;
    if (!image) return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
    return new Response(new Uint8Array(image).buffer, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=86400' } });
  });
  demoStore = new Store(':memory:');
  demoUpdated = Date.now();
  demo = new Demo(demoStore, demoUpdated);
  mode = live.preference('mode') === 'live' ? 'live' : 'demo';
  paused = live.preference('paused') === 'true';
  const autoStart = app.isPackaged && app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin;
  preferences = parsePreferences({
    autoStart, retentionDays: Number(live.preference('retentionDays') ?? '90'),
    notices: live.preference('notices') ? JSON.parse(live.preference('notices')!) : defaultNotices,
  });
  const cleanup = setInterval(() => { prune(); changed(); }, 60 * 60_000);
  cleanup.unref();
  app.once('before-quit', () => clearInterval(cleanup));
  try {
    const { result } = await safeStorage.decryptStringAsync(await readFile(keyFile()));
    key = result;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') keyReadError = '无法读取保存的 API Key，请重新填写。';
  }
  live.gap(Date.now(), '应用未运行', true);
  prune();
  poller = new Poller(live, () => key ? new SteamApi(key) : null, changed,
    (before, after, now) => notices.evaluate(before, after, preferences.notices, now));
  discovery = new Discovery(live, () => mode === 'live' && key && !paused && !sleeping && !maintenance && !quitting
    ? new SteamApi(key) : null, changed);
  playtimeSampler = new PlaytimeSampler(live, () => mode === 'live' && key && !maintenance && !quitting
    ? new SteamApi(key) : null, () => Boolean(mode === 'live' && key && !paused && !sleeping && !maintenance && !quitting), changed);
  const discoveryTimer = setInterval(() => { void discovery.check(); }, 60_000);
  discoveryTimer.unref();
  app.once('before-quit', () => { clearInterval(discoveryTimer); discovery.invalidate(); });
  const playtimeTimer = setInterval(() => { void playtimeSampler.tick(); }, 30_000);
  playtimeTimer.unref();
  app.once('before-quit', () => { clearInterval(playtimeTimer); playtimeSampler.cancel(); });
  registerHandlers();
  const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png'));
  window = new BrowserWindow({
    title: 'SteamMonitor', width: 1260, height: 810, minWidth: 600, minHeight: 500, show: false,
    backgroundColor: '#101417', autoHideMenuBar: true, icon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!tray || !process.argv.includes('--start-hidden')) showWindow();
  });
  window.on('close', event => {
    if (quitting || !tray) return;
    event.preventDefault();
    window?.hide();
  });
  window.on('closed', () => { window = null; });
  if (!icon.isEmpty()) {
    tray = new Tray(icon.resize({ width: 20, height: 20 }));
    tray.setToolTip('SteamMonitor');
    tray.on('double-click', showWindow);
    updateTray();
  }
  powerMonitor.on('suspend', () => {
    sleeping = true;
    live.gap(Date.now(), '系统休眠', true);
    syncPolling();
  });
  powerMonitor.on('resume', () => {
    sleeping = false;
    syncPolling();
  });
  syncPolling();
  const folder = live.preference('activeUiUpdate');
  const saved = folder ? await savedUiUpdate(uiUpdateRoot(), folder, packagedUi.version, uiBackend()) : null;
  if (saved) tryUiUpdate(saved);
  else {
    if (folder) live.setPreference('activeUiUpdate', '');
    await window.loadFile(packagedUi.index);
  }
}

protocol.registerSchemesAsPrivileged([{ scheme: 'steam-art', privileges: { standard: true, secure: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(appId);
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
    if (trialUi) clearTimeout(trialUi.timer);
    poller?.stop();
  });
  app.on('will-quit', () => {
    tray?.destroy();
    gameAssets?.close();
    live?.close();
    demoStore?.close();
  });
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(launch).catch(() => {
    dialog.showErrorBox('SteamMonitor 启动失败', '请检查本地应用数据目录是否可写，或确认程序文件完整。');
    app.quit();
  });
}
