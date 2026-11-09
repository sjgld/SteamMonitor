const { execFileSync } = require('node:child_process');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');
const { createReleaseBundle, releaseBundleName } = require('../build/main/ui-update.js');

const release = path.join(__dirname, '..', 'release');
const folder = `SteamMonitor-${version}-win32-${process.arch}`;
const output = path.join(release, 'github-v' + version);
const build = path.join(release, folder, 'resources', 'app', 'build');
const bundle = createReleaseBundle(build, version, require('electron/package.json').version);
mkdirSync(output, { recursive: true });
writeFileSync(path.join(output, releaseBundleName), bundle);
execFileSync('tar.exe', ['-a', '-c', '-f', path.join(output, folder + '.zip'), '-C', release, folder], { stdio: 'inherit' });
console.log(output);
