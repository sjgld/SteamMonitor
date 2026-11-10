import { ipcMain } from 'electron';
import type { MonitorHandlers } from '../../shared';
import type { Runtime } from '../runtime';
import { collectionHandlers } from './collection';
import { consentHandlers } from './consents';
import { friendHandlers } from './friends';
import { historyHandlers } from './history';
import { playtimeHandlers } from './playtime';
import { settingsHandlers } from './settings';
import { updateHandlers } from './updates';

/** Channel prefix; preload.ts repeats it because a sandboxed preload cannot import local modules. */
export const channelPrefix = 'monitor:';

export function registerIpc(rt: Runtime) {
  // The annotation makes the compiler reject a MonitorApi method without a handler.
  const handlers: MonitorHandlers = {
    ...collectionHandlers(rt),
    ...consentHandlers(rt),
    ...friendHandlers(rt),
    ...historyHandlers(rt),
    ...playtimeHandlers(rt),
    ...settingsHandlers(rt),
    ...updateHandlers(rt),
  };
  for (const [name, action] of Object.entries(handlers) as [string, (...args: unknown[]) => unknown][]) {
    ipcMain.handle(channelPrefix + name, (event, ...args: unknown[]) => {
      const window = rt.window;
      if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('无效请求。');
      }
      return action(...args);
    });
  }
}
