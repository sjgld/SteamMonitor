import { app, powerMonitor, type BrowserWindow } from 'electron';
import path from 'node:path';
import { defaultGapThreshold, validGapThreshold, type Player, type Preferences, type Snapshot } from '../shared';
import { Discovery } from './collect/discovery';
import { PlaytimeSampler } from './collect/playtime';
import { Poller } from './collect/poller';
import { KeyVault } from './credentials';
import { dayMs } from './data/analytics';
import { Demo } from './data/demo';
import { Store } from './data/store';
import { DesktopNotifier } from './notify/desktop';
import { defaultNotices, Notices } from './notify/rules';
import { buildRoot, packagedUiIndex, startupArgs, userFiles } from './paths';
import { defaultRetentionDays, isFirstRun, parsePreferences } from './preferences';
import type { TrayMenu } from './shell/tray';
import { showWindow } from './shell/window';
import { SteamApi } from './steam/api';
import { GameAssets } from './steam/artwork';
import { UiHost } from './update/ui-host';

export type Mode = Snapshot['mode'];

/**
 * Accounts resolved by a preview. Adding requires a matching preview, so the renderer can only add
 * accounts the user has seen; any data-source change invalidates in-flight previews.
 */
export class PreviewCache {
  private sequence = 0;
  private players = new Map<string, Player>();

  invalidate() {
    this.sequence += 1;
    this.players = new Map();
    return this.sequence;
  }

  finish(sequence: number, players: Player[]) {
    if (sequence !== this.sequence) throw new Error('预览已失效，请重新查询。');
    this.players = new Map(players.map(player => [player.id, player]));
    return players;
  }

  get(id: string) {
    return this.players.get(id);
  }
}

/** Process-wide state of the collector: data stores, background jobs and the window they report to. */
export class Runtime {
  window: BrowserWindow | null = null;
  tray: TrayMenu | null = null;
  mode: Mode;
  paused: boolean;
  sleeping = false;
  /** Set while a backup is restored; all collection stops. */
  maintenance = false;
  demoUpdated = Date.now();
  preferences: Preferences;

  readonly live: Store;
  readonly demoStore: Store;
  readonly assets: GameAssets;
  readonly vault: KeyVault;
  readonly notifier: DesktopNotifier;
  readonly poller: Poller;
  readonly discovery: Discovery;
  readonly playtime: PlaytimeSampler;
  readonly ui: UiHost;
  readonly previews = new PreviewCache();
  private readonly demo: Demo;
  private readonly timers: NodeJS.Timeout[] = [];

  constructor(readonly userData: string, readonly quitting: () => boolean) {
    this.live = new Store(path.join(userData, userFiles.history));
    this.assets = new GameAssets(path.join(userData, userFiles.gameAssets));
    this.demoStore = new Store(':memory:');
    this.demo = new Demo(this.demoStore, this.demoUpdated);
    this.mode = this.live.preference('mode') === 'live' ? 'live' : 'demo';
    this.paused = this.live.preference('paused') === 'true';
    const autoStart = app.isPackaged && app.getLoginItemSettings({ path: process.execPath, args: startupArgs }).openAtLogin;
    const notices = this.live.preference('notices');
    this.preferences = parsePreferences({
      autoStart, retentionDays: Number(this.live.preference('retentionDays') ?? defaultRetentionDays),
      notices: notices ? JSON.parse(notices) : defaultNotices,
    });
    this.vault = new KeyVault(path.join(userData, userFiles.steamKey));
    this.notifier = new DesktopNotifier(this.showWindow);
    const rules = new Notices((title, body) => { void this.notifier.send(title, body).catch(() => {}); });

    const key = () => this.vault.value;
    const collecting = () => this.mode === 'live' && Boolean(key()) && !this.maintenance && !this.quitting();
    const active = () => collecting() && !this.paused && !this.sleeping;
    this.poller = new Poller(this.live, () => key() ? new SteamApi(key()) : null, this.changed,
      (before, after, now) => rules.evaluate(before, after, this.preferences.notices, now));
    this.discovery = new Discovery(this.live, () => active() ? new SteamApi(key()) : null, this.changed);
    this.playtime = new PlaytimeSampler(this.live, () => collecting() ? new SteamApi(key()) : null, active, this.changed);
    this.ui = new UiHost({
      window: () => this.window, quitting, changed: this.changed,
      preference: name => this.live.preference(name), setPreference: (name, value) => this.live.setPreference(name, value),
      userData, updatesRoot: path.join(userData, userFiles.uiUpdates), buildRoot,
    }, app.getVersion(), packagedUiIndex);
  }

  /** Loads credentials, closes the "not running" gap and starts the periodic jobs. */
  async start() {
    this.every(60 * 60_000, () => { this.prune(); this.changed(); });
    await this.vault.load();
    this.live.gap(Date.now(), '应用未运行', true);
    this.prune();
    this.every(60_000, () => { void this.discovery.check(); });
    this.every(30_000, () => { void this.playtime.tick(); });
  }

  private every(interval: number, task: () => void) {
    const timer = setInterval(task, interval);
    timer.unref();
    this.timers.push(timer);
  }

  watchPower() {
    powerMonitor.on('suspend', () => {
      this.sleeping = true;
      this.live.gap(Date.now(), '系统休眠', true);
      this.syncPolling();
    });
    powerMonitor.on('resume', () => {
      this.sleeping = false;
      this.syncPolling();
    });
  }

  /** Called on before-quit: stop every job that could still write. */
  shutdown() {
    this.ui.dispose();
    this.poller.stop();
    for (const timer of this.timers) clearInterval(timer);
    this.discovery.invalidate();
    this.playtime.cancel();
  }

  /** Called on will-quit, after the window is gone. */
  close() {
    this.tray?.destroy();
    this.assets.close();
    this.live.close();
    this.demoStore.close();
  }

  currentStore() {
    return this.mode === 'demo' ? this.demoStore : this.live;
  }

  readonly changed = () => {
    if (this.window && !this.window.isDestroyed()) this.window.webContents.send('monitor:change');
  };

  readonly showWindow = () => showWindow(this.window);

  prune() {
    this.live.prune(Date.now() - this.preferences.retentionDays * dayMs);
  }

  refresh() {
    if (this.mode === 'demo') {
      this.demoUpdated = Date.now();
      this.demo.refresh(this.demoUpdated);
      this.changed();
      return Promise.resolve();
    }
    return this.poller.refresh();
  }

  /** Starts or stops every Steam job to match mode, pause, sleep and maintenance state. */
  syncPolling() {
    if (this.mode === 'live' && !this.paused && !this.sleeping && !this.maintenance) {
      this.poller.start();
      void this.discovery.check();
      void this.playtime.tick();
    } else {
      this.poller.stop();
      this.discovery.invalidate();
      this.playtime.cancel();
    }
    this.changed();
  }

  setPaused(value: boolean) {
    if (this.paused === value) return;
    this.live.setPreference('paused', String(value));
    this.paused = value;
    if (value) this.live.gap(Date.now(), '暂停采集', true);
    this.syncPolling();
    this.tray?.update();
  }

  setMode(value: Mode) {
    if (this.mode === value) return;
    this.live.setPreference('mode', value);
    if (value === 'demo') this.live.gap(Date.now(), '切换到演示模式', true);
    this.mode = value;
    this.previews.invalidate();
    this.syncPolling();
    this.tray?.update();
  }

  /** Switches every Steam job to a key that `vault.write` has already persisted. */
  adoptKey(value: string) {
    this.poller.credentialsChanged();
    this.discovery.credentialsChanged();
    this.playtime.credentialsChanged();
    this.live.gap(Date.now(), 'API Key 已更改', true);
    this.vault.adopt(value);
    this.previews.invalidate();
    this.syncPolling();
  }

  gapThreshold() {
    const value = Number(this.live.preference('gapThresholdMinutes') ?? defaultGapThreshold);
    return validGapThreshold(value) ? value : defaultGapThreshold;
  }

  requireLiveApi() {
    if (this.mode !== 'live' || !this.vault.value) throw new Error('请先切换到 Steam 数据并填写 API Key。');
    return new SteamApi(this.vault.value);
  }

  snapshot(): Snapshot {
    const { mode, paused, sleeping, poller } = this;
    const state = mode === 'demo'
      ? { status: 'demo' as const, detail: '使用本机示例数据。', lastCheckedAt: this.demoUpdated, nextCheckAt: null }
      : paused || sleeping
        ? { ...poller.state, status: 'paused' as const, detail: sleeping ? '系统休眠。' : '采集已暂停。', nextCheckAt: null }
        : { ...poller.state, detail: this.vault.readError || poller.state.detail };
    const store = this.currentStore();
    const friends = store.friends();
    const lastSuccessAt = mode === 'demo' ? this.demoUpdated :
      friends.reduce((latest, friend) => Math.max(latest, friend.observedAt ?? 0), 0) || null;
    const preferred = Number(this.live.preference('preferredGapThresholdMinutes') ?? defaultGapThreshold);
    const onboarded = this.live.preference('onboarded') !== undefined;
    const firstRun = isFirstRun({ onboarded, hasKey: Boolean(this.vault.value),
      friends: onboarded ? 0 : mode === 'live' ? friends.length : this.live.friends().length });
    return { ...state, mode, hasKey: Boolean(this.vault.value), paused, friends, lastSuccessAt, firstRun,
      collectorVersion: this.ui.packaged.version, uiVersion: this.ui.version, uiUpdateResult: this.ui.result,
      gapThresholdMinutes: this.gapThreshold(),
      preferredGapThresholdMinutes: validGapThreshold(preferred) && preferred > 0 ? preferred : defaultGapThreshold,
      favoriteGames: store.favoriteGames(), discovery: this.discovery.snapshot() };
  }
}
