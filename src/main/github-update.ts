import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { ReleaseCheck } from '../shared';
import { compareVersions, isUiVersion, readReleaseBundle, releaseBundleLimit, releaseBundleName } from './ui-update';

const repository = 'sjgld/SteamMonitor';
const api = 'https://api.github.com/repos/' + repository;
const releaseHosts = new Set(['release-assets.githubusercontent.com', 'objects.githubusercontent.com', 'github-releases.githubusercontent.com']);

export const releasePage = (version: string) => 'https://github.com/' + repository + '/releases/tag/v' + version;

export function githubCredential(cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const git = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'cmd', 'git.exe');
    const child = execFile(git, ['-c', 'credential.helper=', '-c', 'credential.helper=manager', 'credential', 'fill'], {
      cwd, windowsHide: true, timeout: 8000, maxBuffer: 16 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GCM_TRACE: '0' },
    }, (error, output) => {
      const token = !error && /^password=([a-zA-Z0-9_]+)\r?$/m.exec(output)?.[1];
      if (token) resolve(token);
      else reject(new Error('请在 Git for Windows 中登录有权读取此仓库的 GitHub 账号，再检查更新。'));
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end('protocol=https\nhost=github.com\n\n');
  });
}

async function request(fetcher: typeof fetch, url: string, headers?: HeadersInit) {
  try {
    return await fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new Error('无法连接 GitHub，请检查网络后重试。');
  }
}

async function responseBytes(response: Response, limit: number) {
  const reader = response.body?.getReader();
  if (!response.ok || !reader) throw new Error('无法读取 GitHub 发布文件。');
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('GitHub 发布文件超出大小限制。');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(parts, size);
}

export async function checkGitHubRelease(token: string, current: string, backend: string, fetcher = globalThis.fetch):
  Promise<{ result: ReleaseCheck; bundle?: Awaited<ReturnType<typeof readReleaseBundle>> }> {
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'SteamMonitor' };
  const latest = await request(fetcher, api + '/releases/latest', headers);
  if (latest.status === 404) {
    await latest.body?.cancel();
    const repo = await request(fetcher, api, headers);
    await repo.body?.cancel();
    if (repo.ok) return { result: { kind: 'unpublished' } };
    throw new Error('当前 GitHub 账号无法读取 SteamMonitor 私有仓库。');
  }
  if (!latest.ok) {
    await latest.body?.cancel();
    throw new Error(`GitHub 检查更新失败（HTTP ${latest.status}）。`);
  }
  const { tag_name, assets } = JSON.parse((await responseBytes(latest, 1024 * 1024)).toString('utf8'));
  const version = typeof tag_name === 'string' && tag_name.startsWith('v') ? tag_name.slice(1) : null;
  if (!isUiVersion(version) || !Array.isArray(assets)) throw new Error('GitHub 发布版本格式无效。');
  if (compareVersions(version, current) <= 0) return { result: { kind: 'current', version: current } };
  const asset = assets.find(file => file?.name === releaseBundleName && file.state === 'uploaded');
  if (!asset) return { result: { kind: 'full', version } };
  if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 || asset.size > releaseBundleLimit || typeof asset.digest !== 'string' ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error('GitHub 界面包的校验信息无效。');
  }
  let response = await request(fetcher, api + '/releases/assets/' + asset.id, { ...headers, Accept: 'application/octet-stream' });
  if (response.status === 302) {
    const location = response.headers.get('location');
    await response.body?.cancel();
    const target = location && URL.parse(location);
    if (!target || target.protocol !== 'https:' || target.username || target.password || target.port ||
        !releaseHosts.has(target.hostname)) throw new Error('GitHub 发布文件地址无效。');
    response = await request(fetcher, target.href);
  }
  const bytes = await responseBytes(response, asset.size);
  if (bytes.length !== asset.size || 'sha256:' + createHash('sha256').update(bytes).digest('hex') !== asset.digest) {
    throw new Error('GitHub 界面包校验失败，请重新检查更新。');
  }
  const bundle = await readReleaseBundle(bytes, version);
  return bundle.manifest.backend === backend
    ? { result: { kind: 'interface', version }, bundle }
    : { result: { kind: 'full', version } };
}
