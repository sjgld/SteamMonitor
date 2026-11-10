import { Menu, Tray, type NativeImage } from 'electron';
import type { Snapshot } from '../../shared';

export interface TrayActions {
  state(): { mode: Snapshot['mode']; paused: boolean };
  show(): void;
  refresh(): void;
  setPaused(paused: boolean): void;
  quit(): void;
}

export class TrayMenu {
  private readonly tray: Tray;

  constructor(icon: NativeImage, private readonly actions: TrayActions) {
    this.tray = new Tray(icon.resize({ width: 20, height: 20 }));
    this.tray.setToolTip('SteamMonitor');
    this.tray.on('double-click', () => actions.show());
    this.update();
  }

  update() {
    const { mode, paused } = this.actions.state();
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 SteamMonitor', click: () => this.actions.show() },
      { label: mode === 'demo' ? '模拟下一次采样' : '立即刷新', enabled: mode === 'demo' || !paused,
        click: () => this.actions.refresh() },
      { label: paused ? '恢复采集' : '暂停采集', enabled: mode === 'live', click: () => this.actions.setPaused(!paused) },
      { type: 'separator' },
      { label: '退出', click: () => this.actions.quit() },
    ]));
  }

  destroy() {
    this.tray.destroy();
  }
}
