import { app, dialog, nativeImage } from 'electron';
import { registerIpc } from './ipc/register';
import { appIcon, appUserModelId } from './paths';
import { Runtime } from './runtime';
import { handleArtProtocol, registerArtScheme } from './shell/art-protocol';
import { TrayMenu } from './shell/tray';
import { createMainWindow } from './shell/window';

let runtime: Runtime | null = null;
let quitting = false;

async function launch() {
  const rt = new Runtime(app.getPath('userData'), () => quitting);
  runtime = rt;
  handleArtProtocol(rt.assets);
  await rt.start();
  registerIpc(rt);

  const icon = nativeImage.createFromPath(appIcon);
  rt.window = createMainWindow({
    icon, hasTray: () => rt.tray !== null, quitting: () => quitting, onClosed: () => { rt.window = null; },
  });
  if (!icon.isEmpty()) {
    rt.tray = new TrayMenu(icon, {
      state: () => ({ mode: rt.mode, paused: rt.paused }),
      show: rt.showWindow,
      refresh: () => { void rt.refresh(); },
      setPaused: paused => rt.setPaused(paused),
      quit: () => app.quit(),
    });
  }
  rt.watchPower();
  rt.syncPolling();
  await rt.ui.loadInitial();
}

registerArtScheme();

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  if (process.platform === 'win32') app.setAppUserModelId(appUserModelId);
  app.on('second-instance', () => runtime?.showWindow());
  app.on('before-quit', () => {
    quitting = true;
    runtime?.shutdown();
  });
  app.on('will-quit', () => runtime?.close());
  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(launch).catch(() => {
    dialog.showErrorBox('SteamMonitor 启动失败', '请检查本地应用数据目录是否可写，或确认程序文件完整。');
    app.quit();
  });
}
