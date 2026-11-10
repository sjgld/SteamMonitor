import { app, Notification, shell } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { appUserModelId } from '../paths';

/** Shows Windows toast notifications and keeps them alive until they are dismissed. */
export class DesktopNotifier {
  private readonly active = new Set<Notification>();

  constructor(private readonly onClick: () => void) {}

  /** Windows only delivers toasts for apps with a Start Menu shortcut carrying the AppUserModelID. */
  async prepare() {
    if (process.platform !== 'win32') return;
    const programs = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    await mkdir(programs, { recursive: true });
    const shortcut = path.join(programs, 'SteamMonitor.lnk');
    const args = app.isPackaged ? '' : '"' + app.getAppPath() + '"';
    if (!shell.writeShortcutLink(shortcut, { target: process.execPath, args, appUserModelId })) {
      throw new Error('无法注册 Windows 通知快捷方式。');
    }
  }

  async send(title: string, body: string) {
    if (!Notification.isSupported()) throw new Error('系统通知不可用。');
    await new Promise<void>((resolve, reject) => {
      const notification = new Notification({ title, body });
      this.active.add(notification);
      const timer = setTimeout(() => {
        this.active.delete(notification);
        reject(new Error('Windows 未确认通知，请检查系统通知设置。'));
      }, 4000);
      notification.once('show', () => {
        clearTimeout(timer);
        setTimeout(() => this.active.delete(notification), 5 * 60_000).unref();
        resolve();
      });
      notification.once('failed', () => {
        clearTimeout(timer);
        this.active.delete(notification);
        reject(new Error('Windows 拒绝了通知，请检查系统通知设置。'));
      });
      notification.once('close', () => this.active.delete(notification));
      notification.once('click', this.onClick);
      notification.show();
    });
  }
}
