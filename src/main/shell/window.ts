import { BrowserWindow, type NativeImage } from 'electron';
import { preloadScript, startupArgs } from '../paths';

export function showWindow(window: BrowserWindow | null) {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

/**
 * The single locked-down renderer window. Closing it hides to the tray when a tray exists, so
 * collection keeps running in the background.
 */
export function createMainWindow({ icon, hasTray, quitting, onClosed }: {
  icon: NativeImage; hasTray: () => boolean; quitting: () => boolean; onClosed: () => void;
}) {
  const window = new BrowserWindow({
    title: 'SteamMonitor', width: 1260, height: 810, minWidth: 600, minHeight: 500, show: false,
    backgroundColor: '#101417', autoHideMenuBar: true, icon,
    webPreferences: {
      preload: preloadScript, contextIsolation: true, sandbox: true, nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => {
    if (!hasTray() || !process.argv.includes(startupArgs[0])) showWindow(window);
  });
  window.on('close', event => {
    if (quitting() || !hasTray()) return;
    event.preventDefault();
    window.hide();
  });
  window.on('closed', onClosed);
  return window;
}
