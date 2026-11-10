import { contextBridge, ipcRenderer } from 'electron';
import type { MonitorApi, MonitorMethod } from '../shared';

// A sandboxed preload can only require 'electron', so this file imports types only and repeats the
// channel prefix from ipc/register.ts.
const prefix = 'monitor:';

const methods = [
  'snapshot', 'uiReady', 'installUiUpdate', 'checkRelease', 'applyReleaseUi', 'openRelease',
  'setMode', 'setKey', 'connectSteam', 'finishOnboarding', 'refresh', 'setPaused', 'setGapThreshold',
  'previewPlayer', 'previewFriends', 'addPlayers', 'updateFriend', 'removeFriend',
  'activity', 'activityBoard', 'exportActivity', 'gameTitle', 'openSteam', 'report', 'favoriteGame',
  'preferences', 'savePreferences', 'testNotice', 'backup', 'restore', 'clearHistory',
  'previewGapBatch', 'removeGapBatch',
  'playtime', 'samplePlaytime', 'clearPlaytime', 'playtimeWatch', 'setPlaytimeWatch',
  'configureDiscovery', 'checkDiscovery', 'previewDiscovery', 'dismissDiscovery',
  'consents', 'revokeConsent',
] as const satisfies readonly MonitorMethod[];

// Fails to compile when a MonitorApi method is missing from the list above.
type Missing = Exclude<MonitorMethod, (typeof methods)[number]>;
const complete: [Missing] extends [never] ? true : Missing = true;
void complete;

const api = Object.fromEntries(methods.map(name =>
  [name, (...args: unknown[]) => ipcRenderer.invoke(prefix + name, ...args)])) as Omit<MonitorApi, 'onChange'>;

contextBridge.exposeInMainWorld('monitor', {
  ...api,
  onChange(callback) {
    const listener = () => callback();
    ipcRenderer.on(prefix + 'change', listener);
    return () => ipcRenderer.removeListener(prefix + 'change', listener);
  },
} satisfies MonitorApi);
