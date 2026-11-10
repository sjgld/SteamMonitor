import path from 'node:path';

// Compiled layout: build/main/*.js next to build/shared and build/ui; assets/ sits beside build/.
export const buildRoot = path.resolve(__dirname, '..');
export const packagedUiIndex = path.join(buildRoot, 'ui', 'index.html');
export const preloadScript = path.join(__dirname, 'preload.js');
export const appIcon = path.join(buildRoot, '..', 'assets', 'icon.png');

export const appUserModelId = 'SteamMonitor.Local';
export const startupName = 'SteamMonitor';
export const startupArgs = ['--start-hidden'];

export const userFiles = {
  history: 'history.sqlite',
  gameAssets: 'game-assets.sqlite',
  steamKey: 'steam-key.enc',
  uiUpdates: 'ui-updates',
} as const;
