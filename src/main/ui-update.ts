import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Manifest {
  version: string;
  backend: string;
  files: Record<string, string>;
}

const versionPattern = /^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const assetPattern = /^assets\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.(?:js|css|woff2?|png|webp|svg|jpg|ico)$/;
const manifestFile = 'ui-update.json';
const limit = 12 * 1024 * 1024;
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function backendFingerprint(build: string, electron: string) {
  const files = [
    ...readdirSync(build).filter(name => name.endsWith('.js')),
    ...readdirSync(path.join(build, 'main')).filter(name => name.endsWith('.js')).map(name => 'main/' + name),
  ].sort();
  const signature = createHash('sha256').update(electron);
  for (const file of files) signature.update(file + '\0' + hash(readFileSync(path.join(build, file))));
  return signature.digest('hex');
}

export function createUiManifest(build: string, version: string, electron: string): Manifest {
  const ui = path.join(build, 'ui');
  const files = ['index.html', ...readdirSync(path.join(ui, 'assets')).map(name => 'assets/' + name)];
  return {
    version,
    backend: backendFingerprint(build, electron),
    files: Object.fromEntries(files.map(file => [file, hash(readFileSync(path.join(ui, file)))])),
  };
}

async function readBounded(file: string, maxSize: number) {
  const info = await lstat(file);
  if (!info.isFile() || info.size > maxSize) throw new Error('界面更新包包含无效文件。');
  const bytes = await readFile(file);
  if (bytes.length > maxSize) throw new Error('界面更新包过大。');
  return bytes;
}

function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

async function readUpdate(manifestPath: string, ui: string, backend: string) {
  const bytes = await readBounded(manifestPath, 64 * 1024);
  const manifest = JSON.parse(bytes.toString('utf8')) as Manifest;
  if (!manifest || !versionPattern.test(manifest.version) || typeof manifest.version !== 'string' ||
      !manifest.files || !Object.hasOwn(manifest.files, 'index.html')) {
    throw new Error('界面更新包的清单无效。');
  }
  if (manifest.backend !== backend) throw new Error('这个版本包含采集程序变更，请退出当前版本后打开新版。');
  const entries = Object.entries(manifest.files);
  if (entries.length > 128) throw new Error('界面更新包包含过多文件。');
  const files = new Map<string, Buffer>();
  let remaining = limit;
  for (const [file, digest] of entries) {
    if ((file !== 'index.html' && !assetPattern.test(file)) || typeof digest !== 'string' || !digestPattern.test(digest)) {
      throw new Error('界面更新包包含无效文件。');
    }
    const contents = await readBounded(path.join(ui, file), remaining);
    if (hash(contents) !== digest) throw new Error('界面文件校验失败，请重新解压新版。');
    remaining -= contents.length;
    files.set(file, contents);
  }
  return { manifest, bytes, files };
}

export interface UiTarget { version: string; index: string; folder?: string }

export async function stageUiUpdate(release: string, root: string, current: string, backend: string): Promise<UiTarget> {
  const appFolder = path.join(release, 'resources', 'app');
  const { manifest, bytes, files } = await readUpdate(path.join(appFolder, manifestFile),
    path.join(appFolder, 'build', 'ui'), backend);
  if (compareVersions(manifest.version, current) <= 0) throw new Error('请选择比当前界面更新的版本。');
  await mkdir(root, { recursive: true });
  const stage = await mkdtemp(path.join(root, 'ui-'));
  await mkdir(path.join(stage, 'assets'));
  for (const [file, contents] of files) await writeFile(path.join(stage, file), contents);
  await writeFile(path.join(stage, manifestFile), bytes);
  return { version: manifest.version, index: path.join(stage, 'index.html'), folder: path.basename(stage) };
}

export async function savedUiUpdate(root: string, folder: string, current: string, backend: string): Promise<UiTarget | null> {
  if (!/^ui-[a-zA-Z0-9]{6}$/.test(folder)) return null;
  try {
    const stage = path.join(root, folder);
    const { manifest } = await readUpdate(path.join(stage, manifestFile), stage, backend);
    if (compareVersions(manifest.version, current) <= 0) return null;
    return { version: manifest.version, index: path.join(stage, 'index.html'), folder };
  } catch {
    return null;
  }
}
