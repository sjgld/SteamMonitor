import { contextBridge, ipcRenderer } from 'electron';
import type { MonitorApi } from '../shared';

const api: MonitorApi = {
  snapshot: () => ipcRenderer.invoke('monitor:snapshot'),
  uiReady: () => ipcRenderer.invoke('monitor:uiReady'),
  installUiUpdate: () => ipcRenderer.invoke('monitor:installUiUpdate'),
  checkRelease: () => ipcRenderer.invoke('monitor:checkRelease'),
  applyReleaseUi: () => ipcRenderer.invoke('monitor:applyReleaseUi'),
  openRelease: () => ipcRenderer.invoke('monitor:openRelease'),
  onChange(callback) {
    const listener = () => callback();
    ipcRenderer.on('monitor:change', listener);
    return () => ipcRenderer.removeListener('monitor:change', listener);
  },
  setMode: mode => ipcRenderer.invoke('monitor:setMode', mode),
  setKey: key => ipcRenderer.invoke('monitor:setKey', key),
  refresh: () => ipcRenderer.invoke('monitor:refresh'),
  setPaused: paused => ipcRenderer.invoke('monitor:setPaused', paused),
  setGapThreshold: minutes => ipcRenderer.invoke('monitor:setGapThreshold', minutes),
  previewPlayer: input => ipcRenderer.invoke('monitor:previewPlayer', input),
  previewFriends: input => ipcRenderer.invoke('monitor:previewFriends', input),
  addPlayers: ids => ipcRenderer.invoke('monitor:addPlayers', ids),
  updateFriend: (id, edit) => ipcRenderer.invoke('monitor:updateFriend', id, edit),
  removeFriend: id => ipcRenderer.invoke('monitor:removeFriend', id),
  activity: filter => ipcRenderer.invoke('monitor:activity', filter),
  activityBoard: filter => ipcRenderer.invoke('monitor:activityBoard', filter),
  exportActivity: filter => ipcRenderer.invoke('monitor:exportActivity', filter),
  gameTitle: appId => ipcRenderer.invoke('monitor:gameTitle', appId),
  openSteam: (kind, id) => ipcRenderer.invoke('monitor:openSteam', kind, id),
  report: (id, days, calendarDay, fixed) => ipcRenderer.invoke('monitor:report', id, days, calendarDay, fixed),
  favoriteGame: (game, enabled) => ipcRenderer.invoke('monitor:favoriteGame', game, enabled),
  preferences: () => ipcRenderer.invoke('monitor:preferences'),
  savePreferences: preferences => ipcRenderer.invoke('monitor:savePreferences', preferences),
  testNotice: () => ipcRenderer.invoke('monitor:testNotice'),
  backup: () => ipcRenderer.invoke('monitor:backup'),
  restore: () => ipcRenderer.invoke('monitor:restore'),
  clearHistory: id => ipcRenderer.invoke('monitor:clearHistory', id),
  previewGapBatch: (mode, anchor) => ipcRenderer.invoke('monitor:previewGapBatch', mode, anchor),
  removeGapBatch: (mode, anchor, targets, scope) => ipcRenderer.invoke('monitor:removeGapBatch', mode, anchor, targets, scope),
  playtime: id => ipcRenderer.invoke('monitor:playtime', id),
  samplePlaytime: (id, approved) => ipcRenderer.invoke('monitor:samplePlaytime', id, approved),
  clearPlaytime: id => ipcRenderer.invoke('monitor:clearPlaytime', id),
  playtimeWatch: id => ipcRenderer.invoke('monitor:playtimeWatch', id),
  setPlaytimeWatch: (id, enabled, approved) => ipcRenderer.invoke('monitor:setPlaytimeWatch', id, enabled, approved),
  configureDiscovery: (owner, enabled) => ipcRenderer.invoke('monitor:configureDiscovery', owner, enabled),
  checkDiscovery: () => ipcRenderer.invoke('monitor:checkDiscovery'),
  previewDiscovery: () => ipcRenderer.invoke('monitor:previewDiscovery'),
  dismissDiscovery: () => ipcRenderer.invoke('monitor:dismissDiscovery'),
};

contextBridge.exposeInMainWorld('monitor', api);
