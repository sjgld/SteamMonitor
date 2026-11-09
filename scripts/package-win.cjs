const fs = require('node:fs');
const path = require('node:path');
const metadata = require('../package.json');

if (process.platform !== 'win32') throw new Error('Run this command on Windows.');
const electron = require('electron');
const root = path.join(__dirname, '..');
const release = path.join(root, 'release');
const target = path.join(release, `SteamMonitor-${metadata.version}-win32-${process.arch}`);
if (!fs.existsSync(electron)) throw new Error('Run Electron once to download the runtime first.');
if (fs.existsSync(target)) throw new Error(`The output already exists: ${target}`);

fs.mkdirSync(release, { recursive: true });
const stage = fs.mkdtempSync(path.join(release, 'stage-'));
fs.cpSync(path.dirname(electron), stage, { recursive: true });
const app = path.join(stage, 'resources', 'app');
fs.mkdirSync(app, { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(app, 'package.json'));
for (const folder of ['build', 'assets']) fs.cpSync(path.join(root, folder), path.join(app, folder), { recursive: true });
const { createUiManifest } = require('../build/main/ui-update.js');
const manifest = createUiManifest(path.join(app, 'build'), metadata.version, require('electron/package.json').version);
fs.writeFileSync(path.join(app, 'ui-update.json'), JSON.stringify(manifest, null, 2));
fs.renameSync(path.join(stage, 'electron.exe'), path.join(stage, 'SteamMonitor.exe'));
fs.renameSync(stage, target);
console.log(path.join(target, 'SteamMonitor.exe'));
